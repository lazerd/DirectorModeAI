/**
 * PTL enrolment — the public front door.
 *
 * A 5.0+ player from any club signs up as an INDIVIDUAL. There is no account,
 * no club membership and, in v1, no payment: NorCal will most likely collect
 * the $50 themselves, so ptl_entries.payment_status starts 'unpaid' and the
 * commissioner marks it off. Wiring a checkout in later touches only this file
 * and the confirmation email.
 *
 * Ratings: whatever the player gives us (NTRP is required, WTN optional) is
 * blended with an auto-looked-up UTR by computeCompositeRating — the same
 * blender the existing league signup uses. composite_score is what orders the
 * draft pool and what auto-pick falls back to, so getting it at enrolment
 * rather than asking a captain to eyeball it later is the whole point.
 */

import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { safeResendSend } from '@/lib/emailUnsubscribe';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { computeCompositeRating } from '@/lib/leagueRatings';
import { generateToken } from '@/lib/leagueUtils';
import { checkRateLimit, clampNumber, clampText, clientIp } from '@/lib/ptl/guard';

const resend = new Resend(process.env.RESEND_API_KEY);

/** Best-effort UTR by name. A miss is fine — NTRP alone still yields a composite. */
async function lookupUtr(name: string): Promise<{ utr: number | null; utrId: string | null }> {
  try {
    const url = `https://api.utrsports.net/v2/search/players?query=${encodeURIComponent(name)}&top=3`;
    const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!res.ok) return { utr: null, utrId: null };
    const data = await res.json();
    const hit = (data?.hits || [])[0];
    if (!hit) return { utr: null, utrId: null };
    const p = hit.source || hit;
    const raw = p.singlesUtr ?? p.thpiSinglesRating ?? p.singlesRating ?? null;
    return {
      utr: raw && raw !== 0 ? parseFloat(String(raw)) : null,
      utrId: p.profileId ? String(p.profileId) : p.id ? String(p.id) : null,
    };
  } catch {
    return { utr: null, utrId: null };
  }
}

export async function POST(request: Request) {
  try {
    if (!checkRateLimit(`ptl-enroll:${clientIp(request)}`)) {
      return NextResponse.json({ error: 'Too many requests. Give it a minute.' }, { status: 429 });
    }

    const body = await request.json().catch(() => ({}));

    const seasonSlug = clampText(body.seasonSlug, 64);
    const name = clampText(body.name);
    const email = clampText(body.email, 160);
    const phone = clampText(body.phone, 32);
    const homeClub = clampText(body.homeClub, 120);
    const ntrp = clampNumber(body.ntrp, 2.0, 7.0);
    const wtn = clampNumber(body.wtn, 1, 40);
    const genderRaw = clampText(body.gender, 8)?.toLowerCase();
    const gender = genderRaw === 'm' || genderRaw === 'f' ? genderRaw : null;

    if (!seasonSlug) return NextResponse.json({ error: 'Missing season.' }, { status: 400 });
    if (!name) return NextResponse.json({ error: 'Your name is required.' }, { status: 400 });
    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
    }
    if (ntrp == null) {
      return NextResponse.json({ error: 'An NTRP rating is required.' }, { status: 400 });
    }

    const db = getSupabaseAdmin();

    const { data: season } = await db
      .from('ptl_seasons')
      .select('id, name, slug, status, entry_cents, enroll_opens_at, enroll_closes_at, is_demo, rating_floor, category, min_men, min_women')
      .eq('slug', seasonSlug)
      .maybeSingle();

    if (!season) return NextResponse.json({ error: 'Season not found.' }, { status: 404 });

    const s = season as any;
    if (s.status !== 'enrolling') {
      return NextResponse.json({ error: 'Enrolment is not open for this season.' }, { status: 400 });
    }
    /*
     * The rating floor is a season setting, not a constant. The proposal says
     * 5.0, but a first pilot that needs to fill a field may well open at 4.5,
     * and that must not be a deploy. A null floor means no floor at all.
     * Checked here rather than in the form so it cannot be edited away in a
     * browser.
     */
    if (s.rating_floor != null && ntrp < Number(s.rating_floor)) {
      return NextResponse.json(
        {
          error: `${s.name} is a ${Number(s.rating_floor).toFixed(1)} and above league. `
            + 'If your rating is on its way up, email the commissioner.',
        },
        { status: 400 },
      );
    }

    /*
     * Gender is required only when the season's format actually needs it — a
     * gendered-line season cannot seat someone it can't assign to a line, and
     * the draft's roster minimums are counted from this. An open season never
     * asks, so nobody is made to answer a question that has no consequence.
     */
    const needsGender = s.min_men > 0 || s.min_women > 0 || s.category === 'mixed';
    if (needsGender && !gender) {
      return NextResponse.json(
        { error: 'This season plays gendered lines, so we need to know which draw you enter.' },
        { status: 400 },
      );
    }

    const now = new Date();
    if (s.enroll_opens_at && now < new Date(s.enroll_opens_at)) {
      return NextResponse.json({ error: 'Enrolment has not opened yet.' }, { status: 400 });
    }
    if (s.enroll_closes_at && now > new Date(s.enroll_closes_at)) {
      return NextResponse.json({ error: 'Enrolment has closed.' }, { status: 400 });
    }

    // Tell a returning player they're already in rather than bouncing them off
    // the unique index with a database error.
    const { data: existing } = await db
      .from('ptl_entries')
      .select('id')
      .eq('season_id', s.id)
      .ilike('email', email)
      .maybeSingle();
    if (existing) {
      return NextResponse.json(
        { error: "You're already enrolled for this season — check your email for the confirmation." },
        { status: 409 },
      );
    }

    const utrLookup = await lookupUtr(name);
    const rating = computeCompositeRating({ ntrp, utr: utrLookup.utr, wtn });
    const playerToken = generateToken();

    const { data: entry, error: insertErr } = await db
      .from('ptl_entries')
      .insert({
        season_id: s.id,
        name,
        email: email.toLowerCase(),
        phone,
        home_club: homeClub,
        ntrp,
        utr: utrLookup.utr,
        utr_id: utrLookup.utrId,
        wtn,
        composite_score: rating.composite,
        rating_source: rating.source,
        rating_confidence: rating.confidence,
        gender,
        flag_discrepancy: rating.flagDiscrepancy,
        status: 'confirmed',
        payment_status: 'unpaid',
        player_token: playerToken,
      })
      .select('id')
      .single();

    if (insertErr || !entry) {
      console.error('[ptl] enrol insert failed', insertErr);
      return NextResponse.json({ error: 'Could not save your entry. Try again.' }, { status: 500 });
    }

    /*
     * Demo seasons never send, full stop.
     *
     * The demo pool is seeded at @example.com, which lib/demo/emailGuard.ts
     * already suppresses before any lookup. But this is a SALES demo: the
     * person clicking through is a committee member, and the first thing they
     * will do on the enrolment form is type their own real address to see what
     * happens. Address-based suppression would happily mail them a confirmation
     * for a league that does not exist. So the season flag decides, not the
     * recipient.
     */
    if (s.is_demo) {
      return NextResponse.json({
        success: true,
        entryId: (entry as any).id,
        composite: rating.composite,
        ratingSource: rating.source,
        demo: true,
        notice: "You're in the demo pool. No email was sent — this is a sample season.",
      });
    }

    // Confirmation. Never block the enrolment on it — a player who is in the
    // pool but did not get an email is recoverable; one who filled in the form
    // and got an error is gone.
    try {
      const origin = new URL(request.url).origin;
      const fee = (s.entry_cents / 100).toFixed(0);
      await safeResendSend(resend, {
        from: process.env.RESEND_FROM_EMAIL || 'Premier Tennis League <noreply@mail.clubmode.ai>',
        to: email,
        subject: `You're in the pool — ${s.name} Premier Tennis League`,
        html: `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#0f172a;">
            <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#64748b;">Premier Tennis League</div>
            <h2 style="margin:6px 0 16px;font-size:24px;">You're in the pool, ${name.split(' ')[0]}.</h2>
            <p style="line-height:1.6;">You're enrolled for <strong>${s.name}</strong>. You don't pick a team — captains draft the rosters at the draft, so every team starts balanced.</p>
            <div style="background:#f8fafc;border-left:4px solid #0f766e;padding:14px 18px;border-radius:6px;margin:20px 0;">
              <div style="font-weight:600;">What happens next</div>
              <ol style="margin:10px 0 0;padding-left:20px;line-height:1.8;color:#334155;">
                <li>We confirm the field and set the draft date.</li>
                <li>Captains draft. You'll get an email the moment you're picked.</li>
                <li>Your full season grid is published the same day — every date, up front.</li>
              </ol>
            </div>
            <p style="line-height:1.6;">Entry is <strong>$${fee}</strong>, collected before the first night. Nothing is charged today.</p>
            <p style="margin-top:24px;"><a href="${origin}/ptl" style="display:inline-block;background:#0f766e;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">See the league</a></p>
            <p style="color:#64748b;font-size:12px;margin-top:28px;">Rated from the NTRP you gave us${utrLookup.utr ? `, blended with your UTR of ${utrLookup.utr}` : ''}. If that looks wrong, reply and we'll fix it before the draft.</p>
          </div>
        `,
      });
    } catch (emailErr) {
      console.error('[ptl] enrol confirmation email failed', emailErr);
    }

    return NextResponse.json({
      success: true,
      entryId: (entry as any).id,
      composite: rating.composite,
      ratingSource: rating.source,
    });
  } catch (err: any) {
    console.error('[ptl] enrol error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { sendBilledEmail } from '@/lib/email';
import { background } from '@/lib/partnerFinder/background';
import { APP_URL } from '@/lib/appUrl';
import {
  PLACEMENT_FEE_CENTS,
  STAGE_LABEL,
  clubCanMove,
  guaranteeUntil,
  isStage,
  withinAttribution,
} from '@/lib/connect/placement';
import { feeEligible } from '@/lib/connect/feeScope';
import { logStageEvent } from '@/lib/connect/events';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const usd = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const fmtDate = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const PLATFORM_INBOX = () => process.env.RECRUITING_LEADS_EMAIL || 'darrinjco@gmail.com';

function validYmd(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// POST — the club moves an applicant through its process.
// body: { stage, start_date? (YYYY-MM-DD, required for 'hired'), club_notes? }
// Hiring an introduced candidate inside the attribution window records the
// placement (the fee event) exactly once per application.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const to = body.stage;
  const notes = typeof body.club_notes === 'string' ? body.club_notes.slice(0, 5000) : undefined;

  const db = getSupabaseAdmin();
  const { data: app } = await db
    .from('connect_applications')
    .select('id, opening_id, candidate_id, stage, introduced_at, consent_at, created_at')
    .eq('id', id)
    .maybeSingle();
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const { data: opening } = await db
    .from('connect_openings')
    .select('id, owner_id, club_name, title, dept, placement_fee_cents, terms_version, status')
    .eq('id', app.opening_id)
    .maybeSingle();
  if (!opening || opening.owner_id !== user.id) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  // Notes-only update (no stage change).
  if (to === undefined || to === app.stage) {
    if (notes === undefined) return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
    if (app.stage === 'invited') return NextResponse.json({ error: 'not found' }, { status: 404 });
    await db.from('connect_applications').update({ club_notes: notes, updated_at: new Date().toISOString() }).eq('id', id);
    return NextResponse.json({ ok: true, stage: app.stage });
  }

  if (!isStage(to) || !isStage(app.stage) || !clubCanMove(app.stage, to)) {
    return NextResponse.json(
      { error: `Can't move from ${isStage(app.stage) ? STAGE_LABEL[app.stage] : app.stage} to ${isStage(to) ? STAGE_LABEL[to] : String(to)}.` },
      { status: 400 },
    );
  }

  const now = new Date();
  const update: Record<string, unknown> = { stage: to, updated_at: now.toISOString() };
  if (notes !== undefined) update.club_notes = notes;

  if (to === 'hired') {
    if (!validYmd(body.start_date)) {
      return NextResponse.json({ error: 'Enter a start date (YYYY-MM-DD) to mark this hire.' }, { status: 400 });
    }
    update.start_date = body.start_date;
    update.hired_at = now.toISOString();
  }

  // Guard the transition against a concurrent move: only update from the stage we read.
  const { data: moved, error: moveErr } = await db
    .from('connect_applications')
    .update(update)
    .eq('id', id)
    .eq('stage', app.stage)
    .select('id')
    .maybeSingle();
  if (moveErr) return NextResponse.json({ error: moveErr.message }, { status: 500 });
  if (!moved) return NextResponse.json({ error: 'This application changed — refresh and try again.' }, { status: 409 });
  await logStageEvent({ application_id: id, from_stage: app.stage, to_stage: to, actor_id: user.id, actor_role: 'club', at: now.toISOString() });

  const { data: cand } = await db
    .from('connect_candidates')
    .select('full_name, email')
    .eq('id', app.candidate_id)
    .maybeSingle();
  const name = cand?.full_name || 'The candidate';
  const first = (cand?.full_name || '').trim().split(/\s+/)[0];
  const club = opening.club_name || 'your club';
  const role = opening.title || opening.dept;

  if (to === 'hired') {
    const startDate = body.start_date as string;
    const introducedAt = new Date(app.introduced_at || app.consent_at || app.created_at);
    // The fee covers director-level leadership only; other hires are free (job board only).
    const attributable = withinAttribution(introducedAt, now) && feeEligible(null, opening.title);
    let placement: any = null;

    if (attributable) {
      const fee = Number(opening.placement_fee_cents) || PLACEMENT_FEE_CENTS;
      const { data: ins, error: pErr } = await db
        .from('connect_placements')
        .upsert(
          {
            application_id: app.id,
            opening_id: opening.id,
            candidate_id: app.candidate_id,
            candidate_name: cand?.full_name ?? null,
            club_owner_id: opening.owner_id,
            fee_cents: fee,
            terms_version: opening.terms_version,
            start_date: startDate,
            guarantee_until: guaranteeUntil(startDate),
            status: 'pending_start',
          },
          { onConflict: 'application_id', ignoreDuplicates: true },
        )
        .select('*')
        .maybeSingle();
      if (pErr) {
        console.error('[connect/stage] placement insert failed', pErr);
        // The hire stands; make sure the fee isn't silently lost.
        background('recruiting placement failure alert', () =>
          sendBilledEmail(null, {
            to: PLATFORM_INBOX(),
            subject: `ACTION: placement row failed — ${name} hired at ${club}`,
            html: `<p>Application ${app.id} was marked hired (start ${esc(startDate)}) but the placement insert failed: ${esc(pErr.message)}. Create it by hand.</p>`,
          }),
        );
      }
      placement = ins;
    }

    await db.from('connect_openings').update({ status: 'filled', updated_at: now.toISOString() }).eq('id', opening.id);

    // Emails only when this call created the placement (or there's no fee) — keeps retries quiet.
    if (placement || !attributable) {
      const ownerEmail = user.email;
      background('recruiting hire emails', async () => {
        if (placement) {
          const fee = usd(placement.fee_cents);
          await sendBilledEmail(null, {
            to: PLATFORM_INBOX(),
            subject: `Placement: ${name} hired at ${club}, ${fee} due ${startDate}`,
            html: `<p><strong>${esc(name)}</strong> was hired as <strong>${esc(role)}</strong> at <strong>${esc(club)}</strong>.</p>
<ul>
<li>Fee: ${fee} (terms ${esc(String(opening.terms_version || 'n/a'))})</li>
<li>Start date / fee due: ${fmtDate(startDate)}</li>
<li>Guarantee until: ${fmtDate(placement.guarantee_until)}</li>
<li>Club owner: ${esc(ownerEmail || opening.owner_id)}</li>
<li>Placement id: ${placement.id}</li>
</ul>
<p><a href="${APP_URL}/admin/placements">Open placements</a> to invoice.</p>`,
          });
          if (ownerEmail) {
            await sendBilledEmail(null, {
              to: ownerEmail,
              operational: true,
              subject: `Congratulations on hiring ${name}`,
              html: `<p>Congratulations — you've hired <strong>${esc(name)}</strong> as ${esc(role)} at ${esc(club)}.</p>
<p>As agreed when you posted the opening, the ClubMode placement fee of <strong>${fee}</strong> is due on their start date, <strong>${fmtDate(startDate)}</strong>. We'll send an invoice.</p>
<p>If ${esc(first || 'they')} leave${first ? 's' : ''} within 90 days of starting (by ${fmtDate(placement.guarantee_until)}), we'll run one replacement search at no charge.</p>
<p>Questions? Just reply to this email.</p>`,
              replyTo: PLATFORM_INBOX(),
            });
          }
        }
        if (cand?.email) {
          await sendBilledEmail(null, {
            to: cand.email,
            subject: `Congratulations — ${club}`,
            html: `<p>${first ? `Hi ${esc(first)},` : 'Hi,'}</p>
<p>${esc(club)} has marked you as hired for the ${esc(role)} role${startDate ? `, starting ${fmtDate(startDate)}` : ''}. Congratulations from everyone at ClubMode Recruiting!</p>
<p>Good luck in the new seat.</p>`,
          });
        }
      });
    }

    return NextResponse.json({ ok: true, stage: to, placement: placement ? { fee_cents: placement.fee_cents, start_date: placement.start_date, guarantee_until: placement.guarantee_until } : null, attributable });
  }

  if (to === 'declined' && (app.stage === 'interviewing' || app.stage === 'offer') && cand?.email) {
    background('recruiting decline email', () =>
      sendBilledEmail(null, {
        to: cand.email as string,
        subject: `Your application to ${club}`,
        html: `<p>${first ? `Hi ${esc(first)},` : 'Hi,'}</p>
<p>Thank you for the time you put into interviewing for the ${esc(role)} role at ${esc(club)}. The club has decided to move forward with other candidates.</p>
<p>Your profile stays active on ClubMode Recruiting, and we'll let you know when another opening fits. <a href="${APP_URL}/connect/jobs">Browse open roles</a>.</p>`,
      }),
    );
  }

  return NextResponse.json({ ok: true, stage: to });
}

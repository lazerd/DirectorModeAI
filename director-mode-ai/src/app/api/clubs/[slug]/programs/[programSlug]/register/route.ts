/**
 * POST /api/clubs/[slug]/programs/[programSlug]/register
 *
 * Public and unauthenticated. A parent deciding at 9pm on their phone will not
 * make an account first, and asking them to is how a club loses the signup to
 * a phone call in the morning.
 *
 * Capacity is enforced HERE rather than by an RLS policy, which is why there
 * is no public INSERT policy on club_program_registrations: a policy cannot
 * count the enrolled rows, and it cannot decide that the nineteenth family
 * becomes a waitlist entry instead of a rejection.
 *
 * Hardening copied from /api/tournaments/register — the same public-form
 * problems, already solved once.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { resolveTheme } from '@/lib/clubSite/theme';
import { programSessions } from '@/lib/programs/sessions';
import {
  sendProgramConfirmation,
  sendProgramWaitlist,
  type ProgramEmailContext,
} from '@/lib/programs/emails';
import { CreditLimitError } from '@/lib/billing';
import { getClubPayments, paymentOffer } from '@/lib/courts/payments';

export const dynamic = 'force-dynamic';

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (bucket.count >= RATE_LIMIT_MAX) return false;
  bucket.count += 1;
  return true;
}

function clampText(v: unknown, max = 120): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length === 0 ? null : t.slice(0, max);
}

const looksLikeEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string; programSlug: string }> },
) {
  try {
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      req.headers.get('x-real-ip') ||
      'unknown';
    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { error: 'Too many sign-ups from here. Try again in a minute.' },
        { status: 429 },
      );
    }

    const { slug, programSlug } = await params;
    const db = getSupabaseAdmin();

    const { data: clubRow } = await db
      .from('cc_clubs')
      .select('id, slug, name, email, phone, timezone, owner_id, is_public')
      .eq('slug', (slug || '').trim().toLowerCase())
      .maybeSingle();
    const club = clubRow as {
      id: string;
      slug: string;
      name: string;
      email: string | null;
      phone: string | null;
      timezone: string | null;
      owner_id: string;
      is_public: boolean;
    } | null;
    if (!club || !club.is_public) {
      return NextResponse.json({ error: 'Club not found.' }, { status: 404 });
    }

    const { data: programRow } = await db
      .from('club_programs')
      .select('*')
      .eq('club_id', club.id)
      .eq('slug', (programSlug || '').trim().toLowerCase())
      .maybeSingle();
    const program = programRow as Record<string, unknown> | null;
    if (!program || program.status !== 'published') {
      return NextResponse.json({ error: 'That class is not open.' }, { status: 404 });
    }

    // --------------------------------------------------- registration window
    if (program.registration_mode !== 'online') {
      return NextResponse.json(
        {
          error:
            program.registration_mode === 'email'
              ? `Sign-ups for this one run by email${club.email ? ` — write to ${club.email}` : ''}.`
              : 'Registration for this class is closed.',
        },
        { status: 409 },
      );
    }
    const now = new Date();
    if (program.registration_opens_at && new Date(String(program.registration_opens_at)) > now) {
      return NextResponse.json({ error: 'Registration has not opened yet.' }, { status: 409 });
    }
    if (program.registration_closes_at && new Date(String(program.registration_closes_at)) < now) {
      return NextResponse.json({ error: 'Registration has closed.' }, { status: 409 });
    }

    // ------------------------------------------------------------- the form
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const participantName = clampText(body.participant_name, 120);
    const parentEmailRaw = clampText(body.parent_email, 200);
    if (!participantName) {
      return NextResponse.json({ error: "We need the player's name." }, { status: 400 });
    }
    if (!parentEmailRaw || !looksLikeEmail(parentEmailRaw)) {
      return NextResponse.json({ error: 'We need a valid email address.' }, { status: 400 });
    }
    const parentEmail = parentEmailRaw.toLowerCase();

    const dobRaw = clampText(body.participant_dob, 10);
    const participantDob = dobRaw && /^\d{4}-\d{2}-\d{2}$/.test(dobRaw) ? dobRaw : null;

    // ----------------------------------------------------- already signed up
    const { data: existing } = await db
      .from('club_program_registrations')
      .select('id, status')
      .eq('program_id', program.id as string)
      .eq('parent_email', parentEmail)
      .ilike('participant_name', participantName)
      .neq('status', 'cancelled')
      .maybeSingle();
    if (existing) {
      // A parent who taps twice, or comes back unsure whether it worked. Tell
      // them it is done rather than showing the unique-index violation.
      return NextResponse.json(
        {
          error: `${participantName} is already signed up for this class — check your email for the confirmation.`,
        },
        { status: 409 },
      );
    }

    // -------------------------------------------------------------- capacity
    const capacity = program.capacity == null ? null : Number(program.capacity);
    const { count: enrolledCount } = await db
      .from('club_program_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('program_id', program.id as string)
      .eq('status', 'enrolled');
    const enrolled = enrolledCount ?? 0;
    const full = capacity !== null && enrolled >= capacity;

    if (full && !program.waitlist_enabled) {
      return NextResponse.json({ error: 'This class is full.' }, { status: 409 });
    }
    const status = full ? 'waitlist' : 'enrolled';

    const priceCents = Number(program.price_cents) || 0;
    const { data: inserted, error: insertErr } = await db
      .from('club_program_registrations')
      .insert({
        program_id: program.id,
        club_id: club.id,
        participant_name: participantName,
        participant_dob: participantDob,
        parent_name: clampText(body.parent_name, 120),
        parent_email: parentEmail,
        parent_phone: clampText(body.parent_phone, 40),
        notes: clampText(body.notes, 1000),
        status,
        // A waitlisted family owes nothing until a spot opens, so no amount is
        // recorded against them yet.
        payment_status: status === 'waitlist' ? 'pending' : priceCents > 0 ? 'pending' : 'waived',
        amount_cents: status === 'waitlist' ? null : priceCents,
      })
      .select('id, participant_name, parent_name, parent_email, status, amount_cents')
      .maybeSingle();

    if (insertErr || !inserted) {
      // The partial unique index is the backstop if two taps race past the
      // check above; both messages have to read like English, not Postgres.
      const duplicate = (insertErr?.message || '').includes('idx_cpr_no_dupes');
      return NextResponse.json(
        {
          error: duplicate
            ? `${participantName} is already signed up for this class.`
            : insertErr?.message || 'Could not save the registration.',
        },
        { status: duplicate ? 409 : 500 },
      );
    }

    const registration = inserted as {
      id: string;
      participant_name: string;
      parent_name: string | null;
      parent_email: string;
      status: string;
      amount_cents: number | null;
    };

    /*
     * ------------------------------------------------ the player spine
     * Registrants join master_players so the club can reach them for years,
     * not only for the class they happened to sign up to.
     *
     * Look-up-then-insert rather than upsert: master_players has no unique
     * index to conflict on — email_normalized is a plain index, and the table
     * has primary_club_id, not club_id. An upsert here would fail every time.
     *
     * Matched on the normalized email AND the player's name, because one
     * parent's address covers several children and matching on email alone
     * would file all of them as the same person. Best effort throughout: a
     * failure here must never cost the club the registration.
     */
    let masterPlayerId: string | null = null;
    try {
      const { data: found } = await db
        .from('master_players')
        .select('id')
        .eq('email_normalized', parentEmail)
        .ilike('full_name', participantName)
        .limit(1)
        .maybeSingle();

      if (found) {
        masterPlayerId = (found as { id: string }).id;
      } else {
        const { data: created } = await db
          .from('master_players')
          .insert({
            full_name: participantName,
            // The parent's address is how the club reaches this player, and
            // also goes in parent_email so a junior's own address can replace
            // it later without losing the contact.
            email: parentEmail,
            parent_email: parentEmail,
            parent_phone: clampText(body.parent_phone, 40),
            dob: participantDob,
            primary_club_id: club.id,
          })
          .select('id')
          .maybeSingle();
        masterPlayerId = (created as { id: string } | null)?.id ?? null;
      }

      if (masterPlayerId) {
        await db
          .from('club_program_registrations')
          .update({ master_player_id: masterPlayerId })
          .eq('id', (inserted as { id: string }).id);
      }
    } catch {
      /* the registration is what matters */
    }

    // ---------------------------------------------------------------- email
    const { data: siteRow } = await db
      .from('club_site')
      .select('color_primary, color_secondary, color_ink, color_cream, color_surface, font_choice')
      .eq('club_id', club.id)
      .maybeSingle();
    const theme = resolveTheme(siteRow as Record<string, unknown> | null);

    /*
     * A class with its own checkout keeps it; otherwise it inherits the club's
     * default. Without this a club with five classes was pasting the same
     * Square link five times, and a club that takes cards every day still told
     * parents it would "be in touch about payment".
     */
    const clubPayments = await getClubPayments(club.id);
    const offer = paymentOffer({
      amountCents: registration.amount_cents ?? 0,
      clubPayments,
      surface: 'program',
      ownLink: program.external_payment_url as string | null,
    });

    const emailCtx: ProgramEmailContext = {
      ownerId: club.owner_id,
      clubName: club.name,
      clubSlug: club.slug,
      clubEmail: club.email,
      clubPhone: club.phone,
      timeZone: club.timezone || 'America/Los_Angeles',
      accent: theme.primary,
      // The resolved link, not the raw class field — so a club default reaches
      // the confirmation email too.
      program: {
        ...(program as Record<string, unknown>),
        external_payment_url: offer.kind === 'link' ? offer.url : null,
      } as never,
      registration,
    };

    let emailed = false;
    let emailNote: string | null = null;
    try {
      const result =
        status === 'waitlist'
          ? await sendProgramWaitlist(emailCtx, enrolled === 0 ? 0 : enrolled - (capacity ?? 0) + 1)
          : await sendProgramConfirmation(emailCtx);
      emailed = !!result?.sent;
    } catch (err) {
      // Out of email credits, or Resend refused. The spot is taken either way;
      // saying "registration failed" would make the parent sign up twice.
      emailNote =
        err instanceof CreditLimitError
          ? 'Registered, but the confirmation email could not be sent.'
          : 'Registered, but the confirmation email could not be sent.';
    }

    const sessions = programSessions(program as never, emailCtx.timeZone);

    return NextResponse.json({
      ok: true,
      registration_id: registration.id,
      status,
      sessions: sessions.count,
      payment:
        offer.kind === 'link'
          ? { kind: 'link', url: offer.url, label: offer.label, note: offer.note }
          : { kind: offer.kind },
      emailed,
      ...(emailNote ? { warning: emailNote } : {}),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Something went wrong.' },
      { status: 500 },
    );
  }
}

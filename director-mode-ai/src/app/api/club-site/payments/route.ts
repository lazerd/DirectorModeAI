/**
 * GET / PATCH how the club gets paid.
 *
 * One link, covering class sign-ups and court bookings, instead of pasting the
 * same Square URL onto every class. The processor-connection slot is reported
 * as it actually is — there is no OAuth app yet, so the response says so rather
 * than offering a button that quietly does nothing.
 */

import { NextResponse } from 'next/server';
import { requireStaffForClub } from '@/lib/courtsheet/routeAuth';
import { isPaymentLink } from '@/config/payments';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s.length ? s : null))
    .nullable()
    .optional();

const patchSchema = z
  .object({
    payment_link: z
      .string()
      .trim()
      .transform((s) => (s.length ? s : null))
      .nullable()
      .optional()
      .refine(
        (s) => s == null || isPaymentLink(s),
        'That does not look like a payment link — it needs to start with https://',
      ),
    payment_link_label: optionalText(40),
    payment_note: optionalText(300),
    link_on_programs: z.boolean().optional(),
    link_on_courts: z.boolean().optional(),
  })
  .strict();

/**
 * Whether a per-club processor connection is even possible yet.
 *
 * Driven by env, so the screen tells the truth in every environment instead of
 * hardcoding "coming soon" that somebody has to remember to delete.
 */
function providerAvailability() {
  return {
    square: Boolean(process.env.SQUARE_OAUTH_APP_ID && process.env.SQUARE_OAUTH_APP_SECRET),
    stripe: Boolean(process.env.STRIPE_CONNECT_CLIENT_ID),
  };
}

export async function GET() {
  const ctx = await requireStaffForClub();
  if ('error' in ctx) return ctx.error;

  const { data } = await ctx.db
    .from('club_payments')
    .select('*')
    .eq('club_id', ctx.club.id)
    .maybeSingle();

  // How much is actually waiting to be collected, so the screen is worth
  // opening rather than being a settings page nobody visits.
  const [{ data: progRows }, { data: courtRows }] = await Promise.all([
    ctx.db
      .from('club_program_registrations')
      .select('amount_cents')
      .eq('club_id', ctx.club.id)
      .eq('payment_status', 'pending')
      .neq('status', 'cancelled'),
    ctx.db
      .from('court_bookings')
      .select('amount_cents')
      .eq('club_id', ctx.club.id)
      .eq('payment_status', 'pending')
      .eq('status', 'booked'),
  ]);

  const sum = (rows: { amount_cents: number | null }[] | null) =>
    (rows ?? []).reduce((n, r) => n + (r.amount_cents || 0), 0);

  /*
   * Is the club charging for things it has no way to collect?
   *
   * This is the gap that is invisible from either end. A club sets a $24
   * public court rate, never pastes a payment link, and every booking
   * confirmation quietly reads "settle up at the desk" — so the club believes
   * it is selling court time online and is in fact taking unpaid
   * reservations. Nothing on any screen said so.
   */
  const link = (data as { payment_link?: string | null } | null)?.payment_link || '';
  const haveCheckout = isPaymentLink(link.trim());

  const [{ data: paidRates }, { count: paidClasses }] = await Promise.all([
    ctx.db
      .from('court_rate_cards')
      .select('price_cents')
      .eq('club_id', ctx.club.id)
      .eq('active', true)
      .gt('price_cents', 0)
      .limit(1),
    ctx.db
      .from('club_programs')
      .select('id', { count: 'exact', head: true })
      .eq('club_id', ctx.club.id)
      .eq('status', 'published')
      .gt('price_cents', 0),
  ]);

  return NextResponse.json({
    payments: data ?? null,
    providers: providerAvailability(),
    outstanding: {
      programs_cents: sum(progRows as { amount_cents: number | null }[] | null),
      courts_cents: sum(courtRows as { amount_cents: number | null }[] | null),
    },
    selling: {
      /** Charging for court time with nowhere to send people to pay. */
      courts_unpaid: !haveCheckout && ((paidRates as unknown[] | null)?.length ?? 0) > 0,
      /** Same, for published classes with a price on them. */
      classes_unpaid: !haveCheckout && (paidClasses ?? 0) > 0,
    },
    club: { slug: ctx.club.slug, name: ctx.club.name },
  });
}

export async function PATCH(req: Request) {
  const ctx = await requireStaffForClub({ requireWrite: true });
  if ('error' in ctx) return ctx.error;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: first?.message || 'That is not valid.' },
      { status: 400 },
    );
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(body as Record<string, unknown>)) {
    if (!(key in parsed.data)) continue;
    patch[key] = (parsed.data as Record<string, unknown>)[key];
  }

  const { data, error } = await ctx.db
    .from('club_payments')
    .upsert({ club_id: ctx.club.id, ...patch }, { onConflict: 'club_id' })
    .select('*')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, payments: data });
}

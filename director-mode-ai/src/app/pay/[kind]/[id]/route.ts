/**
 * GET /pay/<program|court>/<id> — "Pay now" for a class sign-up or a court
 * booking at a club that has connected Square.
 *
 * The link in pages and emails is this stable URL, not a Square link: the
 * checkout is made on the click, on the CLUB's own Square account, for exactly
 * what is still owed. Paid already, cancelled, or free → no checkout, just say
 * so. No login: the id is an unguessable uuid, and all it can do is let
 * someone pay.
 */
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { appBase, openCheckout, type PayKind } from '@/lib/squareConnect';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const done = (q: string) => NextResponse.redirect(`${appBase()}/pay/${kind}/${id}/done?${q}`);
  if ((kind !== 'program' && kind !== 'court') || !UUID.test(id)) return done('s=notfound');

  const db = getSupabaseAdmin();
  let target: {
    clubId: string;
    clubSlug: string;
    amountCents: number;
    paid: boolean;
    cancelled: boolean;
    label: string;
    doneUrl: string;
  } | null = null;

  if (kind === 'program') {
    const { data } = await db
      .from('club_program_registrations')
      .select('id, club_id, amount_cents, payment_status, status, participant_name, club_programs(title, slug), cc_clubs(slug, name)')
      .eq('id', id)
      .maybeSingle();
    const r = data as any;
    if (r) {
      target = {
        clubId: r.club_id,
        clubSlug: r.cc_clubs?.slug,
        amountCents: r.amount_cents ?? 0,
        paid: r.payment_status === 'paid' || r.payment_status === 'waived',
        cancelled: r.status === 'cancelled',
        label: `${r.club_programs?.title ?? 'Class'} — ${r.participant_name ?? ''}`.trim(),
        doneUrl: `${appBase()}/c/${r.cc_clubs?.slug}/programs/${r.club_programs?.slug}/registered?r=${id}`,
      };
    }
  } else {
    const { data } = await db
      .from('court_bookings')
      .select('id, club_id, amount_cents, payment_status, status, booker_name, minutes, cc_clubs(slug, name)')
      .eq('id', id)
      .maybeSingle();
    const b = data as any;
    if (b) {
      target = {
        clubId: b.club_id,
        clubSlug: b.cc_clubs?.slug,
        amountCents: b.amount_cents ?? 0,
        paid: b.payment_status === 'paid' || b.payment_status === 'waived',
        cancelled: b.status === 'cancelled',
        label: `${b.cc_clubs?.name ?? 'Court'} — ${b.minutes ?? ''} min court booking (${b.booker_name ?? ''})`,
        doneUrl: `${appBase()}/pay/court/${id}/done`,
      };
    }
  }

  if (!target) return done('s=notfound');
  if (target.paid) return done('s=paid');
  if (target.cancelled) return done('s=cancelled');
  if (target.amountCents <= 0) return done('s=free');

  try {
    const url = await openCheckout({
      kind: kind as PayKind,
      id,
      clubId: target.clubId,
      amountCents: target.amountCents,
      paid: false,
      label: target.label,
      doneUrl: target.doneUrl,
    });
    return NextResponse.redirect(url);
  } catch (e) {
    console.error('[pay] could not open checkout', kind, id, e);
    return done('s=unavailable');
  }
}

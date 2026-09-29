/**
 * Releasing quad spots whose payment window lapsed.
 *
 * Deliberately NOT dependent on cron timing for correctness: Vercel Hobby caps
 * crons at once a day, which is coarser than the 24-hour payment window. The
 * director's Entries tab computes overdue holds from `payment_due_at` on every
 * render and offers a one-click release, and this sweep runs daily as a
 * backstop so a forgotten invite can't hold a spot forever.
 *
 * A paid entry is never released, no matter how late the payment landed —
 * money in the door beats the clock, and the director can sort out the
 * overflow by hand.
 */

import { sendQuadInviteExpiredEmail } from './quadEmails';
import { squareConfigured, getOrder } from './square';

export type ExpiryResult = {
  expired: number;
  emailed: number;
  entries: Array<{ id: string; player_name: string; event_id: string }>;
};

export async function expireOverdueQuadInvites(
  admin: any,
  opts: { eventId?: string; origin: string; notify?: boolean }
): Promise<ExpiryResult> {
  const nowIso = new Date().toISOString();

  let query = admin
    .from('quad_entries')
    .select(
      'id, event_id, player_name, player_email, parent_email, division, payment_due_at, square_order_id'
    )
    .eq('position', 'pending_payment')
    .neq('payment_status', 'paid')
    .neq('payment_status', 'waived')
    .not('payment_due_at', 'is', null)
    .lt('payment_due_at', nowIso);
  if (opts.eventId) query = query.eq('event_id', opts.eventId);

  const { data } = await query;
  const candidates = (data as any[]) || [];

  // Ask Square before releasing anyone. The webhook is what normally marks an
  // entry paid, and if a delivery is ever missed (it was, for the whole of the
  // Dunkin' Quads invite window) the row still reads unpaid. A paid order gets
  // settled here instead of expired; if Square can't be reached we keep the
  // hold rather than guess, and the director can still release it by hand.
  const overdue: any[] = [];
  for (const entry of candidates) {
    if (entry.square_order_id && squareConfigured()) {
      let order: any;
      try {
        order = await getOrder(entry.square_order_id);
      } catch {
        continue;
      }
      const paid =
        (order?.tenders?.length ?? 0) > 0 && (order?.net_amount_due_money?.amount ?? 1) === 0;
      if (paid) {
        await admin
          .from('quad_entries')
          .update({
            payment_status: 'paid',
            amount_paid_cents: order?.total_money?.amount ?? null,
            position: 'in_flight',
          })
          .eq('id', entry.id);
        continue;
      }
    }
    overdue.push(entry);
  }
  if (overdue.length === 0) return { expired: 0, emailed: 0, entries: [] };

  await admin
    .from('quad_entries')
    .update({ position: 'expired' })
    .in(
      'id',
      overdue.map((e) => e.id)
    );

  let emailed = 0;
  if (opts.notify !== false) {
    // Event names/slugs for the notice — one fetch, not one per entry.
    const eventIds = [...new Set(overdue.map((e) => e.event_id))];
    const { data: evRows } = await admin
      .from('events')
      .select('id, name, slug, divisions')
      .in('id', eventIds);
    const eventById = new Map(((evRows as any[]) || []).map((e) => [e.id, e]));

    const { parseDivisions, divisionLabel } = await import('./quadDivisions');

    for (const entry of overdue) {
      const ev = eventById.get(entry.event_id);
      const recipient = entry.parent_email || entry.player_email;
      if (!ev || !recipient) continue;
      try {
        await sendQuadInviteExpiredEmail({
          to: recipient,
          playerName: entry.player_name,
          tournamentName: ev.name,
          divisionLabel: divisionLabel(parseDivisions(ev.divisions), entry.division),
          publicUrl: `${opts.origin}/quads/${ev.slug}`,
        });
        emailed += 1;
      } catch (err) {
        console.error('quad expiry email failed:', err);
      }
    }
  }

  return {
    expired: overdue.length,
    emailed,
    entries: overdue.map((e) => ({
      id: e.id,
      player_name: e.player_name,
      event_id: e.event_id,
    })),
  };
}

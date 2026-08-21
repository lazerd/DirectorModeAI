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
    .select('id, event_id, player_name, player_email, parent_email, division, payment_due_at')
    .eq('position', 'pending_payment')
    .neq('payment_status', 'paid')
    .neq('payment_status', 'waived')
    .not('payment_due_at', 'is', null)
    .lt('payment_due_at', nowIso);
  if (opts.eventId) query = query.eq('event_id', opts.eventId);

  const { data } = await query;
  const overdue = (data as any[]) || [];
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

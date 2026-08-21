/**
 * POST /api/quads/events/[id]/invite
 *
 * Director-only. Accepts a set of 'requested' entries into the event and gives
 * each one a Square payment link with a hard deadline (24h by default). The
 * entry only becomes confirmed when the Square webhook sees the payment —
 * see /api/webhooks/square.
 *
 * Body: { entry_ids: string[], hours?: number }
 * Returns: { sent, failed, deadline, results: [{entry_id, ok, error?}] }
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { squareConfigured, createEntryPaymentLink } from '@/lib/square';
import { sendQuadInviteEmail, sendQuadCompConfirmedEmail } from '@/lib/quadEmails';
import { discountedCents } from '@/lib/quadCoupons';
import { parseDivisions, divisionLabel, formatDeadline } from '@/lib/quadDivisions';
import { formatTimeDisplay } from '@/lib/quads';

const DEFAULT_HOURS = 24;
const MAX_BATCH = 64;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await params;

  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const entryIds: string[] = Array.isArray(body.entry_ids)
    ? body.entry_ids.filter((x: unknown) => typeof x === 'string').slice(0, MAX_BATCH)
    : [];
  if (entryIds.length === 0) {
    return NextResponse.json({ error: 'No entries selected.' }, { status: 400 });
  }
  const hours =
    typeof body.hours === 'number' && body.hours > 0 && body.hours <= 336
      ? body.hours
      : DEFAULT_HOURS;

  const admin = getSupabaseAdmin();

  const { data: ev } = await admin
    .from('events')
    .select(
      'id, name, slug, user_id, event_date, start_time, end_time, venue, entry_fee_cents, divisions, external_payment_url'
    )
    .eq('id', eventId)
    .maybeSingle();
  if (!ev) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  const e = ev as any;
  if (e.user_id !== user.id) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const fee = e.entry_fee_cents ?? 0;
  if (fee > 0 && !squareConfigured() && !e.external_payment_url) {
    return NextResponse.json(
      { error: 'No payment rail configured — set SQUARE_ACCESS_TOKEN or an external payment URL.' },
      { status: 400 }
    );
  }

  const { data: entryRows } = await admin
    .from('quad_entries')
    .select(
      'id, player_name, player_email, parent_email, division, position, payment_status, payment_url, coupon_code, discount_percent'
    )
    .eq('event_id', eventId)
    .in('id', entryIds);

  const entries = (entryRows as any[]) || [];
  const divisions = parseDivisions(e.divisions);

  const origin = new URL(request.url).origin;
  const deadlineIso = new Date(Date.now() + hours * 3600_000).toISOString();
  const deadlineLabel = formatDeadline(deadlineIso);

  const dateLabel = e.event_date
    ? new Date(e.event_date + 'T00:00:00').toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        timeZone: 'America/Los_Angeles',
      })
    : 'date TBD';
  const timeLabel = e.start_time
    ? `${formatTimeDisplay(e.start_time)}${e.end_time ? ` – ${formatTimeDisplay(e.end_time)}` : ''}`
    : 'time TBD';
  const feeLabel = fee > 0 ? `$${(fee / 100).toFixed(0)}` : 'Free';

  const results: Array<{ entry_id: string; ok: boolean; error?: string }> = [];

  for (const entry of entries) {
    // Already confirmed — don't re-invite or double-charge.
    if (entry.payment_status === 'paid' || entry.position === 'in_flight') {
      results.push({ entry_id: entry.id, ok: false, error: 'already confirmed' });
      continue;
    }

    try {
      // A full comp has nothing to charge — seat them outright and send a
      // plain confirmation instead of a payment link.
      const owed = discountedCents(fee, entry.discount_percent ?? null);
      if (owed <= 0) {
        await admin
          .from('quad_entries')
          .update({
            position: 'in_flight',
            payment_status: 'waived',
            invited_at: new Date().toISOString(),
            payment_due_at: null,
          })
          .eq('id', entry.id);

        const compRecipient = entry.parent_email || entry.player_email;
        if (compRecipient) {
          await sendQuadCompConfirmedEmail({
            to: compRecipient,
            playerName: entry.player_name,
            tournamentName: e.name,
            divisionLabel: divisionLabel(divisions, entry.division),
            dateLabel,
            timeLabel,
            venue: e.venue ?? null,
            couponCode: entry.coupon_code ?? null,
          });
          results.push({ entry_id: entry.id, ok: true });
        } else {
          results.push({ entry_id: entry.id, ok: false, error: 'no email on file (seated anyway)' });
        }
        continue;
      }

      let paymentUrl = e.external_payment_url || null;
      let orderId: string | null = null;
      let paymentLinkId: string | null = null;

      if (owed > 0 && squareConfigured()) {
        // Idempotency key inside createEntryPaymentLink is `entry-<id>`, so a
        // re-invite returns the SAME Square link rather than a second charge.
        const link = await createEntryPaymentLink({
          entryId: entry.id,
          amountCents: owed,
          name: `Entry: ${e.name}`,
          buyerEmail: entry.parent_email || entry.player_email || null,
          redirectUrl: `${origin}/quads/${e.slug}/registered?entry=${entry.id}`,
        });
        paymentUrl = link.url;
        orderId = link.orderId;
        paymentLinkId = link.paymentLinkId;
      }

      await admin
        .from('quad_entries')
        .update({
          position: 'pending_payment',
          payment_status: 'pending',
          invited_at: new Date().toISOString(),
          payment_due_at: deadlineIso,
          payment_url: paymentUrl,
          ...(orderId ? { square_order_id: orderId } : {}),
          ...(paymentLinkId ? { square_payment_link_id: paymentLinkId } : {}),
        })
        .eq('id', entry.id);

      const recipient = entry.parent_email || entry.player_email;
      if (recipient && paymentUrl) {
        await sendQuadInviteEmail({
          to: recipient,
          playerName: entry.player_name,
          tournamentName: e.name,
          divisionLabel: divisionLabel(divisions, entry.division),
          dateLabel,
          timeLabel,
          venue: e.venue ?? null,
          feeLabel: `$${(owed / 100).toFixed(0)}`,
          deadlineLabel,
          paymentUrl,
        });
        results.push({ entry_id: entry.id, ok: true });
      } else {
        results.push({
          entry_id: entry.id,
          ok: false,
          error: recipient ? 'no payment link' : 'no email on file',
        });
      }
    } catch (err: any) {
      results.push({ entry_id: entry.id, ok: false, error: err?.message || 'failed' });
    }
  }

  return NextResponse.json({
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    deadline: deadlineIso,
    deadline_label: deadlineLabel,
    results,
  });
}

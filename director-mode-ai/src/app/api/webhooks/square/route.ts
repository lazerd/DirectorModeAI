/**
 * POST /api/webhooks/square
 *
 * Receives Square payment webhooks and marks the matching tournament entry
 * paid. Security: we do NOT trust the payload — we re-fetch the payment from
 * the Square API (authenticated) and confirm it's COMPLETED, then map it to
 * the entry via the order's reference_id (= our entry id). A forged webhook
 * with a fake payment id fails the API fetch and is ignored.
 *
 * Subscribe this URL in Square to: payment.created, payment.updated.
 */
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { squareConfigured, getPayment, getOrder } from '@/lib/square';

export async function POST(request: Request) {
  try {
    if (!squareConfigured()) {
      return NextResponse.json({ error: 'Square not configured' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const type: string = body?.type || '';
    const paymentId: string | undefined =
      body?.data?.object?.payment?.id || body?.data?.id;

    // Only act on payment events; ack everything else so Square stops retrying.
    if (!paymentId || !type.startsWith('payment')) {
      return NextResponse.json({ ignored: true });
    }

    // Re-fetch from Square (authenticated) — this is the trust boundary.
    let payment: any;
    try {
      payment = await getPayment(paymentId);
    } catch {
      // Unknown/forged payment id — ack without doing anything.
      return NextResponse.json({ ignored: true });
    }
    if (!payment || payment.status !== 'COMPLETED') {
      return NextResponse.json({ pending: true });
    }

    // Map payment → entry. Prefer the order's reference_id (our entry id);
    // fall back to matching the stored square_order_id on the entry.
    const orderId: string | undefined = payment.order_id;
    let entryId: string | null = null;
    if (orderId) {
      try {
        const order = await getOrder(orderId);
        if (order?.reference_id) entryId = order.reference_id;
      } catch {
        /* fall through to order-id lookup */
      }
    }

    const admin = getSupabaseAdmin();
    let query = admin
      .from('tournament_entries')
      .select('id, payment_status, position, event_id');
    query = entryId ? query.eq('id', entryId) : query.eq('square_order_id', orderId || '__none__');
    const { data: entry } = await query.maybeSingle();
    if (!entry) return NextResponse.json({ ignored: true, reason: 'no matching entry' });

    if ((entry as any).payment_status !== 'paid') {
      // Also promote a pending_payment entry into the draw (or waitlist if the
      // event is capped and full) — otherwise a parent who closes the tab
      // before redirect gets marked paid but never lands in the director's draw.
      let newPosition = (entry as any).position;
      if (newPosition === 'pending_payment') {
        newPosition = 'in_draw';
        const { data: ev } = await admin
          .from('events')
          .select('max_players')
          .eq('id', (entry as any).event_id)
          .maybeSingle();
        const cap = (ev as any)?.max_players;
        if (cap && cap > 0) {
          const { count } = await admin
            .from('tournament_entries')
            .select('*', { count: 'exact', head: true })
            .eq('event_id', (entry as any).event_id)
            .eq('position', 'in_draw')
            .neq('id', (entry as any).id);
          if ((count ?? 0) >= cap) newPosition = 'waitlist';
        }
      }
      await admin
        .from('tournament_entries')
        .update({
          payment_status: 'paid',
          amount_paid_cents: payment.amount_money?.amount ?? null,
          position: newPosition,
        })
        .eq('id', (entry as any).id);
    }

    return NextResponse.json({ ok: true, entry_id: (entry as any).id });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 });
  }
}

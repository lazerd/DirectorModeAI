/**
 * POST /api/webhooks/square
 *
 * Receives Square payment webhooks and marks the matching entry paid — either
 * a tournament_entries row or a quad_entries row (Quads events use the same
 * reference_id = entry id convention). Security: we do NOT trust the payload — we re-fetch the payment from
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

    // The reference_id could belong to either product. Try tournaments first,
    // then quads. `seatedPosition` is the table's own "in the event" value.
    const findEntry = async (table: 'tournament_entries' | 'quad_entries') => {
      let q = admin.from(table).select('id, payment_status, position, event_id');
      q = entryId ? q.eq('id', entryId) : q.eq('square_order_id', orderId || '__none__');
      const { data } = await q.maybeSingle();
      return data as any;
    };

    let table: 'tournament_entries' | 'quad_entries' = 'tournament_entries';
    let entry = await findEntry('tournament_entries');
    if (!entry) {
      entry = await findEntry('quad_entries');
      table = 'quad_entries';
    }
    if (!entry) return NextResponse.json({ ignored: true, reason: 'no matching entry' });

    const seatedPosition = table === 'quad_entries' ? 'in_flight' : 'in_draw';

    if ((entry as any).payment_status !== 'paid') {
      // Also promote a pending_payment entry into the draw (or waitlist if the
      // event is capped and full) — otherwise a parent who closes the tab
      // before redirect gets marked paid but never lands in the director's draw.
      let newPosition = (entry as any).position;
      if (newPosition === 'pending_payment') {
        newPosition = seatedPosition;
        const { data: ev } = await admin
          .from('events')
          .select('max_players')
          .eq('id', (entry as any).event_id)
          .maybeSingle();
        const cap = (ev as any)?.max_players;
        if (cap && cap > 0) {
          const { count } = await admin
            .from(table)
            .select('*', { count: 'exact', head: true })
            .eq('event_id', (entry as any).event_id)
            .eq('position', seatedPosition)
            .neq('id', (entry as any).id);
          if ((count ?? 0) >= cap) newPosition = 'waitlist';
        }
      }
      await admin
        .from(table)
        .update({
          payment_status: 'paid',
          amount_paid_cents: payment.amount_money?.amount ?? null,
          position: newPosition,
        })
        .eq('id', (entry as any).id);
    }

    return NextResponse.json({ ok: true, table, entry_id: (entry as any).id });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 });
  }
}

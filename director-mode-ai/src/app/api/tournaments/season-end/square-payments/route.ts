/**
 * GET /api/tournaments/season-end/square-payments — READ-ONLY reconciliation
 * helper. Lists completed Square payments in a date window and enriches each
 * with its order's line-item names + reference_id, so we can match who actually
 * paid the season-end entry fee back to the current roster by buyer email +
 * division. Writes nothing. Auth: Bearer CRON_SECRET.
 *
 *   /api/tournaments/season-end/square-payments?begin=2026-06-01
 */
import { NextResponse } from 'next/server';
import { squareConfigured, getLocationId } from '@/lib/square';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function sq(path: string, init?: RequestInit): Promise<any> {
  const base =
    (process.env.SQUARE_ENVIRONMENT || 'production').toLowerCase() === 'sandbox'
      ? 'https://connect.squareupsandbox.com'
      : 'https://connect.squareup.com';
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'Square-Version': '2024-07-17',
      Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.errors?.[0]?.detail || `Square ${res.status}`);
  return data;
}

export async function GET(request: Request) {
  const auth = request.headers.get('authorization') || '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!squareConfigured()) {
    return NextResponse.json({ error: 'Square not configured on this deployment' }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const begin = searchParams.get('begin') || '2026-06-01T00:00:00Z';

  try {
    const locationId = await getLocationId();

    // 1) List all payments in the window (paginate).
    const payments: any[] = [];
    let cursor: string | undefined;
    do {
      const qs = new URLSearchParams({
        begin_time: begin,
        location_id: locationId,
        sort_order: 'ASC',
        limit: '100',
      });
      if (cursor) qs.set('cursor', cursor);
      const data = await sq(`/v2/payments?${qs.toString()}`, { method: 'GET' });
      for (const p of data.payments || []) payments.push(p);
      cursor = data.cursor;
    } while (cursor);

    // 2) Batch-retrieve the orders behind them (for line-item names + reference_id).
    const orderIds = Array.from(new Set(payments.map((p) => p.order_id).filter(Boolean)));
    const orderById = new Map<string, any>();
    for (let i = 0; i < orderIds.length; i += 100) {
      const chunk = orderIds.slice(i, i + 100);
      const data = await sq('/v2/orders/batch-retrieve', {
        method: 'POST',
        body: JSON.stringify({ order_ids: chunk }),
      });
      for (const o of data.orders || []) orderById.set(o.id, o);
    }

    const rows = payments.map((p) => {
      const o = p.order_id ? orderById.get(p.order_id) : null;
      return {
        payment_id: p.id,
        order_id: p.order_id || null,
        status: p.status, // COMPLETED / APPROVED / FAILED / CANCELED
        amount_cents: p.amount_money?.amount ?? null,
        currency: p.amount_money?.currency ?? null,
        buyer_email: p.buyer_email_address || o?.fulfillments?.[0]?.shipment_details?.recipient?.email_address || null,
        created_at: p.created_at,
        reference_id: o?.reference_id || null,
        line_items: (o?.line_items || []).map((li: any) => li.name).filter(Boolean),
      };
    });

    return NextResponse.json({
      begin,
      location_id: locationId,
      total_payments: rows.length,
      completed: rows.filter((r) => r.status === 'COMPLETED').length,
      payments: rows,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Square reconcile failed' }, { status: 500 });
  }
}

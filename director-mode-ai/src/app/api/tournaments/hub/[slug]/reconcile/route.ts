/**
 * POST /api/tournaments/hub/[slug]/reconcile — sync entry payment status from
 * Square for every tournament in a hub. Director-only (must own the hub).
 *
 * Matches completed Square payments to the hub's entries by buyer email +
 * division (venues in Square line items are unreliable, so we ignore them), with
 * cross-entry email backfill. Marks confident matches 'paid'; when a division's
 * payment count fully covers its remaining players they're all marked paid too.
 * Never downgrades an existing paid/waived entry, and never guesses which
 * specific player paid when a division is only partly covered. Returns a report.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { squareConfigured, getLocationId } from '@/lib/square';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const norm = (s?: string | null) => (s || '').trim().toLowerCase();
const lastName = (n?: string | null) => norm(n).split(/\s+/).slice(-1)[0] || '';
function divOf(s?: string | null): string {
  s = s || '';
  if (/13\s*&|13 ?& ?Over|13&O|13 & Over/i.test(s)) return '13';
  if (/12U/i.test(s)) return '12U';
  if (/14U/i.test(s)) return '14U';
  if (/10U/i.test(s)) return '10U';
  if (/open/i.test(s)) return 'Open';
  return '?';
}

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

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!squareConfigured()) return NextResponse.json({ error: 'Square not configured' }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { data: evs } = await admin
    .from('events')
    .select('id, name, user_id')
    .eq('hub_slug', slug);
  const events = (evs as { id: string; name: string; user_id: string }[]) || [];
  if (events.length === 0) return NextResponse.json({ error: 'Hub not found' }, { status: 404 });
  if (!events.every((e) => e.user_id === user.id)) {
    return NextResponse.json({ error: 'Not your hub' }, { status: 403 });
  }
  const divByEvent = new Map(events.map((e) => [e.id, divOf(e.name)]));

  const { data: ents } = await admin
    .from('tournament_entries')
    .select('id, event_id, player_name, parent_email, player_email, payment_status')
    .in('event_id', events.map((e) => e.id));
  const entries = (ents as any[]) || [];

  // Email backfill: a kid's email from any of their entries (some entries lack one).
  const emailByName = new Map<string, string>();
  for (const e of entries) {
    const em = norm(e.parent_email) || norm(e.player_email);
    if (em && !emailByName.has(norm(e.player_name))) emailByName.set(norm(e.player_name), em);
  }
  for (const e of entries) {
    e._email = norm(e.parent_email) || norm(e.player_email) || emailByName.get(norm(e.player_name)) || '';
    e._div = divByEvent.get(e.event_id) || '?';
  }

  // Pull completed Square payments + their orders (for line-item names).
  const begin = new URL(request.url).searchParams.get('begin') || '2026-06-01T00:00:00Z';
  const locationId = await getLocationId();
  const payments: any[] = [];
  let cursor: string | undefined;
  do {
    const qs = new URLSearchParams({ begin_time: begin, location_id: locationId, sort_order: 'ASC', limit: '100' });
    if (cursor) qs.set('cursor', cursor);
    const d = await sq(`/v2/payments?${qs.toString()}`, { method: 'GET' });
    for (const p of d.payments || []) payments.push(p);
    cursor = d.cursor;
  } while (cursor);

  const orderIds = Array.from(new Set(payments.map((p) => p.order_id).filter(Boolean)));
  const orderById = new Map<string, any>();
  for (let i = 0; i < orderIds.length; i += 100) {
    const d = await sq('/v2/orders/batch-retrieve', {
      method: 'POST',
      body: JSON.stringify({ order_ids: orderIds.slice(i, i + 100) }),
    });
    for (const o of d.orders || []) orderById.set(o.id, o);
  }

  // Payment → records {email, div, name?}. Multi-kid invoices split by line item.
  const recs: { email: string; div: string; name: string | null }[] = [];
  for (const p of payments.filter((p) => p.status === 'COMPLETED')) {
    const email = norm(p.buyer_email_address);
    const o = p.order_id ? orderById.get(p.order_id) : null;
    const items: string[] = (o?.line_items || []).map((li: any) => li.name).filter(Boolean);
    const named: { name: string; div: string }[] = [];
    for (const it of items) {
      for (const part of it.split(';')) {
        const m = part.match(/^\s*(.+?)\s+[—-]\s+(10U|12U|13.*?|14U|Open)\s+Division entry/i);
        if (m) named.push({ name: m[1].trim(), div: divOf(m[2]) });
      }
    }
    if (named.length) named.forEach((n) => recs.push({ email, div: n.div, name: n.name }));
    else recs.push({ email, div: divOf(items.join(' ')), name: null });
  }

  const used = new Array(recs.length).fill(false);
  const toPay = new Set<string>();
  const find = (pred: (r: any) => boolean) => recs.findIndex((r, i) => !used[i] && pred(r));

  // First, CONSUME the payments belonging to already paid/waived entries so
  // their payment can't be reused to settle a different open player.
  for (const e of entries.filter((x) => x.payment_status === 'paid' || x.payment_status === 'waived')) {
    let i = e._email ? find((r) => r.div === e._div && r.email === e._email) : -1;
    if (i < 0) i = find((r) => r.div === e._div && r.name && lastName(r.name) === lastName(e.player_name));
    if (i >= 0) used[i] = true;
  }

  // Then match the still-open entries against the remaining payments.
  const open = entries.filter((e) => e.payment_status !== 'paid' && e.payment_status !== 'waived');
  for (const e of open) {
    let i = e._email ? find((r) => r.div === e._div && r.email === e._email) : -1;
    if (i < 0) i = find((r) => r.div === e._div && r.name && lastName(r.name) === lastName(e.player_name));
    if (i >= 0) { used[i] = true; e._matched = true; toPay.add(e.id); }
  }
  // Division full-settlement for the rest.
  const stillOpen = open.filter((e) => !e._matched);
  const byDiv: Record<string, any[]> = {};
  for (const e of stillOpen) (byDiv[e._div] ??= []).push(e);
  const leftoverByDiv: Record<string, number[]> = {};
  recs.forEach((r, i) => { if (!used[i]) (leftoverByDiv[r.div] ??= []).push(i); });
  const unresolved: any[] = [];
  for (const [dv, es] of Object.entries(byDiv)) {
    const lo = leftoverByDiv[dv] || [];
    if (lo.length >= es.length) { es.forEach((e, k) => { used[lo[k]] = true; toPay.add(e.id); }); }
    else es.forEach((e) => unresolved.push(e));
  }

  // Apply.
  if (toPay.size > 0) {
    await admin.from('tournament_entries').update({ payment_status: 'paid' }).in('id', Array.from(toPay));
  }

  const nameOf = (id: string) => events.find((e) => e.id === id)?.name || '';
  const leftover = recs.filter((_, i) => !used[i]);
  return NextResponse.json({
    ok: true,
    marked_paid: toPay.size,
    total_entries: entries.length,
    unresolved: unresolved.map((e) => ({ division: e._div, player: e.player_name, draw: nameOf(e.event_id) })),
    extra_payments: leftover.map((r) => ({ division: r.div, email: r.email, name: r.name })),
  });
}

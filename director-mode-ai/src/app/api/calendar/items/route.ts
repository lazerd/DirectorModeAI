import { NextResponse } from 'next/server';
import {
  requireCalendarContext, isAuthError, loadPlan, ITEM_COLUMNS,
} from '@/lib/calendar/server';
import { itemFromCatalog } from '@/lib/calendar/promote';
import { itemOverrides as overrides } from '@/lib/calendar/itemFields';

// POST /api/calendar/items — add an event to a plan.
//
// Two shapes: `{ catalogKey }` seeds every field from the catalog (the "add to
// plan" button in the ideas browser), or a bare `{ title, ... }` for a custom
// event. Both land as the same row so nothing downstream cares which it was.
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const ctx = await requireCalendarContext({ requirePro: true });
  if (isAuthError(ctx)) return ctx.error;

  const body = await req.json().catch(() => null);
  const planId = String(body?.planId || '');
  if (!planId) return NextResponse.json({ error: 'Missing planId.' }, { status: 400 });

  const plan = await loadPlan(ctx.db, ctx.club.id, planId);
  if (!plan) return NextResponse.json({ error: 'Plan not found.' }, { status: 404 });

  // Accept one item or a batch — the AI year builder adds a whole slate at once.
  const requested: any[] = Array.isArray(body.items) ? body.items : [body];
  if (requested.length === 0 || requested.length > 60) {
    return NextResponse.json({ error: 'Add between 1 and 60 events at a time.' }, { status: 400 });
  }

  const rows: Record<string, unknown>[] = [];
  for (const r of requested) {
    const key = typeof r?.catalogKey === 'string' ? r.catalogKey : null;

    if (key) {
      const seeded = itemFromCatalog(key, planId, ctx.club.id);
      if (!seeded) {
        return NextResponse.json({ error: `Unknown event idea "${key}".` }, { status: 400 });
      }
      rows.push({ ...seeded, ...overrides(r) });
      continue;
    }

    const title = String(r?.title ?? '').trim();
    if (!title) return NextResponse.json({ error: 'Every event needs a title.' }, { status: 400 });

    rows.push({
      plan_id: planId,
      club_id: ctx.club.id,
      title: title.slice(0, 200),
      catalog_key: null,
      status: 'idea',
      department: 'tennis',
      audience: [],
      ...overrides(r),
    });
  }

  const { data, error } = await ctx.db.from('calendar_items').insert(rows).select(ITEM_COLUMNS);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ items: data ?? [] });
}

/**
 * Ledger setup for a Clubessential club.
 * GET  → { rosterCount, rosterUpdatedAt, pros, setup, serviceAccount }
 * POST { rosterCsv?, pros?, setup? } → save. A member list replaces the old one.
 * Owner/director only.
 */
import { NextResponse } from 'next/server';
import { proshopCaller, canDecide } from '@/lib/proshop/server';
import { parseRoster } from '@/lib/clubessential/charges';
import { serviceAccountEmail, sheetIdOf } from '@/lib/clubessential/extract';

export const dynamic = 'force-dynamic';

const DEFAULT_SETUP = {
  area: 'Tennis',
  items: { private: 'Member Tennis Lessons', semi: 'Member Tennis Lessons', group: 'Member Tennis Lessons', clinic: 'Member Clinics', other: '' },
  taxExempt: true,
  prices: '',
};

export async function GET() {
  const c = await proshopCaller();
  if (!c.ok) return NextResponse.json({ error: c.error }, { status: c.status });
  const { data } = await c.ctx.db.from('clubessential_ledger').select('roster, roster_updated_at, pros, setup').eq('club_id', c.ctx.clubId).maybeSingle();
  const row = data as any;
  return NextResponse.json({
    rosterCount: Array.isArray(row?.roster) ? row.roster.length : 0,
    rosterUpdatedAt: row?.roster_updated_at ?? null,
    pros: row?.pros ?? [],
    setup: { ...DEFAULT_SETUP, ...(row?.setup ?? {}), items: { ...DEFAULT_SETUP.items, ...(row?.setup?.items ?? {}) } },
    serviceAccount: serviceAccountEmail(),
    canEdit: canDecide(c.ctx),
  });
}

export async function POST(req: Request) {
  const c = await proshopCaller();
  if (!c.ok) return NextResponse.json({ error: c.error }, { status: c.status });
  if (!canDecide(c.ctx)) return NextResponse.json({ error: 'Only the owner or director can change this.' }, { status: 403 });
  const body = await req.json().catch(() => null);
  const patch: Record<string, unknown> = { club_id: c.ctx.clubId, updated_at: new Date().toISOString() };

  if (typeof body?.rosterCsv === 'string') {
    const r = parseRoster(body.rosterCsv);
    if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
    patch.roster = r.members;
    patch.roster_updated_at = new Date().toISOString();
  }
  if (Array.isArray(body?.pros)) {
    const pros = body.pros.slice(0, 40).map((p: any) => ({
      name: String(p?.name ?? '').trim().slice(0, 60),
      sheet: String(p?.sheet ?? '').trim().slice(0, 300),
      employee: String(p?.employee ?? '').trim().slice(0, 80),
    })).filter((p: any) => p.name);
    const bad = pros.find((p: any) => p.sheet && !sheetIdOf(p.sheet));
    if (bad) return NextResponse.json({ error: `${bad.name}'s sheet link isn't a Google Sheets link.` }, { status: 400 });
    patch.pros = pros;
  }
  if (body?.setup && typeof body.setup === 'object') {
    const s = body.setup;
    const items: Record<string, string> = {};
    for (const k of ['private', 'semi', 'group', 'clinic', 'other']) items[k] = String(s?.items?.[k] ?? '').trim().slice(0, 80);
    patch.setup = { area: String(s.area ?? 'Tennis').trim().slice(0, 60), items, taxExempt: s.taxExempt !== false, prices: String(s.prices ?? '').slice(0, 400) };
  }
  const { error } = await c.ctx.db.from('clubessential_ledger').upsert(patch, { onConflict: 'club_id' });
  if (error) return NextResponse.json({ error: "Couldn't save that." }, { status: 500 });
  return NextResponse.json({ ok: true, rosterCount: Array.isArray(patch.roster) ? (patch.roster as unknown[]).length : undefined });
}

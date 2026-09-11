/**
 * GET   /api/maintenance/settings — digest on/off and who receives it.
 * PATCH /api/maintenance/settings { digest_enabled } — owner / director.
 */
import { NextResponse } from 'next/server';
import { requireMaintenanceContext, isAuthError, bad } from '@/lib/maintenance/server';
import { crewOf, namesFor } from '@/lib/maintenance/load';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await requireMaintenanceContext({ manage: true });
  if (isAuthError(ctx)) return ctx.error;
  const [{ data: settings }, crew] = await Promise.all([
    ctx.db.from('maint_settings').select('digest_enabled').eq('club_id', ctx.club.id).maybeSingle(),
    crewOf(ctx.db, ctx.club.id),
  ]);
  const names = await namesFor(ctx.db, crew);
  return NextResponse.json({
    digest_enabled: (settings as { digest_enabled: boolean } | null)?.digest_enabled ?? true,
    crew: crew.map((id) => ({ id, name: names[id] || 'Crew member' })),
  });
}

export async function PATCH(req: Request) {
  const ctx = await requireMaintenanceContext({ manage: true });
  if (isAuthError(ctx)) return ctx.error;
  const body = (await req.json().catch(() => ({}))) as { digest_enabled?: unknown };
  if (typeof body.digest_enabled !== 'boolean') return bad('digest_enabled must be true or false.');
  const { error } = await ctx.db
    .from('maint_settings')
    .upsert({ club_id: ctx.club.id, digest_enabled: body.digest_enabled, updated_at: new Date().toISOString() }, { onConflict: 'club_id' });
  if (error) return bad(error.message, 500);
  return NextResponse.json({ ok: true, digest_enabled: body.digest_enabled });
}

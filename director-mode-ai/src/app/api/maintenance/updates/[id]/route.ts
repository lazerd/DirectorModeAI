/**
 * DELETE /api/maintenance/updates/[id] — its author, or a manager.
 */
import { NextResponse } from 'next/server';
import { requireMaintenanceContext, isAuthError, bad } from '@/lib/maintenance/server';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const ctx = await requireMaintenanceContext();
  if (isAuthError(ctx)) return ctx.error;
  const { data: row } = await ctx.db.from('maint_updates').select('id, author_id').eq('id', id).eq('club_id', ctx.club.id).maybeSingle();
  if (!row) return bad('Not found.', 404);
  if ((row as { author_id: string | null }).author_id !== ctx.user.id && !ctx.canManage) {
    return bad('Only whoever wrote it, or a manager, can delete a note.', 403);
  }
  await ctx.db.from('maint_updates').delete().eq('id', id).eq('club_id', ctx.club.id);
  return NextResponse.json({ ok: true });
}

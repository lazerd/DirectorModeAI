/**
 * GET /api/maintenance/board — everything the Today screen needs in one call
 * (the crew are on phones; one round trip beats five).
 */
import { NextResponse } from 'next/server';
import { requireMaintenanceContext, isAuthError } from '@/lib/maintenance/server';
import { crewOf, loadBoardData, namesFor } from '@/lib/maintenance/load';
import { buildInsights } from '@/lib/maintenance/insights';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await requireMaintenanceContext();
  if (isAuthError(ctx)) return ctx.error;

  const data = await loadBoardData(ctx.db, ctx.club.id, ctx.today, ctx.nowHHMM);
  const crew = await crewOf(ctx.db, ctx.club.id);
  const names = await namesFor(ctx.db, [
    ...data.checks.map((c) => c.done_by),
    ...data.tasks.flatMap((t) => [t.created_by, t.started_by]),
    ...data.recentDone.flatMap((t) => [t.created_by, t.completed_by]),
  ]);

  return NextResponse.json({
    today: ctx.today,
    nowHHMM: ctx.nowHHMM,
    club: { id: ctx.club.id, name: ctx.club.name, timezone: ctx.club.timezone },
    me: { id: ctx.user.id, role: ctx.role, canManage: ctx.canManage, isCrew: ctx.isCrew },
    items: data.items,
    checks: data.checks,
    checklist: data.checklist,
    missedYesterday: data.missedYesterday,
    tasks: data.tasks,
    recentDone: data.recentDone,
    projects: data.projects,
    insights: ctx.canManage
      ? buildInsights({ items: data.items, checks: data.checks, tasks: data.tasks, projects: data.projects, today: ctx.today })
      : [],
    crewCount: crew.length,
    names,
  });
}

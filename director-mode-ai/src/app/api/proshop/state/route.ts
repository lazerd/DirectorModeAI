/**
 * Everything the /proshop page shows for the caller's club, in one read:
 * the staff and plays, the board (orders, proposals, huddle, letter, stats),
 * each staff member's "Right now" lines, and this month's spend vs the club's own cap.
 * The page fetches this on load, after each action and when the tab regains focus
 * (no polling: keep server work per request small).
 */
import { NextResponse } from 'next/server';
import { proshopCaller, canDecide, taskOut } from '@/lib/proshop/server';
import { STAFF, PLAYS, HINTS } from '@/lib/proshop/staff';
import { monthSpendCents, monthlyLimitCents, sendBilling } from '@/lib/usageMeter';

export const dynamic = 'force-dynamic';

export async function GET() {
  const c = await proshopCaller();
  if (!c.ok) return NextResponse.json({ error: c.error }, { status: c.status });
  const { ctx } = c;

  const [tasks, board, agents, billing] = await Promise.all([
    ctx.db.from('proshop_tasks').select('*').eq('club_id', ctx.clubId).order('created_at', { ascending: false }).limit(200),
    ctx.db.from('proshop_board').select('key, data').eq('club_id', ctx.clubId),
    ctx.db.from('proshop_agents').select('agent, now_lines').eq('club_id', ctx.clubId),
    sendBilling(ctx.userId),
  ]);
  const [spentCents, limitCents] = await Promise.all([
    monthSpendCents(billing.billingUserId),
    monthlyLimitCents(billing.billingUserId),
  ]);

  const boardMap: Record<string, unknown> = {};
  for (const r of (board.data as { key: string; data: unknown }[] | null) ?? []) boardMap[r.key] = r.data;
  const now: Record<string, string[]> = {};
  for (const r of (agents.data as { agent: string; now_lines: unknown }[] | null) ?? []) {
    if (Array.isArray(r.now_lines)) now[r.agent] = r.now_lines.map(String).slice(0, 4);
  }

  return NextResponse.json({
    club: { id: ctx.clubId, name: ctx.clubName, role: ctx.role, canDecide: canDecide(ctx) },
    staff: STAFF,
    plays: PLAYS,
    hints: HINTS,
    tasks: ((tasks.data as Record<string, any>[] | null) ?? []).map(taskOut),
    board: boardMap,
    now,
    usage: {
      spentCents,
      limitCents,
      exempt: billing.exempt,
      isOwner: billing.billingUserId === ctx.userId,
    },
  });
}

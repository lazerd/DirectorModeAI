/**
 * Season email timeline.
 *   GET ?team_id=… — every scheduled and already-sent email for the season,
 *   with the exact subject line, audience size, and the moment it goes out.
 */
import { NextResponse } from 'next/server';
import { requireTeam, isError } from '@/lib/captain/server';
import { loadTeamEmailContext, timelineFor, MATCH_COLUMNS } from '@/lib/captain/timelineSend';
import { EMAIL_KINDS, KIND_META } from '@/lib/captain/timeline';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const teamId = new URL(req.url).searchParams.get('team_id');
  if (!teamId) return NextResponse.json({ error: 'team_id is required.' }, { status: 400 });

  const ctx = await requireTeam(teamId);
  if (isError(ctx)) return ctx.error;
  const { db, team } = ctx;

  const { data: matches } = await db
    .from('captain_matches')
    .select(MATCH_COLUMNS)
    .eq('team_id', teamId)
    .order('match_at');

  const emailCtx = await loadTeamEmailContext(
    db,
    { id: team.id, name: team.name, captain_user_id: team.captain_user_id },
    (matches as unknown as Record<string, unknown>[]) || [],
  );

  return NextResponse.json({
    events: timelineFor(emailCtx, new Date()),
    settings: EMAIL_KINDS.map((k) => ({ ...emailCtx.settings[k], meta: KIND_META[k] })),
    roster_with_email: emailCtx.counts.roster,
  });
}

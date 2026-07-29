/**
 * CaptainMode daily cron — one pass, four scheduled sends.
 *
 *   1. availability poll   at the team's poll_lead_days   (availability_poll_sent_at)
 *   2. lineup emails       at the team's lineup_lead_days  (lineup_email_sent_at)
 *   3. availability nudge  2 days out                      (nudge_sent_at)
 *   4. day-before reminder 1 day out                       (reminder_sent_at)
 *
 * Deliberately one route rather than four crons — Vercel cron slots are
 * limited and these all want the same daily cadence. Each send is guarded by
 * its own *_sent_at column so a re-run never double-sends.
 *
 * The lead times used to be hardcoded 7/2/1 constants. Poll and lineup now
 * come from the team row, so a captain whose league wants a 10-day lineup
 * isn't stuck on 7. That means the windows differ per team, so this walks
 * every upcoming match once and asks "is this one due for anything today?"
 * rather than running one fixed-window query per job.
 *
 * The nudge and reminder stay constants: there is no team column for them,
 * and "48h before" / "the day before" are what the spec specifies.
 */
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { leadDaysFor } from '@/lib/captain/server';
import { resolveAvailability } from '@/lib/captain/availability';
import {
  availabilityEmail,
  lineupEmail,
  nudgeEmail,
  matchReminderEmail,
  sendAll,
  type LineupRow,
  type MatchInfo,
} from '@/lib/captain/emails';

export const dynamic = 'force-dynamic';

// A full roster send is paced ~2/sec to stay under Resend's rate limit, and
// this route can send for several matches in one pass.
export const maxDuration = 300;

type Player = {
  id: string;
  name: string;
  email: string | null;
  player_token: string;
  is_sub: boolean;
  unavailable_days: string[] | null;
};

type TeamRow = {
  name: string;
  captain_user_id: string;
  poll_lead_days: number | null;
  lineup_lead_days: number | null;
};

const DAY = 24 * 60 * 60 * 1000;

/** Longest lead we support, plus slack — bounds the match query. */
const HORIZON_DAYS = 125;

const NUDGE_LEAD_DAYS = 2;
const REMINDER_LEAD_DAYS = 1;

/**
 * True when a match sits in the ±12h band around its lead day. Same shape as
 * the old win(6.5, 7.5) windows: a daily cron fires once per day, so a full-day
 * band catches each match exactly once.
 */
function isDue(matchAt: string, leadDays: number, now: number): boolean {
  const out = (new Date(matchAt).getTime() - now) / DAY;
  return out >= leadDays - 0.5 && out <= leadDays + 0.5;
}

function infoOf(m: Record<string, unknown>): MatchInfo {
  return {
    id: m.id as string,
    matchAt: m.match_at as string,
    isHome: m.is_home as boolean,
    opponent: (m.opponent as string) || null,
    location: (m.location as string) || null,
    arrivalNote: (m.arrival_note as string) || null,
    opposingCaptainName: (m.opposing_captain_name as string) || null,
    opposingCaptainPhone: (m.opposing_captain_phone as string) || null,
  };
}

export async function GET() {
  const admin = getSupabaseAdmin();
  const now = Date.now();
  const summary = {
    polls: 0,
    lineups: 0,
    nudges: 0,
    reminders: 0,
    skippedBlackout: 0,
    errors: [] as string[],
  };

  const teamCache = new Map<string, TeamRow>();
  const teamOf = async (id: string) => {
    if (!teamCache.has(id)) {
      // select('*') so a team column added later can't 400 this whole route and
      // silently stop every scheduled send.
      const { data } = await admin.from('captain_teams').select('*').eq('id', id).maybeSingle();
      if (data) teamCache.set(id, data as TeamRow);
    }
    return teamCache.get(id);
  };

  const rosterCache = new Map<string, Player[]>();
  const rosterFor = async (teamId: string) => {
    if (!rosterCache.has(teamId)) {
      const { data } = await admin
        .from('captain_players')
        .select('*')
        .eq('team_id', teamId)
        .eq('active', true);
      rosterCache.set(
        teamId,
        ((data as Player[]) || []).filter((p) => !!p.email),
      );
    }
    return rosterCache.get(teamId) as Player[];
  };

  const { data: upcoming } = await admin
    .from('captain_matches')
    .select('*')
    .eq('status', 'scheduled')
    .gte('match_at', new Date(now - DAY).toISOString())
    .lte('match_at', new Date(now + HORIZON_DAYS * DAY).toISOString())
    .order('match_at');

  const answersFor = async (matchId: string) => {
    const { data } = await admin
      .from('captain_availability')
      .select('player_id, status')
      .eq('match_id', matchId);
    return (data as { player_id: string; status: string }[]) || [];
  };

  const stamp = (matchId: string, column: string) =>
    admin
      .from('captain_matches')
      .update({ [column]: new Date().toISOString() })
      .eq('id', matchId);

  for (const raw of (upcoming as Record<string, unknown>[]) || []) {
    const m = raw;
    const matchId = m.id as string;
    const teamId = m.team_id as string;

    let team: TeamRow | undefined;
    try {
      team = await teamOf(teamId);
    } catch (e) {
      summary.errors.push(`team ${teamId}: ${(e as Error).message}`);
      continue;
    }
    if (!team) continue;

    const lead = leadDaysFor(team);
    const matchAt = m.match_at as string;

    // ------------------------------------------------- 1. availability poll
    // The first ask. Previously manual-only, which meant a captain who forgot
    // had no availability at all when it came time to build a lineup.
    // Refuse to run without the guard column: we could send and then fail to
    // stamp, and re-send to the whole roster every single day after that.
    const canGuardPoll = 'availability_poll_sent_at' in m;
    if (canGuardPoll && m.availability_poll_sent_at == null && isDue(matchAt, lead.poll, now)) {
      try {
        const roster = (await rosterFor(teamId)).filter((p) => !p.is_sub);
        const resolved = resolveAvailability({
          roster,
          answers: await answersFor(matchId),
          matchAt,
        });
        // Don't ask someone about a weekday they already told us they can never
        // play; `awaiting` is everyone unanswered and not blacked out.
        summary.skippedBlackout += resolved.blockedByDay.length;

        if (resolved.awaiting.length) {
          const res = await sendAll(
            team.captain_user_id,
            resolved.awaiting.map((p) =>
              availabilityEmail(team.name, infoOf(m), {
                playerId: p.id,
                name: p.name,
                email: p.email as string,
                token: p.player_token,
              }),
            ),
          );
          summary.polls += res.filter((r) => r.sent).length;
        }
        await stamp(matchId, 'availability_poll_sent_at');
      } catch (e) {
        summary.errors.push(`poll ${matchId}: ${(e as Error).message}`);
      }
    }

    // -------------------------------------------------------- 2. lineup email
    if (m.lineup_email_sent_at == null && isDue(matchAt, lead.lineup, now)) {
      try {
        const { data: courts } = await admin
          .from('captain_lineups')
          .select('court_number, court_type, player1_id, player2_id')
          .eq('match_id', matchId)
          .order('court_number');

        // No lineup saved yet — leave the guard unstamped so tomorrow's run
        // picks it up once the captain has built one.
        if (courts?.length) {
          const roster = await rosterFor(teamId);
          const nameOf = (id: string | null) =>
            id ? roster.find((p) => p.id === id)?.name ?? '—' : '—';

          const rows: LineupRow[] = (courts as Record<string, unknown>[]).map((c) => ({
            courtNumber: c.court_number as number,
            courtType: c.court_type as 'singles' | 'doubles',
            names: [nameOf(c.player1_id as string | null)].concat(
              c.court_type === 'doubles' ? [nameOf(c.player2_id as string | null)] : [],
            ),
          }));
          const playing = new Set(
            (courts as Record<string, unknown>[])
              .flatMap((c) => [c.player1_id, c.player2_id])
              .filter(Boolean) as string[],
          );

          const res = await sendAll(
            team.captain_user_id,
            roster.map((p) =>
              lineupEmail(
                team.name,
                infoOf(m),
                rows,
                { playerId: p.id, name: p.name, email: p.email as string, token: p.player_token },
                playing.has(p.id),
              ),
            ),
          );
          await stamp(matchId, 'lineup_email_sent_at');
          summary.lineups += res.filter((r) => r.sent).length;
        }
      } catch (e) {
        summary.errors.push(`lineup ${matchId}: ${(e as Error).message}`);
      }
    }

    // -------------------------------------------------------------- 3. nudge
    if (m.nudge_sent_at == null && isDue(matchAt, NUDGE_LEAD_DAYS, now)) {
      try {
        const roster = (await rosterFor(teamId)).filter((p) => !p.is_sub);
        const resolved = resolveAvailability({
          roster,
          answers: await answersFor(matchId),
          matchAt,
        });

        if (resolved.awaiting.length) {
          const res = await sendAll(
            team.captain_user_id,
            resolved.awaiting.map((p) =>
              nudgeEmail(team.name, infoOf(m), {
                playerId: p.id,
                name: p.name,
                email: p.email as string,
                token: p.player_token,
              }),
            ),
          );
          summary.nudges += res.filter((r) => r.sent).length;
        }
        await stamp(matchId, 'nudge_sent_at');
      } catch (e) {
        summary.errors.push(`nudge ${matchId}: ${(e as Error).message}`);
      }
    }

    // ----------------------------------------------------------- 4. reminder
    if (m.reminder_sent_at == null && isDue(matchAt, REMINDER_LEAD_DAYS, now)) {
      try {
        const { data: courts } = await admin
          .from('captain_lineups')
          .select('court_number, court_type, player1_id, player2_id')
          .eq('match_id', matchId);

        if (courts?.length) {
          const roster = await rosterFor(teamId);
          const courtFor = (pid: string) => {
            const c = (courts as Record<string, unknown>[]).find(
              (x) => x.player1_id === pid || x.player2_id === pid,
            );
            return c
              ? `${c.court_type === 'singles' ? 'Singles' : 'Doubles'} ${c.court_number}`
              : null;
          };
          const playing = roster.filter((p) => !!courtFor(p.id));

          if (playing.length) {
            const res = await sendAll(
              team.captain_user_id,
              playing.map((p) =>
                matchReminderEmail(
                  team.name,
                  infoOf(m),
                  { playerId: p.id, name: p.name, email: p.email as string, token: p.player_token },
                  courtFor(p.id),
                ),
              ),
            );
            summary.reminders += res.filter((r) => r.sent).length;
          }
          await stamp(matchId, 'reminder_sent_at');
        }
      } catch (e) {
        summary.errors.push(`reminder ${matchId}: ${(e as Error).message}`);
      }
    }
  }

  return NextResponse.json(summary);
}

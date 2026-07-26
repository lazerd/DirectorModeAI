/**
 * CaptainMode daily cron — one pass, three scheduled sends.
 *
 *   1. lineup emails    for matches ~7 days out   (lineup_email_sent_at IS NULL)
 *   2. availability nudge for matches ~2 days out (nudge_sent_at IS NULL)
 *   3. day-before reminders                        (reminder_sent_at IS NULL)
 *
 * Deliberately one route rather than three crons — Vercel cron slots are
 * limited and these all want the same daily cadence. Each send is guarded by
 * its own *_sent_at column so a re-run never double-sends.
 */
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import {
  lineupEmail,
  nudgeEmail,
  matchReminderEmail,
  sendAll,
  type LineupRow,
  type MatchInfo,
} from '@/lib/captain/emails';

export const dynamic = 'force-dynamic';

type Player = { id: string; name: string; email: string | null; player_token: string };

const DAY = 24 * 60 * 60 * 1000;
const win = (from: number, to: number) => ({
  from: new Date(Date.now() + from * DAY).toISOString(),
  to: new Date(Date.now() + to * DAY).toISOString(),
});

async function rosterFor(admin: ReturnType<typeof getSupabaseAdmin>, teamId: string) {
  const { data } = await admin
    .from('captain_players')
    .select('id, name, email, player_token')
    .eq('team_id', teamId)
    .eq('active', true);
  return ((data as Player[]) || []).filter((p) => !!p.email);
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
  const summary = { lineups: 0, nudges: 0, reminders: 0, errors: [] as string[] };

  const teamCache = new Map<string, { name: string; captain_user_id: string }>();
  const teamOf = async (id: string) => {
    if (!teamCache.has(id)) {
      const { data } = await admin
        .from('captain_teams')
        .select('name, captain_user_id')
        .eq('id', id)
        .maybeSingle();
      if (data) teamCache.set(id, data as { name: string; captain_user_id: string });
    }
    return teamCache.get(id);
  };

  // ---------------------------------------------------------------- lineups
  {
    const { from, to } = win(6.5, 7.5);
    const { data: matches } = await admin
      .from('captain_matches')
      .select('*')
      .eq('status', 'scheduled')
      .is('lineup_email_sent_at', null)
      .gte('match_at', from)
      .lte('match_at', to);

    for (const m of (matches as Record<string, unknown>[]) || []) {
      try {
        const team = await teamOf(m.team_id as string);
        if (!team) continue;
        const { data: courts } = await admin
          .from('captain_lineups')
          .select('court_number, court_type, player1_id, player2_id')
          .eq('match_id', m.id as string)
          .order('court_number');
        if (!courts?.length) continue; // captain hasn't built one yet

        const roster = await rosterFor(admin, m.team_id as string);
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
        await admin
          .from('captain_matches')
          .update({ lineup_email_sent_at: new Date().toISOString() })
          .eq('id', m.id as string);
        summary.lineups += res.filter((r) => r.sent).length;
      } catch (e) {
        summary.errors.push(`lineup ${m.id}: ${(e as Error).message}`);
      }
    }
  }

  // ----------------------------------------------------------------- nudges
  {
    const { from, to } = win(1.5, 2.5);
    const { data: matches } = await admin
      .from('captain_matches')
      .select('*')
      .eq('status', 'scheduled')
      .is('nudge_sent_at', null)
      .gte('match_at', from)
      .lte('match_at', to);

    for (const m of (matches as Record<string, unknown>[]) || []) {
      try {
        const team = await teamOf(m.team_id as string);
        if (!team) continue;
        const roster = await rosterFor(admin, m.team_id as string);
        const { data: answered } = await admin
          .from('captain_availability')
          .select('player_id')
          .eq('match_id', m.id as string);
        const done = new Set(((answered as { player_id: string }[]) || []).map((a) => a.player_id));
        const missing = roster.filter((p) => !done.has(p.id));

        if (missing.length) {
          const res = await sendAll(
            team.captain_user_id,
            missing.map((p) =>
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
        await admin
          .from('captain_matches')
          .update({ nudge_sent_at: new Date().toISOString() })
          .eq('id', m.id as string);
      } catch (e) {
        summary.errors.push(`nudge ${m.id}: ${(e as Error).message}`);
      }
    }
  }

  // -------------------------------------------------------------- reminders
  {
    const { from, to } = win(0.5, 1.5);
    const { data: matches } = await admin
      .from('captain_matches')
      .select('*')
      .eq('status', 'scheduled')
      .is('reminder_sent_at', null)
      .gte('match_at', from)
      .lte('match_at', to);

    for (const m of (matches as Record<string, unknown>[]) || []) {
      try {
        const team = await teamOf(m.team_id as string);
        if (!team) continue;
        const { data: courts } = await admin
          .from('captain_lineups')
          .select('court_number, court_type, player1_id, player2_id')
          .eq('match_id', m.id as string);
        if (!courts?.length) continue;

        const roster = await rosterFor(admin, m.team_id as string);
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
        await admin
          .from('captain_matches')
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq('id', m.id as string);
      } catch (e) {
        summary.errors.push(`reminder ${m.id}: ${(e as Error).message}`);
      }
    }
  }

  return NextResponse.json(summary);
}

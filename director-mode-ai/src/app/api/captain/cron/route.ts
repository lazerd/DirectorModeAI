/**
 * CaptainMode daily cron — one pass over every team's scheduled email.
 *
 * Timing is no longer hardcoded. Each team's lead times, on/off switches, and
 * per-match exceptions live in captain_email_settings / captain_email_overrides
 * and are resolved by src/lib/captain/timeline.ts — the same module the
 * captain's timeline dashboard renders from, so the preview and the send can
 * never disagree.
 *
 * Due-based, not window-based. The old version only sent when a match fell
 * inside a fixed ±12h window (6.5–7.5 days out, etc.), so a lineup that was not
 * built on exactly the right day was never emailed at all — the window had
 * moved on by the next run. Now a send stays due until it happens, and each
 * `*_sent_at` stamp is what stops it repeating.
 */
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { sendAll } from '@/lib/captain/emails';
import { EMAIL_KINDS, KIND_META, isDue, type EmailKind, type MatchRow } from '@/lib/captain/timeline';
import { loadTeamEmailContext, payloadsFor, MATCH_COLUMNS } from '@/lib/captain/timelineSend';

export const dynamic = 'force-dynamic';

/** No point loading matches whose longest lead time could not have arrived yet. */
const HORIZON_DAYS = 150;

type TeamRow = { id: string; name: string; captain_user_id: string };

export async function GET() {
  const admin = getSupabaseAdmin();
  const now = new Date();
  const summary = {
    polls: 0,
    lineups: 0,
    nudges: 0,
    reminders: 0,
    errors: [] as string[],
  };
  const counter: Record<EmailKind, 'polls' | 'lineups' | 'nudges' | 'reminders'> = {
    poll: 'polls',
    lineup: 'lineups',
    nudge: 'nudges',
    reminder: 'reminders',
  };

  const horizon = new Date(now.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: matchRows } = await admin
    .from('captain_matches')
    .select(MATCH_COLUMNS)
    .eq('status', 'scheduled')
    .gt('match_at', now.toISOString())
    .lte('match_at', horizon)
    .order('match_at');

  const matches = (matchRows as unknown as Record<string, unknown>[]) || [];
  if (!matches.length) return NextResponse.json(summary);

  // One context load per team, not per match.
  const byTeam = new Map<string, Record<string, unknown>[]>();
  for (const m of matches) {
    const id = m.team_id as string;
    if (!byTeam.has(id)) byTeam.set(id, []);
    byTeam.get(id)!.push(m);
  }

  const { data: teamRows } = await admin
    .from('captain_teams')
    .select('id, name, captain_user_id')
    .in('id', [...byTeam.keys()])
    .eq('archived', false);
  const teams = new Map(((teamRows as TeamRow[]) || []).map((t) => [t.id, t]));

  for (const [teamId, teamMatches] of byTeam) {
    const team = teams.get(teamId);
    if (!team) continue; // archived or deleted mid-run

    try {
      const ctx = await loadTeamEmailContext(admin, team, teamMatches);

      for (const m of ctx.matches as MatchRow[]) {
        for (const kind of EMAIL_KINDS) {
          const ov = ctx.overrides.find((o) => o.match_id === m.id && o.kind === kind) || null;
          if (!isDue(kind, m, ctx.settings[kind], ov, now)) continue;

          try {
            const payloads = payloadsFor(kind, ctx, m.id);
            // No lineup yet, or nobody left to chase. Leave the stamp alone so
            // it goes out on a later run once the blocker clears.
            if (!payloads.length) continue;

            const res = await sendAll(team.captain_user_id, payloads);
            await admin
              .from('captain_matches')
              .update({ [KIND_META[kind].sentColumn]: new Date().toISOString() })
              .eq('id', m.id);
            summary[counter[kind]] += res.filter((r) => r.sent).length;
          } catch (e) {
            summary.errors.push(`${kind} ${m.id}: ${(e as Error).message}`);
          }
        }
      }
    } catch (e) {
      summary.errors.push(`team ${teamId}: ${(e as Error).message}`);
    }
  }

  return NextResponse.json(summary);
}

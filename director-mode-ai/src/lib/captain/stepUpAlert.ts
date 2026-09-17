/**
 * Tell the captains when a player becomes available for a match whose saved
 * lineup is short a line. Called after the availability write; never throws —
 * a failed alert must not fail the player's answer.
 */
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { openLines, sendAll, stepUpAlertEmail, type MatchInfo } from './emails';
import { CLUB_TZ_EMBED, clubTimeZoneOf } from './clubTime';
import { leagueSpec } from './leagues';

export async function alertIfStepUp(teamId: string, matchId: string, playerId: string, playerName: string): Promise<void> {
  try {
    const admin = getSupabaseAdmin();
    const [{ data: teamRow }, { data: m }, { data: courts }, { data: staff }] = await Promise.all([
      admin
        .from('captain_teams')
        .select(`id, name, captain_user_id, league_type, ${CLUB_TZ_EMBED}`)
        .eq('id', teamId)
        .maybeSingle(),
      admin
        .from('captain_matches')
        .select('id, match_at, is_home, opponent, location, arrival_note, opposing_captain_name, opposing_captain_phone, singles_courts, doubles_courts, lineup_email_sent_at')
        .eq('id', matchId)
        .maybeSingle(),
      admin.from('captain_lineups').select('court_number, court_type, player1_id, player2_id').eq('match_id', matchId),
      admin.from('captain_team_staff').select('user_id').eq('team_id', teamId),
    ]);
    const team = teamRow as { id: string; name: string; captain_user_id: string; league_type: string | null } | null;
    if (!team || !m || leagueSpec(team.league_type).multiLine) return;

    type Court = { court_number: number; court_type: 'singles' | 'doubles'; player1_id: string | null; player2_id: string | null };
    const rows = ((courts as Court[] | null) ?? []).map((c) => ({
      courtNumber: c.court_number,
      courtType: c.court_type,
      names: [c.player1_id, c.player2_id].filter(Boolean) as string[],
    }));
    // No saved lineup, or they're already on it: nothing for the captain to act on.
    if (!rows.length || rows.some((r) => r.names.includes(playerId))) return;
    const open = openLines({ singlesCourts: m.singles_courts, doublesCourts: m.doubles_courts }, rows);
    if (!open.length) return;

    const ids = Array.from(new Set([team.captain_user_id, ...((staff as { user_id: string }[] | null) ?? []).map((s) => s.user_id)].filter(Boolean)));
    const emails = (
      await Promise.all(ids.map(async (id) => (await admin.auth.admin.getUserById(id)).data?.user?.email || null))
    ).filter(Boolean) as string[];
    if (!emails.length) return;

    const info: MatchInfo = {
      id: m.id,
      matchAt: m.match_at,
      isHome: m.is_home,
      opponent: m.opponent || null,
      location: m.location || null,
      arrivalNote: m.arrival_note || null,
      opposingCaptainName: m.opposing_captain_name || null,
      opposingCaptainPhone: m.opposing_captain_phone || null,
    };
    const tz = clubTimeZoneOf(teamRow);
    await sendAll(
      team.captain_user_id,
      Array.from(new Set(emails)).map((to) => stepUpAlertEmail(to, team.name, info, playerName, open, team.id, tz)),
    );
  } catch (e) {
    console.error('[captain] step-up alert failed', e);
  }
}

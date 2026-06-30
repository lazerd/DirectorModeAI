'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  Save,
  Trash2,
  Zap,
  Copy,
  Check,
  UserCheck,
  ArrowUp,
  ArrowDown,
  Plus,
  Minus,
  Sparkles,
  Mail,
  Pencil,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { autoAssignRoundBalanced, autoAssignMashupRound, optimizeLines } from '@/lib/jtt';

// A 3-team (or 2-team) "mish-mash" gathering is flagged in the matchup's notes
// as MASHUP[SH|MCC|MDW]. Every listed club's players are pooled into one
// scorecard and the auto-assigner mixes clubs on every court. Returns the club
// short_codes, or null for a normal head-to-head matchup.
function parseMashupShorts(notes: string | null | undefined): string[] | null {
  const m = notes?.match(/MASHUP\[([^\]]+)\]/i);
  if (!m) return null;
  const shorts = m[1].split('|').map(s => s.trim()).filter(Boolean);
  return shorts.length ? shorts : null;
}
import MatchConfirmEmailModal from '@/components/leagues/jtt/MatchConfirmEmailModal';

type Club = {
  id: string;
  name: string;
  short_code: string;
  courts_available: number;
};
type Division = {
  id: string;
  name: string;
  short_code: string;
  line_format: string;
  start_time: string | null;
  end_time: string | null;
};
type Matchup = {
  id: string;
  division_id: string;
  match_date: string;
  start_time: string | null;
  home_club_id: string;
  away_club_id: string;
  home_lines_won: number;
  away_lines_won: number;
  winner: 'home' | 'away' | 'tie' | null;
  status: string;
  notes: string | null;
  courts_override: number | null;
};
type Roster = {
  id: string;
  division_id: string;
  club_id: string;
  player_name: string;
  ladder_position: number | null;
  status: string;
};
type Line = {
  id: string;
  matchup_id: string;
  line_type: 'singles' | 'doubles';
  line_number: number;
  round_number: number;
  home_player1_id: string | null;
  home_player2_id: string | null;
  away_player1_id: string | null;
  away_player2_id: string | null;
  score: string | null;
  winner: 'home' | 'away' | null;
  counts_for_team?: boolean;
  status: string;
  score_token: string | null;
  court_label?: string | null;
};

type SlotField =
  | 'home_player1_id'
  | 'home_player2_id'
  | 'away_player1_id'
  | 'away_player2_id';

export default function MatchupFacilitatorPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : (params.id as string);
  const matchupId = Array.isArray(params.matchupId)
    ? params.matchupId[0]
    : (params.matchupId as string);

  const [matchup, setMatchup] = useState<Matchup | null>(null);
  const [division, setDivision] = useState<Division | null>(null);
  const [homeClub, setHomeClub] = useState<Club | null>(null);
  const [awayClub, setAwayClub] = useState<Club | null>(null);
  const [homeRosters, setHomeRosters] = useState<Roster[]>([]);
  const [awayRosters, setAwayRosters] = useState<Roster[]>([]);
  // Mashup mode: every participating club, plus all of their rosters pooled.
  const [mashupClubs, setMashupClubs] = useState<Club[]>([]);
  const [allRosters, setAllRosters] = useState<Roster[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [checkedInIds, setCheckedInIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [confirmEmailOpen, setConfirmEmailOpen] = useState(false);

  const fetchAll = useCallback(async (opts?: { silent?: boolean }) => {
    // Silent refresh keeps the page mounted (no spinner) so entering a score
    // on one court never wipes what you're typing on another.
    if (!opts?.silent) setLoading(true);
    const supabase = createClient();
    const { data: m, error: mErr } = await supabase
      .from('league_team_matchups')
      .select('*')
      .eq('id', matchupId)
      .single();
    if (mErr || !m) {
      setError(mErr?.message || 'Matchup not found');
      setLoading(false);
      return;
    }
    const matchupRow = m as Matchup;
    setMatchup(matchupRow);

    // In mashup mode the roster/club pool is every participating club, not just
    // home + away. Resolve those club ids up front so the rosters query below
    // pulls all of them.
    const mShorts = parseMashupShorts(matchupRow.notes);
    let participatingClubIds = [matchupRow.home_club_id, matchupRow.away_club_id];
    if (mShorts) {
      const { data: mc } = await supabase
        .from('league_clubs')
        .select('id')
        .eq('league_id', id)
        .in('short_code', mShorts);
      const ids = ((mc as { id: string }[]) || []).map(c => c.id);
      if (ids.length) participatingClubIds = ids;
    }

    const [dRes, cRes, rRes, lRes, ciRes] = await Promise.all([
      supabase.from('league_divisions').select('*').eq('id', matchupRow.division_id).single(),
      supabase
        .from('league_clubs')
        .select('*')
        .in('id', participatingClubIds),
      supabase
        .from('league_team_rosters')
        .select('id, division_id, club_id, player_name, ladder_position, status')
        .eq('division_id', matchupRow.division_id)
        .in('club_id', participatingClubIds)
        .order('ladder_position', { nullsFirst: false }),
      supabase
        .from('league_matchup_lines')
        .select('*')
        .eq('matchup_id', matchupId)
        .order('line_number'),
      supabase
        .from('league_matchup_checkins')
        .select('roster_id')
        .eq('matchup_id', matchupId),
    ]);

    setDivision((dRes.data as Division) || null);
    const clubsList = (cRes.data as Club[]) || [];
    setHomeClub(clubsList.find(c => c.id === matchupRow.home_club_id) || null);
    setAwayClub(clubsList.find(c => c.id === matchupRow.away_club_id) || null);
    // Host club first, then the rest by name, so the attendance columns read
    // host → visitors.
    setMashupClubs(
      mShorts
        ? [...clubsList].sort(
            (a, b) =>
              (a.id === matchupRow.home_club_id ? 0 : 1) -
                (b.id === matchupRow.home_club_id ? 0 : 1) ||
              a.name.localeCompare(b.name)
          )
        : []
    );

    const rostersList = (rRes.data as Roster[]) || [];
    setAllRosters(rostersList);
    setHomeRosters(rostersList.filter(r => r.club_id === matchupRow.home_club_id));
    setAwayRosters(rostersList.filter(r => r.club_id === matchupRow.away_club_id));
    // round_number defaults to 1 so the page works before the rounds migration runs.
    setLines(
      ((lRes.data as Line[]) || []).map(l => ({ ...l, round_number: l.round_number ?? 1 }))
    );

    const ciList = ((ciRes.data as { roster_id: string }[]) || []).map(x => x.roster_id);
    setCheckedInIds(new Set(ciList));

    setLoading(false);
  }, [matchupId, id]);

  const isMashup = mashupClubs.length > 0;

  // Every active roster row in play (the full pool in mashup mode, else just
  // home + away). Used by per-club helpers below so they work for any club.
  const allRostersCombined = useMemo(
    () => (isMashup ? allRosters : [...homeRosters, ...awayRosters]),
    [isMashup, allRosters, homeRosters, awayRosters]
  );
  const activeForClub = useCallback(
    (clubId: string) =>
      allRostersCombined.filter(r => r.club_id === clubId && r.status === 'active'),
    [allRostersCombined]
  );

  // Add a brand-new player to a club's roster right from the scorecard.
  const addPlayer = async (clubId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed || !matchup) return;
    const supabase = createClient();
    const existing = activeForClub(clubId);
    const nextPos = existing.reduce((mx, r) => Math.max(mx, r.ladder_position ?? 0), 0) + 1;
    const { error: insErr } = await supabase.from('league_team_rosters').insert({
      division_id: matchup.division_id,
      club_id: clubId,
      player_name: trimmed,
      ladder_position: nextPos,
      status: 'active',
    });
    if (insErr) { setError(insErr.message); return; }
    await fetchAll({ silent: true });
  };

  // Which rosters count as "available" for today:
  // - If any check-ins exist for this matchup, use only checked-in active players
  // - If none, fall back to all active roster players
  const activeHome = useMemo(
    () => homeRosters.filter(r => r.status === 'active'),
    [homeRosters]
  );
  const activeAway = useMemo(
    () => awayRosters.filter(r => r.status === 'active'),
    [awayRosters]
  );
  const hasCheckins = checkedInIds.size > 0;
  const availableHome = hasCheckins
    ? activeHome.filter(r => checkedInIds.has(r.id))
    : activeHome;
  const availableAway = hasCheckins
    ? activeAway.filter(r => checkedInIds.has(r.id))
    : activeAway;

  // Mashup pool: every active player across all participating clubs, narrowed
  // to whoever's checked in (once anyone is). This is what the mish-mash
  // auto-assigner draws from.
  const activePool = useMemo(
    () => allRosters.filter(r => r.status === 'active'),
    [allRosters]
  );
  const availablePool = hasCheckins
    ? activePool.filter(r => checkedInIds.has(r.id))
    : activePool;

  // Manual line dropdowns draw from whoever is CHECKED IN (across both clubs, or
  // every participating club in a mashup) — so you can't accidentally slot a kid
  // who isn't here. Before anyone's checked in, fall back to the full active
  // roster so the pickers aren't empty. (Need someone who's not checked in? Check
  // them in first — that's the source of truth for who's present today.)
  const allLinePlayers = useMemo(
    () => (isMashup ? availablePool : [...availableHome, ...availableAway]),
    [isMashup, availablePool, availableHome, availableAway]
  );
  const clubShortById = useMemo(() => {
    const m = new Map<string, string>();
    if (homeClub) m.set(homeClub.id, homeClub.short_code);
    if (awayClub) m.set(awayClub.id, awayClub.short_code);
    for (const c of mashupClubs) m.set(c.id, c.short_code);
    return m;
  }, [homeClub, awayClub, mashupClubs]);

  const courtsForThisMatchup =
    matchup?.courts_override ?? homeClub?.courts_available ?? 0;

  const optimizer = useMemo(
    () =>
      optimizeLines(courtsForThisMatchup, availableHome.length, availableAway.length),
    [courtsForThisMatchup, availableHome.length, availableAway.length]
  );

  // Group lines into rounds, each round's courts sorted by line_number.
  const rounds = useMemo(() => {
    const byRound = new Map<number, Line[]>();
    for (const l of lines) {
      const arr = byRound.get(l.round_number) || [];
      arr.push(l);
      byRound.set(l.round_number, arr);
    }
    return [...byRound.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([round, ls]) => ({
        round,
        lines: ls.sort((a, b) => a.line_number - b.line_number),
      }));
  }, [lines]);

  // Auto-assign players by strength within ONE round (so a later round can
  // reuse the same players from a fresh pool).
  const autoAssignRound = async (round: number) => {
    const supabase = createClient();
    // Read lines FRESH from the DB, not React state. When this runs right after
    // createRound() inserts the new round, the `lines` closure is still the
    // pre-insert value, so the new round looks empty and we'd wrongly alert
    // "every court already has players." Fresh data avoids that stale-closure trap.
    const { data: freshRaw } = await supabase
      .from('league_matchup_lines')
      .select('*')
      .eq('matchup_id', matchupId);
    const freshLines = ((freshRaw as Line[]) || []).map(l => ({ ...l, round_number: l.round_number ?? 1 }));
    const roundLines = freshLines.filter(l => l.round_number === round);
    const otherLines = freshLines.filter(l => l.round_number !== round);
    // Mashup: pool everyone and mix clubs per court. Head-to-head: balance
    // singles/doubles across rounds, seeded by strength, away vs home.
    const patches = isMashup
      ? autoAssignMashupRound(roundLines, availablePool)
      : autoAssignRoundBalanced(roundLines, otherLines, availableHome, availableAway);
    if (patches.length === 0) {
      alert('Every court in this round already has players — clear them first to re-assign.');
      return;
    }
    // .select() back so a blocked write (RLS / signed out) surfaces as an alert
    // instead of silently doing nothing — the bug we hit during a live match.
    // Mashup patches also carry counts_for_team=false (mixed play never scores
    // for a team); head-to-head patches leave the flag untouched.
    //
    // SEQUENTIAL, not Promise.all: every line update fires the recompute trigger,
    // which UPDATEs the shared parent matchup row. Firing all line updates at
    // once made them contend on that one row's lock until a statement timed out
    // ("canceling statement due to statement timeout"). One at a time, no fight.
    const results = [];
    for (const p of patches) {
      const r = await supabase
        .from('league_matchup_lines')
        .update({
          home_player1_id: p.home_player1_id,
          home_player2_id: p.home_player2_id,
          away_player1_id: p.away_player1_id,
          away_player2_id: p.away_player2_id,
          ...('counts_for_team' in p ? { counts_for_team: p.counts_for_team } : {}),
        })
        .eq('id', p.id)
        .select('id');
      results.push(r);
    }
    if (results.some(r => r.error)) {
      alert(`Couldn’t assign players: ${results.find(r => r.error)?.error?.message}`);
      return;
    }
    if (results.some(r => !r.data || r.data.length === 0)) {
      alert(
        'Couldn’t assign players — you may be signed out or lack edit permission on this league. Refresh and make sure you’re signed in, then try again.'
      );
      return;
    }
    await fetchAll({ silent: true });
  };

  const clearRoundAssignments = async (round: number) => {
    const roundLines = lines.filter(l => l.round_number === round);
    const assigned = roundLines.filter(
      l =>
        l.home_player1_id || l.home_player2_id || l.away_player1_id || l.away_player2_id
    );
    if (assigned.length === 0) return; // nothing to clear
    const supabase = createClient();
    // One batched write; .select() back so a 0-row result (RLS/permission block)
    // surfaces instead of silently doing nothing.
    const { data, error } = await supabase
      .from('league_matchup_lines')
      .update({
        home_player1_id: null,
        home_player2_id: null,
        away_player1_id: null,
        away_player2_id: null,
      })
      .in(
        'id',
        roundLines.map(l => l.id)
      )
      .select('id');
    if (error) {
      alert(`Couldn’t clear players: ${error.message}`);
      return;
    }
    if (!data || data.length === 0) {
      alert(
        'Couldn’t clear players — you may not have edit permission on this league (run the coach-access SQL) or you’re signed out.'
      );
      return;
    }
    fetchAll({ silent: true });
  };

  const toggleCheckin = async (rosterId: string) => {
    const supabase = createClient();
    if (checkedInIds.has(rosterId)) {
      await supabase
        .from('league_matchup_checkins')
        .delete()
        .eq('matchup_id', matchupId)
        .eq('roster_id', rosterId);
      setCheckedInIds(prev => {
        const next = new Set(prev);
        next.delete(rosterId);
        return next;
      });
    } else {
      await supabase
        .from('league_matchup_checkins')
        .insert({ matchup_id: matchupId, roster_id: rosterId });
      setCheckedInIds(prev => new Set(prev).add(rosterId));
    }
  };

  const checkInAllActive = async (clubId: string) => {
    const roster = activeForClub(clubId);
    const missing = roster.filter(r => !checkedInIds.has(r.id));
    if (missing.length === 0) return;
    const supabase = createClient();
    await supabase.from('league_matchup_checkins').insert(
      missing.map(r => ({ matchup_id: matchupId, roster_id: r.id }))
    );
    setCheckedInIds(prev => {
      const next = new Set(prev);
      for (const r of missing) next.add(r.id);
      return next;
    });
  };

  const clearCheckins = async (clubId: string) => {
    const roster = activeForClub(clubId);
    const toClear = roster.filter(r => checkedInIds.has(r.id));
    if (toClear.length === 0) return;
    const supabase = createClient();
    await supabase
      .from('league_matchup_checkins')
      .delete()
      .eq('matchup_id', matchupId)
      .in(
        'roster_id',
        toClear.map(r => r.id)
      );
    setCheckedInIds(prev => {
      const next = new Set(prev);
      for (const r of toClear) next.delete(r.id);
      return next;
    });
  };

  // Reorder a club's strength ladder right from the match page. Renumbers the
  // displayed list densely (1..N) on each move so it works even if some players
  // still have a null ladder_position (swapping null↔null would be a no-op).
  const moveInClub = async (clubId: string, rosterId: string, dir: -1 | 1) => {
    const list = activeForClub(clubId)
      .slice()
      .sort(
        (a, b) =>
          (a.ladder_position ?? 9999) - (b.ladder_position ?? 9999) ||
          a.player_name.localeCompare(b.player_name)
      );
    const idx = list.findIndex(r => r.id === rosterId);
    const j = idx + dir;
    if (idx === -1 || j < 0 || j >= list.length) return;
    [list[idx], list[j]] = [list[j], list[idx]];
    const supabase = createClient();
    const changed = list
      .map((r, i) => ({ id: r.id, pos: i + 1, current: r.ladder_position }))
      .filter(u => u.current !== u.pos);
    await Promise.all(
      changed.map(u =>
        supabase
          .from('league_team_rosters')
          .update({ ladder_position: u.pos })
          .eq('id', u.id)
      )
    );
    fetchAll({ silent: true });
  };

  const nextLineNumber = () =>
    (lines.reduce((max, l) => Math.max(max, l.line_number), 0) || 0) + 1;

  // Create a new round with one scorecard per court in use. The singles/doubles
  // split defaults to the optimizer's recommendation; leftover courts (when
  // attendance can't fill them) default to singles. Then auto-assigns players.
  const createRound = async () => {
    const courts = courtsForThisMatchup;
    if (courts < 1) {
      alert('Set the number of courts in use (above) to at least 1 first.');
      return;
    }
    const rounds = lines.map(l => l.round_number);
    const nextRound = (rounds.length ? Math.max(...rounds) : 0) + 1;
    // Mashup rounds default to all singles (the director then bumps the
    // singles/doubles split with the per-round control); head-to-head rounds use
    // the optimizer's recommendation.
    const singles = isMashup ? courts : Math.min(courts, optimizer.singles);
    const doubles = isMashup ? 0 : Math.min(courts - singles, optimizer.doubles);
    let n = nextLineNumber();
    const newLines = Array.from({ length: courts }, (_, i) => ({
      matchup_id: matchupId,
      round_number: nextRound,
      line_number: n++,
      line_type: (i < singles ? 'singles' : i < singles + doubles ? 'doubles' : 'singles') as
        | 'singles'
        | 'doubles',
      // Mashup lines never count toward a team score (mixed-club play).
      ...(isMashup ? { counts_for_team: false } : {}),
    }));
    const supabase = createClient();
    const { error: insErr } = await supabase.from('league_matchup_lines').insert(newLines);
    if (insErr) {
      alert(
        insErr.message.includes('round_number')
          ? 'Rounds aren’t enabled on the database yet — run the leagues_jtt_rounds.sql migration in Supabase, then try again.'
          : `Couldn’t create round: ${insErr.message}`
      );
      return;
    }
    await fetchAll({ silent: true });
    const canAutoAssign = isMashup
      ? availablePool.length >= 2
      : availableHome.length > 0 && availableAway.length > 0;
    if (canAutoAssign) await autoAssignRound(nextRound);
  };

  const deleteRound = async (round: number) => {
    const roundLines = lines.filter(l => l.round_number === round);
    const scored = roundLines.filter(l => l.status === 'completed').length;
    if (
      !confirm(
        `Delete Round ${round} (${roundLines.length} court${roundLines.length === 1 ? '' : 's'}${
          scored ? `, ${scored} already scored` : ''
        })?`
      )
    )
      return;
    const supabase = createClient();
    await supabase
      .from('league_matchup_lines')
      .delete()
      .in('id', roundLines.map(l => l.id));
    fetchAll({ silent: true });
  };

  const addCourtToRound = async (round: number) => {
    const supabase = createClient();
    const { error: insErr } = await supabase.from('league_matchup_lines').insert({
      matchup_id: matchupId,
      round_number: round,
      line_number: nextLineNumber(),
      line_type: 'singles',
      ...(isMashup ? { counts_for_team: false } : {}),
    });
    if (insErr) {
      alert(`Couldn’t add court: ${insErr.message}`);
      return;
    }
    fetchAll({ silent: true });
  };

  const removeLine = async (lineId: string) => {
    const supabase = createClient();
    await supabase.from('league_matchup_lines').delete().eq('id', lineId);
    fetchAll({ silent: true });
  };

  // Changing "courts in use" resizes every not-yet-scored round to N courts:
  // add singles courts to grow, drop trailing courts to shrink. Rounds that
  // already have a score are left untouched so results are never lost.
  const setCourtsInUse = async (n: number) => {
    const supabase = createClient();
    await supabase
      .from('league_team_matchups')
      .update({ courts_override: n })
      .eq('id', matchupId);
    const inserts: Array<{
      matchup_id: string;
      round_number: number;
      line_number: number;
      line_type: 'singles';
      counts_for_team?: boolean;
    }> = [];
    const deleteIds: string[] = [];
    let counter = nextLineNumber();
    for (const r of [...new Set(lines.map(l => l.round_number))]) {
      const rl = lines
        .filter(l => l.round_number === r)
        .sort((a, b) => a.line_number - b.line_number);
      if (rl.some(l => l.winner || l.score)) continue; // don't disturb a scored round
      if (n > rl.length) {
        for (let i = 0; i < n - rl.length; i++)
          inserts.push({
            matchup_id: matchupId,
            round_number: r,
            line_number: counter++,
            line_type: 'singles',
            ...(isMashup ? { counts_for_team: false } : {}),
          });
      } else if (n < rl.length) {
        rl.slice(n).forEach(l => deleteIds.push(l.id));
      }
    }
    if (deleteIds.length)
      await supabase.from('league_matchup_lines').delete().in('id', deleteIds);
    if (inserts.length) await supabase.from('league_matchup_lines').insert(inserts);
    fetchAll({ silent: true });
  };

  // Set a single court's line type. Switching to singles clears the 2nd players.
  const setLineType = async (line: Line, type: 'singles' | 'doubles') => {
    if (line.line_type === type) return;
    const supabase = createClient();
    const patch: Partial<Line> =
      type === 'singles'
        ? { line_type: type, home_player2_id: null, away_player2_id: null }
        : { line_type: type };
    await supabase.from('league_matchup_lines').update(patch).eq('id', line.id);
    fetchAll({ silent: true });
  };

  // Assign a player to a court slot, swapping to prevent the same player being
  // on two courts in the SAME round. If the picked player is already in another
  // slot (same side, same round), they move here and whoever they displaced
  // takes their old spot. (A player CAN still appear across different rounds.)
  const assignPlayer = async (line: Line, field: SlotField, playerId: string | null) => {
    const prev = line[field];
    if (playerId === prev) return;

    const isHome = field.startsWith('home');
    const sideFields: SlotField[] = isHome
      ? ['home_player1_id', 'home_player2_id']
      : ['away_player1_id', 'away_player2_id'];

    const updates: Array<{ id: string; patch: Partial<Line> }> = [];

    if (playerId) {
      // Where is this player currently sitting in this round (same side)?
      let foundLine: Line | null = null;
      let foundField: SlotField | null = null;
      for (const l of lines.filter(x => x.round_number === line.round_number)) {
        for (const f of sideFields) {
          if (l.id === line.id && f === field) continue;
          if (l[f] === playerId) {
            foundLine = l;
            foundField = f;
            break;
          }
        }
        if (foundLine) break;
      }

      if (foundLine && foundField) {
        if (foundLine.id === line.id) {
          // Same line (e.g. doubles P1<->P2): swap within the one row.
          updates.push({ id: line.id, patch: { [field]: playerId, [foundField]: prev } });
        } else {
          // Different court: target gets the player, their old slot gets whoever
          // was here (prev) — a true swap that keeps everyone in exactly one spot.
          updates.push({ id: line.id, patch: { [field]: playerId } });
          updates.push({ id: foundLine.id, patch: { [foundField]: prev } });
        }
      } else {
        updates.push({ id: line.id, patch: { [field]: playerId } });
      }
    } else {
      updates.push({ id: line.id, patch: { [field]: null } });
    }

    const supabase = createClient();
    const results = await Promise.all(
      updates.map(u =>
        supabase.from('league_matchup_lines').update(u.patch).eq('id', u.id).select('id')
      )
    );
    if (results.some(r => r.error)) {
      alert(`Couldn’t update lineup: ${results.find(r => r.error)?.error?.message}`);
      return;
    }
    if (results.some(r => !r.data || r.data.length === 0)) {
      alert(
        'Couldn’t update lineup — you may not have edit permission on this league (run the coach-access SQL) or you’re signed out.'
      );
      return;
    }
    fetchAll({ silent: true });
  };

  // Bulk-set a round's split: first `singlesCount` courts singles, rest doubles.
  const applyRoundSplit = async (round: number, singlesCount: number) => {
    const roundLines = lines
      .filter(l => l.round_number === round)
      .sort((a, b) => a.line_number - b.line_number);
    const supabase = createClient();
    const changes = roundLines
      .map((l, i) => ({ l, type: (i < singlesCount ? 'singles' : 'doubles') as 'singles' | 'doubles' }))
      .filter(({ l, type }) => type !== l.line_type);
    await Promise.all(
      changes.map(({ l, type }) => {
        const patch: Partial<Line> =
          type === 'singles'
            ? { line_type: type, home_player2_id: null, away_player2_id: null }
            : { line_type: type };
        return supabase.from('league_matchup_lines').update(patch).eq('id', l.id);
      })
    );
    fetchAll({ silent: true });
  };

  // Rename a court's scorecard. null clears back to the default "Court N".
  const saveCourtLabel = async (lineId: string, label: string | null) => {
    const supabase = createClient();
    const { data, error: updErr } = await supabase
      .from('league_matchup_lines')
      .update({ court_label: label })
      .eq('id', lineId)
      .select('id');
    if (updErr) {
      alert(
        updErr.message.includes('court_label')
          ? 'Court names aren’t enabled on the database yet — run the leagues_jtt_court_labels.sql migration in Supabase, then try again.'
          : `Couldn’t rename court: ${updErr.message}`
      );
      return;
    }
    if (!data || data.length === 0) {
      alert(
        'Couldn’t rename court — you may not have edit permission on this league (run the coach-access SQL) or you’re signed out.'
      );
      return;
    }
    fetchAll({ silent: true });
  };

  // Let the optimizer pick the split for this round given courts + attendance.
  const aiOptimizeRound = async (round: number) => {
    const roundLines = lines.filter(l => l.round_number === round);
    const opt = optimizeLines(roundLines.length, availableHome.length, availableAway.length);
    await applyRoundSplit(round, Math.min(roundLines.length, opt.singles));
  };

  useEffect(() => {
    fetchAll({ silent: true });
  }, [fetchAll]);

  const updateLine = async (lineId: string, patch: Partial<Line>) => {
    setSaving(lineId);
    const supabase = createClient();
    // .select() so we can tell a real save from a silent 0-row no-op (e.g. RLS
    // blocking the write returns success with no rows updated).
    const { data, error: updErr } = await supabase
      .from('league_matchup_lines')
      .update(patch)
      .eq('id', lineId)
      .select('id');
    setSaving(null);
    if (updErr) {
      alert(`Couldn’t save: ${updErr.message}`);
      return;
    }
    if (!data || data.length === 0) {
      alert(
        'Score didn’t save — you may not have permission on this league, or you’re signed out. Try refreshing/re-logging in.'
      );
      return;
    }
    fetchAll({ silent: true });
  };

  // Save a court's score via the line's magic-link token endpoint, which uses
  // the service role server-side. This lets ANY coach (not just the league
  // director) record scores — direct table writes are RLS-locked to the
  // director, which is why non-director coaches saw "didn't save".
  const saveScore = async (
    line: Line,
    payload: { score: string | null; winner: 'home' | 'away' | null; counts_for_team?: boolean }
  ) => {
    // Mixed-club lines record a winning side for individual records but must not
    // count toward the team score — persist that flag alongside the result.
    const persistCountsFlag = async () => {
      if (payload.counts_for_team === undefined) return;
      const supabase = createClient();
      await supabase
        .from('league_matchup_lines')
        .update({ counts_for_team: payload.counts_for_team })
        .eq('id', line.id);
    };
    if (!line.score_token) {
      // No token (shouldn't happen) — fall back to a direct write.
      await updateLine(line.id, {
        score: payload.score,
        winner: payload.winner,
        status: payload.winner ? 'completed' : payload.score ? 'in_progress' : 'pending',
      });
      await persistCountsFlag();
      fetchAll({ silent: true });
      return;
    }
    setSaving(line.id);
    try {
      const res = await fetch(`/api/leagues/line/${line.score_token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score: payload.score ?? '',
          winner: payload.winner ?? undefined,
        }),
      });
      const resBody = await res.json().catch(() => ({}));
      setSaving(null);
      if (!res.ok) {
        alert(`Couldn’t save: ${resBody.error || `HTTP ${res.status}`}`);
        return;
      }
      await persistCountsFlag();
      fetchAll({ silent: true });
    } catch (e) {
      setSaving(null);
      alert(`Couldn’t save: ${e instanceof Error ? e.message : 'network error'}`);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-orange-500" size={24} />
      </div>
    );
  }

  if (error || !matchup || !division || !homeClub || !awayClub) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5" />
          <span>{error || 'Could not load matchup.'}</span>
        </div>
      </div>
    );
  }

  const dateLabel = new Date(matchup.match_date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      {confirmEmailOpen && (
        <MatchConfirmEmailModal
          leagueId={id}
          matchupId={matchupId}
          onClose={() => setConfirmEmailOpen(false)}
        />
      )}
      <div className="flex items-center gap-3 mb-4">
        <Link href={`/mixer/leagues/${id}/jtt`} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="font-semibold text-2xl text-gray-900">
            {isMashup ? (
              <>
                {division.name} Mashup{' '}
                <span className="text-gray-400 text-base font-normal">
                  · {mashupClubs.map(c => c.short_code).join(' · ')}
                </span>
              </>
            ) : (
              <>
                {awayClub.name} <span className="text-gray-400">@</span> {homeClub.name}
              </>
            )}
          </h1>
          <p className="text-gray-500 text-sm">
            {division.name} · {dateLabel}
            {division.start_time && ` · ${division.start_time.slice(0, 5)}`}
          </p>
        </div>
      </div>

      {isMashup ? (
        /* Mixed play banner — no team score; results are individual only. */
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 mb-6 text-sm text-purple-800">
          <span className="font-semibold">Mish-mash day</span> — {mashupClubs.length}{' '}
          clubs mixed together at {homeClub.name}. Auto-assign pairs players from
          different clubs (and makes doubles club-vs-club when it can). Every court
          counts for each player&apos;s individual record but <strong>not</strong> a
          team score.
        </div>
      ) : (
        /* Aggregate score */
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6 flex items-center justify-center gap-8">
          <TeamScore clubName={awayClub.name} side="Away" score={matchup.away_lines_won} isWinner={matchup.winner === 'away'} />
          <span className="text-gray-300 text-2xl">—</span>
          <TeamScore clubName={homeClub.name} side="Home" score={matchup.home_lines_won} isWinner={matchup.winner === 'home'} />
        </div>
      )}

      {/* Attendance / check-in */}
      <section className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <UserCheck size={16} className="text-orange-500" />
            Today&apos;s attendance
          </h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">
              {hasCheckins
                ? `${checkedInIds.size} checked in`
                : 'No check-ins yet (using full active roster)'}
            </span>
            <button
              onClick={() => setConfirmEmailOpen(true)}
              title="Email a confirmation to players who marked Available in the RSVP form"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-orange-600 text-white hover:bg-orange-700"
            >
              <Mail size={13} />
              Email available players
            </button>
          </div>
        </div>

        {isMashup ? (
          <div
            className={`grid grid-cols-1 gap-4 ${
              mashupClubs.length >= 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'
            }`}
          >
            {mashupClubs.map(club => (
              <AttendanceColumn
                key={club.id}
                label={club.name}
                rosters={activeForClub(club.id)}
                checkedInIds={checkedInIds}
                onToggle={toggleCheckin}
                onCheckAll={() => checkInAllActive(club.id)}
                onClearAll={() => clearCheckins(club.id)}
                onMove={(rosterId, dir) => moveInClub(club.id, rosterId, dir)}
                onAddPlayer={(name) => addPlayer(club.id, name)}
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <AttendanceColumn
              label={`Away · ${awayClub.name}`}
              rosters={activeAway}
              checkedInIds={checkedInIds}
              onToggle={toggleCheckin}
              onCheckAll={() => checkInAllActive(awayClub.id)}
              onClearAll={() => clearCheckins(awayClub.id)}
              onMove={(rosterId, dir) => moveInClub(awayClub.id, rosterId, dir)}
              onAddPlayer={(name) => addPlayer(awayClub.id, name)}
            />
            <AttendanceColumn
              label={`Home · ${homeClub.name}`}
              rosters={activeHome}
              checkedInIds={checkedInIds}
              onToggle={toggleCheckin}
              onCheckAll={() => checkInAllActive(homeClub.id)}
              onClearAll={() => clearCheckins(homeClub.id)}
              onMove={(rosterId, dir) => moveInClub(homeClub.id, rosterId, dir)}
              onAddPlayer={(name) => addPlayer(homeClub.id, name)}
            />
          </div>
        )}
      </section>

      {/* Courts + line optimizer summary */}
      <section className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm text-gray-600 mb-1">
              <span className="font-medium text-gray-900">{courtsForThisMatchup}</span>{' '}
              courts at {homeClub.name}
              {matchup.courts_override !== null &&
                matchup.courts_override !== homeClub.courts_available && (
                  <span className="text-xs text-orange-600 ml-2">(override for today)</span>
                )}
            </div>
            {isMashup ? (
              <>
                <div className="text-sm text-gray-600">
                  Playing today:{' '}
                  <span className="font-medium text-gray-900">{availablePool.length}</span>{' '}
                  players across {mashupClubs.length} clubs
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  Each round seats {courtsForThisMatchup} court
                  {courtsForThisMatchup === 1 ? '' : 's'} (≈
                  {Math.min(availablePool.length, courtsForThisMatchup * 2)} players).
                  Use the per-round Singles/Doubles control to add doubles courts,
                  then Auto-assign.
                </div>
              </>
            ) : (
              <>
                <div className="text-sm text-gray-600">
                  Playing today:{' '}
                  <span className="font-medium text-gray-900">{availableAway.length}</span> away
                  vs{' '}
                  <span className="font-medium text-gray-900">{availableHome.length}</span> home
                </div>
                <div className="mt-2 text-sm">
                  Recommended:{' '}
                  <span className="font-semibold text-gray-900">
                    {optimizer.singles} singles + {optimizer.doubles} doubles
                  </span>
                  {optimizer.benchedHome + optimizer.benchedAway > 0 && (
                    <span className="text-xs text-gray-500 ml-2">
                      ({optimizer.benchedHome + optimizer.benchedAway} sitting)
                    </span>
                  )}
                </div>
                {optimizer.warning && (
                  <p className="mt-1 text-xs text-orange-700">{optimizer.warning}</p>
                )}
              </>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <CourtsOverrideInput
              value={matchup.courts_override}
              onSet={v => setCourtsInUse(v ?? homeClub.courts_available)}
              defaultCourts={homeClub.courts_available}
            />
            <p className="text-xs text-gray-400 text-right">
              Resizes the current round to {courtsForThisMatchup} court
              {courtsForThisMatchup === 1 ? '' : 's'} (scored rounds are left as-is).
            </p>
          </div>
        </div>
      </section>

      {/* Rounds */}
      <div className="space-y-6">
        {rounds.map(({ round, lines: roundLines }) => (
          <RoundCard
            key={round}
            round={round}
            roundLines={roundLines}
            allLinePlayers={allLinePlayers}
            clubShortById={clubShortById}
            homeClub={homeClub}
            awayClub={awayClub}
            isMashup={isMashup}
            saving={saving}
            onAssign={assignPlayer}
            onSaveScore={saveScore}
            onSetLineType={setLineType}
            onSaveCourtLabel={saveCourtLabel}
            onRemoveLine={removeLine}
            onAddCourt={() => addCourtToRound(round)}
            onApplySplit={n => applyRoundSplit(round, n)}
            onAiOptimize={() => aiOptimizeRound(round)}
            onAutoAssign={() => autoAssignRound(round)}
            onClearAssignments={() => clearRoundAssignments(round)}
            onDeleteRound={() => deleteRound(round)}
          />
        ))}

        <button
          onClick={createRound}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-orange-300 text-orange-700 rounded-xl text-sm font-medium hover:bg-orange-50"
        >
          <Plus size={16} />
          {rounds.length === 0
            ? `Create Round 1 (${courtsForThisMatchup} court${courtsForThisMatchup === 1 ? '' : 's'})`
            : `Add Round ${rounds.length + 1}`}
        </button>
      </div>
    </div>
  );
}

function RoundCard({
  round,
  roundLines,
  allLinePlayers,
  clubShortById,
  homeClub,
  awayClub,
  isMashup,
  saving,
  onAssign,
  onSaveScore,
  onSetLineType,
  onSaveCourtLabel,
  onRemoveLine,
  onAddCourt,
  onApplySplit,
  onAiOptimize,
  onAutoAssign,
  onClearAssignments,
  onDeleteRound,
}: {
  round: number;
  roundLines: Line[];
  allLinePlayers: Roster[];
  clubShortById: Map<string, string>;
  homeClub: Club;
  awayClub: Club;
  isMashup: boolean;
  saving: string | null;
  onAssign: (line: Line, field: SlotField, playerId: string | null) => void;
  onSaveScore: (
    line: Line,
    payload: { score: string | null; winner: 'home' | 'away' | null; counts_for_team?: boolean }
  ) => void;
  onSetLineType: (line: Line, type: 'singles' | 'doubles') => void;
  onSaveCourtLabel: (lineId: string, label: string | null) => void;
  onRemoveLine: (lineId: string) => void;
  onAddCourt: () => void;
  onApplySplit: (singlesCount: number) => void;
  onAiOptimize: () => void;
  onAutoAssign: () => void;
  onClearAssignments: () => void;
  onDeleteRound: () => void;
}) {
  const singlesCount = roundLines.filter(l => l.line_type === 'singles').length;
  const doublesCount = roundLines.length - singlesCount;
  const scored = roundLines.filter(l => l.status === 'completed').length;
  const allScored = roundLines.length > 0 && scored === roundLines.length;

  // Players already placed somewhere in THIS round — hidden from the other
  // slots' dropdowns so you can't pick the same kid twice in one round.
  // (Resets per round: everyone is selectable again in a new round.)
  const usedInRound = new Set<string>();
  for (const l of roundLines) {
    for (const pid of [l.home_player1_id, l.home_player2_id, l.away_player1_id, l.away_player2_id]) {
      if (pid) usedInRound.add(pid);
    }
  }

  return (
    <section className="border border-gray-200 rounded-xl overflow-hidden">
      <header className="bg-gray-50 border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-gray-900">Round {round}</h2>
            <span className="text-xs text-gray-500">
              {roundLines.length} court{roundLines.length === 1 ? '' : 's'} ·{' '}
              {singlesCount}S / {doublesCount}D
            </span>
            {allScored && (
              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                All scored
              </span>
            )}
          </div>
          <button
            onClick={onDeleteRound}
            className="text-gray-400 hover:text-red-600 p-1"
            title="Delete this round"
          >
            <Trash2 size={15} />
          </button>
        </div>

        {/* Split + AI + assignment controls */}
        <div className="flex items-center gap-x-4 gap-y-2 flex-wrap mt-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-600">Singles</span>
            <button
              onClick={() => onApplySplit(Math.max(0, singlesCount - 1))}
              disabled={singlesCount <= 0}
              className="p-1 border border-gray-300 rounded text-gray-600 hover:bg-gray-100 disabled:opacity-30"
              title="Fewer singles (more doubles)"
            >
              <Minus size={13} />
            </button>
            <span className="w-5 text-center text-sm font-semibold text-gray-900 tabular-nums">
              {singlesCount}
            </span>
            <button
              onClick={() => onApplySplit(Math.min(roundLines.length, singlesCount + 1))}
              disabled={singlesCount >= roundLines.length}
              className="p-1 border border-gray-300 rounded text-gray-600 hover:bg-gray-100 disabled:opacity-30"
              title="More singles (fewer doubles)"
            >
              <Plus size={13} />
            </button>
            <span className="text-xs text-gray-400">/ {doublesCount} doubles</span>
          </div>

          <button
            onClick={onAiOptimize}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-indigo-600 text-white rounded-md text-xs font-medium hover:bg-indigo-700"
            title="Let AI pick the optimal singles/doubles split from attendance"
          >
            <Sparkles size={13} />
            AI optimize split
          </button>

          <span className="text-gray-200">|</span>

          <button
            onClick={onAutoAssign}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-orange-500 text-white rounded-md text-xs font-medium hover:bg-orange-600"
            title="Fill courts with the strongest available players"
          >
            <Zap size={13} />
            Auto-assign players
          </button>
          <button
            onClick={onClearAssignments}
            className="text-xs text-gray-500 hover:text-gray-800"
          >
            Clear players
          </button>
        </div>
      </header>

      <div className="p-4 space-y-4">
        {roundLines.map((line, i) => (
          <LineEditor
            key={line.id}
            line={line}
            courtNumber={i + 1}
            allLinePlayers={allLinePlayers}
            usedInRound={usedInRound}
            clubShortById={clubShortById}
            homeClub={homeClub}
            awayClub={awayClub}
            isMashup={isMashup}
            onAssign={(field, playerId) => onAssign(line, field, playerId)}
            onSaveScore={payload => onSaveScore(line, payload)}
            onSetType={type => onSetLineType(line, type)}
            onSaveCourtLabel={label => onSaveCourtLabel(line.id, label)}
            onRemove={() => onRemoveLine(line.id)}
            saving={saving === line.id}
          />
        ))}
        <button
          onClick={onAddCourt}
          className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800"
        >
          <Plus size={13} />
          Add a court
        </button>
      </div>
    </section>
  );
}

function TeamScore({
  clubName,
  side,
  score,
  isWinner,
}: {
  clubName: string;
  side: string;
  score: number;
  isWinner: boolean;
}) {
  return (
    <div className="text-center">
      <div className="text-xs uppercase text-gray-400">{side}</div>
      <div className={`text-4xl font-bold ${isWinner ? 'text-green-600' : 'text-gray-900'}`}>
        {score}
      </div>
      <div className="text-sm text-gray-700 font-medium">{clubName}</div>
    </div>
  );
}

function LineEditor({
  line,
  courtNumber,
  allLinePlayers,
  usedInRound,
  clubShortById,
  homeClub,
  awayClub,
  isMashup,
  onAssign,
  onSaveScore,
  onSetType,
  onSaveCourtLabel,
  onRemove,
  saving,
}: {
  line: Line;
  courtNumber: number;
  allLinePlayers: Roster[];
  usedInRound: Set<string>;
  clubShortById: Map<string, string>;
  homeClub: Club;
  awayClub: Club;
  isMashup: boolean;
  onAssign: (field: SlotField, playerId: string | null) => void;
  onSaveScore: (payload: { score: string | null; winner: 'home' | 'away' | null; counts_for_team?: boolean }) => void;
  onSetType: (type: 'singles' | 'doubles') => void;
  onSaveCourtLabel: (label: string | null) => void;
  onRemove: () => void;
  saving: boolean;
}) {
  const [score, setScore] = useState(line.score || '');
  const [winner, setWinner] = useState<'home' | 'away' | null>(line.winner);
  const [editing, setEditing] = useState(false);

  const defaultCourtName = `Court ${courtNumber}`;
  const courtName = (line.court_label || '').trim() || defaultCourtName;
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(courtName);

  const commitName = () => {
    setEditingName(false);
    const next = nameDraft.trim();
    if (next === courtName) return; // unchanged
    // Typing the default (or blank) clears the override so numbering stays dynamic.
    onSaveCourtLabel(next === '' || next === defaultCourtName ? null : next);
  };

  const isDoubles = line.line_type === 'doubles';

  // Each dropdown offers every active player from BOTH clubs (so a court can be
  // mixed when numbers are uneven), minus anyone already placed elsewhere in
  // this round — except this slot's own current pick, which stays selectable.
  const optionsFor = (current: string | null) =>
    allLinePlayers.filter(p => p.id === current || !usedInRound.has(p.id));

  // Mixed court: a player on the home side isn't from the home club, or a
  // player on the away side isn't from the away club. Such a line records a
  // winning SIDE (for individual records) but must NOT count for the team.
  const nameOf = (pid: string | null) => (pid ? allLinePlayers.find(p => p.id === pid)?.player_name || '' : '');
  const clubOf = (pid: string | null) => (pid ? allLinePlayers.find(p => p.id === pid)?.club_id : undefined);
  const homeSideIds = [line.home_player1_id, line.home_player2_id].filter(Boolean) as string[];
  const awaySideIds = [line.away_player1_id, line.away_player2_id].filter(Boolean) as string[];
  const isMixed =
    homeSideIds.some(pid => { const c = clubOf(pid); return c && c !== homeClub.id; }) ||
    awaySideIds.some(pid => { const c = clubOf(pid); return c && c !== awayClub.id; });
  // In a mashup every court is mixed play by definition (no team meaning), so we
  // always label by player name and never count it for a team. Outside a mashup
  // only a genuinely cross-club court is "individual".
  const individual = isMashup || isMixed;
  // Mashup pickers show a club tag, so a bare short_code placeholder reads better.
  const sideAName =
    homeSideIds.map(nameOf).filter(Boolean).join(' / ') ||
    (isMashup ? 'Side A' : `${homeClub.short_code} side`);
  const sideBName =
    awaySideIds.map(nameOf).filter(Boolean).join(' / ') ||
    (isMashup ? 'Side B' : `${awayClub.short_code} side`);

  // Unsaved if the local score or winner differs from what's stored.
  const dirty =
    (score.trim() || null) !== (line.score || null) || winner !== line.winner;

  // A saved result collapses to a read-only summary until "Edit score" is tapped.
  const hasResult = !!line.score || !!line.winner;
  const locked = hasResult && !editing && !dirty;

  const save = () => {
    // Mashup -> always false. Otherwise: mixed line -> false; a line that was
    // mixed but is now clean -> reset true; an already-clean line -> leave the
    // flag untouched (undefined).
    const counts_for_team = isMashup
      ? false
      : isMixed
      ? false
      : line.counts_for_team === false
      ? true
      : undefined;
    onSaveScore({ score: score.trim() || null, winner, counts_for_team });
    setEditing(false);
  };

  const cancelEdit = () => {
    setScore(line.score || '');
    setWinner(line.winner);
    setEditing(false);
  };

  const winnerLabel =
    line.winner === 'home'
      ? `${individual ? sideAName : homeClub.short_code} won`
      : line.winner === 'away'
      ? `${individual ? sideBName : awayClub.short_code} won`
      : 'Scored';

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="flex items-center gap-3">
          {editingName ? (
            <input
              autoFocus
              value={nameDraft}
              onChange={e => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={e => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') {
                  setNameDraft(courtName);
                  setEditingName(false);
                }
              }}
              maxLength={30}
              className="font-semibold text-sm border border-orange-400 rounded-md px-2 py-1 w-32 focus:outline-none"
              style={{ color: '#111827' }}
            />
          ) : (
            <button
              onClick={() => {
                setNameDraft(courtName);
                setEditingName(true);
              }}
              className="group inline-flex items-center gap-1.5"
              title="Rename this court (e.g. Court 5, Stadium)"
            >
              <h3 className="font-semibold text-gray-900">{courtName}</h3>
              <Pencil size={12} className="text-gray-300 group-hover:text-gray-600" />
            </button>
          )}
          {/* Singles / Doubles toggle */}
          <div className="inline-flex rounded-md border border-gray-300 overflow-hidden text-xs">
            <button
              onClick={() => onSetType('singles')}
              className={`px-2.5 py-1 font-medium ${
                !isDoubles ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              Singles
            </button>
            <button
              onClick={() => onSetType('doubles')}
              className={`px-2.5 py-1 font-medium ${
                isDoubles ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              Doubles
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <CopyScoringLink token={line.score_token} />
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
              line.status === 'completed'
                ? 'bg-green-100 text-green-700'
                : line.status === 'in_progress'
                ? 'bg-blue-100 text-blue-700'
                : 'bg-gray-100 text-gray-600'
            }`}
          >
            {line.status.replace('_', ' ')}
          </span>
          <button
            onClick={onRemove}
            className="text-gray-300 hover:text-red-600"
            title="Remove this court"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-3">
        <div>
          <div className="text-xs font-medium text-gray-500 uppercase mb-1">
            {isMashup ? 'Side B' : `Away · ${awayClub.name}`}
          </div>
          <PlayerPicker
            rosters={optionsFor(line.away_player1_id)}
            clubShortById={clubShortById}
            ownClubId={isMashup ? undefined : awayClub.id}
            value={line.away_player1_id}
            onChange={v => onAssign('away_player1_id', v)}
            placeholder={isDoubles ? 'Player 1' : 'Player'}
          />
          {isDoubles && (
            <div className="mt-2">
              <PlayerPicker
                rosters={optionsFor(line.away_player2_id)}
                clubShortById={clubShortById}
                ownClubId={isMashup ? undefined : awayClub.id}
                value={line.away_player2_id}
                onChange={v => onAssign('away_player2_id', v)}
                placeholder="Player 2"
              />
            </div>
          )}
        </div>

        <div>
          <div className="text-xs font-medium text-gray-500 uppercase mb-1">
            {isMashup ? 'Side A' : `Home · ${homeClub.name}`}
          </div>
          <PlayerPicker
            rosters={optionsFor(line.home_player1_id)}
            clubShortById={clubShortById}
            ownClubId={isMashup ? undefined : homeClub.id}
            value={line.home_player1_id}
            onChange={v => onAssign('home_player1_id', v)}
            placeholder={isDoubles ? 'Player 1' : 'Player'}
          />
          {isDoubles && (
            <div className="mt-2">
              <PlayerPicker
                rosters={optionsFor(line.home_player2_id)}
                clubShortById={clubShortById}
                ownClubId={isMashup ? undefined : homeClub.id}
                value={line.home_player2_id}
                onChange={v => onAssign('home_player2_id', v)}
                placeholder="Player 2"
              />
            </div>
          )}
        </div>
      </div>

      {locked ? (
        // Saved result — read-only summary with an Edit link to redo it.
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900">{winnerLabel}</span>
            {line.score && <span className="text-gray-600">{line.score}</span>}
            {individual && (
              <span
                className="text-[11px] font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-full px-2 py-0.5"
                title="Mixed court — counts for individual records, not the team score"
              >
                {isMashup ? 'Individual result' : 'Mixed · not in team score'}
              </span>
            )}
          </div>
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-orange-600 hover:text-orange-700 underline"
          >
            Edit score
          </button>
        </div>
      ) : (
        <>
          {individual && (
            <div className="mb-2 text-xs text-purple-700 bg-purple-50 border border-purple-200 rounded-md px-2.5 py-1.5">
              {isMashup ? 'Mish-mash court' : 'Mixed court'} — pick the winning side.
              Counts for each player&apos;s record, <strong>not</strong> the team score.
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={score}
              onChange={e => setScore(e.target.value)}
              placeholder="Score, e.g. 6-3, 6-4"
              className="flex-1 min-w-[140px] px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900"
            />
            <div className="flex gap-1">
              <button
                onClick={() => setWinner(winner === 'away' ? null : 'away')}
                className={`px-3 py-2 rounded-md text-sm font-medium ${
                  winner === 'away'
                    ? 'bg-orange-500 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {individual ? `${sideBName} won` : `${awayClub.short_code} won`}
              </button>
              <button
                onClick={() => setWinner(winner === 'home' ? null : 'home')}
                className={`px-3 py-2 rounded-md text-sm font-medium ${
                  winner === 'home'
                    ? 'bg-orange-500 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {individual ? `${sideAName} won` : `${homeClub.short_code} won`}
              </button>
            </div>
            {/* Per-court Save: writes score + winner together. */}
            <button
              onClick={save}
              disabled={saving || !dirty}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-semibold ${
                dirty
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'bg-gray-100 text-gray-400'
              } disabled:opacity-60`}
            >
              {saving ? (
                <Loader2 size={14} className="animate-spin" />
              ) : dirty ? (
                <Save size={14} />
              ) : (
                <Check size={14} />
              )}
              {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
            </button>
          </div>
          {hasResult && editing && (
            <div className="mt-1.5 text-right">
              <button
                onClick={cancelEdit}
                className="text-xs text-gray-500 hover:text-gray-800"
              >
                Cancel
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AttendanceColumn({
  label,
  rosters,
  checkedInIds,
  onToggle,
  onCheckAll,
  onClearAll,
  onMove,
  onAddPlayer,
}: {
  label: string;
  rosters: Roster[];
  checkedInIds: Set<string>;
  onToggle: (rosterId: string) => void;
  onCheckAll: () => void;
  onClearAll: () => void;
  onMove?: (rosterId: string, dir: -1 | 1) => void;
  onAddPlayer?: (name: string) => void | Promise<void>;
}) {
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const submitNew = async () => {
    if (!newName.trim() || !onAddPlayer) return;
    setAdding(true);
    await onAddPlayer(newName);
    setNewName('');
    setAdding(false);
  };
  const here = rosters.filter(r => checkedInIds.has(r.id)).length;
  const sorted = [...rosters].sort(
    (a, b) =>
      (a.ladder_position ?? 9999) - (b.ladder_position ?? 9999) ||
      a.player_name.localeCompare(b.player_name)
  );
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-xs font-medium text-gray-500 uppercase">{label}</div>
        <div className="text-xs text-gray-400">
          {here}/{rosters.length} here
        </div>
      </div>
      {rosters.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No active roster.</p>
      ) : (
        <>
          <div className="border border-gray-200 rounded-md divide-y divide-gray-100 mb-2">
            {sorted.map((r, i) => {
                const checked = checkedInIds.has(r.id);
                return (
                  <div
                    key={r.id}
                    className={`flex items-center gap-2 px-3 py-1.5 text-sm ${
                      checked ? 'bg-green-50' : ''
                    }`}
                  >
                    <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggle(r.id)}
                        className="w-4 h-4"
                      />
                      <span className="w-5 text-right text-gray-400 text-xs">
                        {`#${i + 1}`}
                      </span>
                      <span className="flex-1 truncate text-gray-900">{r.player_name}</span>
                    </label>
                    {onMove && (
                      <span className="flex items-center gap-0.5 shrink-0">
                        <button
                          onClick={() => onMove(r.id, -1)}
                          disabled={i === 0}
                          className="text-gray-400 hover:text-gray-700 disabled:opacity-30"
                          title="Move up (stronger)"
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          onClick={() => onMove(r.id, 1)}
                          disabled={i === sorted.length - 1}
                          className="text-gray-400 hover:text-gray-700 disabled:opacity-30"
                          title="Move down (weaker)"
                        >
                          <ArrowDown size={14} />
                        </button>
                      </span>
                    )}
                  </div>
                );
              })}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onCheckAll}
              className="text-xs text-orange-600 hover:text-orange-700"
            >
              Check all
            </button>
            <span className="text-gray-300">·</span>
            <button
              onClick={onClearAll}
              className="text-xs text-gray-500 hover:text-gray-800"
            >
              Clear
            </button>
          </div>
        </>
      )}
      {onAddPlayer && (
        <div className="flex gap-1.5 mt-2">
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitNew(); }}
            placeholder="Add a player…"
            className="flex-1 min-w-0 px-2 py-1 border border-gray-300 rounded text-sm text-gray-900"
          />
          <button
            onClick={submitNew}
            disabled={!newName.trim() || adding}
            className="px-2.5 py-1 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 disabled:opacity-40 shrink-0"
          >
            {adding ? 'Adding…' : '+ Add'}
          </button>
        </div>
      )}
    </div>
  );
}

function CourtsOverrideInput({
  value,
  onSet,
  defaultCourts,
}: {
  value: number | null;
  onSet: (v: number | null) => void;
  defaultCourts: number;
}) {
  const MAX = 20;
  // Effective courts in use = explicit override if set, otherwise the club default.
  const current = value ?? defaultCourts;
  const step = (delta: number) => {
    const next = Math.max(0, Math.min(MAX, current + delta));
    if (next !== current) onSet(next);
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <span className="text-xs text-gray-600">Number of courts in use for the match</span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => step(-1)}
          disabled={current <= 0}
          className="p-1.5 border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-30"
          title="One fewer court"
        >
          <ArrowDown size={16} />
        </button>
        <span className="w-10 text-center text-xl font-semibold text-gray-900 tabular-nums">
          {current}
        </span>
        <button
          onClick={() => step(1)}
          disabled={current >= MAX}
          className="p-1.5 border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-30"
          title="One more court"
        >
          <ArrowUp size={16} />
        </button>
      </div>
    </div>
  );
}

function CopyScoringLink({ token }: { token: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!token) return null;
  const url =
    typeof window !== 'undefined'
      ? `${window.location.origin}/leagues/line/${token}`
      : `/leagues/line/${token}`;
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          prompt('Copy this scoring link:', url);
        }
      }}
      title="Copy magic-link for this line"
      className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'Copied!' : 'Score link'}
    </button>
  );
}

function PlayerPicker({
  rosters,
  value,
  onChange,
  placeholder,
  clubShortById,
  ownClubId,
}: {
  rosters: Roster[];
  value: string | null;
  onChange: (v: string | null) => void;
  placeholder: string;
  clubShortById?: Map<string, string>;
  ownClubId?: string;
}) {
  const [borrow, setBorrow] = useState(false);
  // Default: only this side's own team. The current pick is always kept visible,
  // so if it's already an opposing-team player we show the full pool.
  const valueClub = rosters.find(r => r.id === value)?.club_id;
  const showAll = !ownClubId || borrow || (!!value && valueClub !== ownClubId);
  const opts = showAll ? rosters : rosters.filter(r => r.club_id === ownClubId || r.id === value);
  const ownShort = ownClubId ? clubShortById?.get(ownClubId) : undefined;

  return (
    <div>
      <select
        value={value || ''}
        onChange={e => onChange(e.target.value || null)}
        className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm text-gray-900"
      >
        <option value="">{placeholder} — choose —</option>
        {opts.map(r => {
          const club = clubShortById?.get(r.club_id);
          const label = showAll && club ? `${r.player_name} · ${club}` : r.player_name;
          return (
            <option key={r.id} value={r.id}>{label}</option>
          );
        })}
      </select>
      {ownClubId && (
        showAll ? (
          <button
            type="button"
            onClick={() => setBorrow(false)}
            className="mt-1 text-[11px] text-gray-400 hover:text-gray-700"
          >
            ↩ Show only {ownShort || 'my team'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setBorrow(true)}
            className="mt-1 text-[11px] text-orange-600 hover:text-orange-700"
          >
            + Use player from opposing team
          </button>
        )
      )}
    </div>
  );
}

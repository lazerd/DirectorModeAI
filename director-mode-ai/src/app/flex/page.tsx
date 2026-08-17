import { getSupabaseAdmin } from '@/lib/supabase/admin';
import FlexHub, { type ChampionT, type Division, type GroupT, type MatchT } from './FlexHub';
import { syncFlexPlayoffs } from '@/lib/flexPlayoffs';
import {
  FLEX_CONFIG, allPairs, gamesPct, groupStandings, isGroupComplete, pairKey, placementLabel,
} from '@/lib/flexDivisions';

export const dynamic = 'force-dynamic';

const pct = (s: { gf: number; ga: number }) => (s.gf + s.ga ? Math.round(gamesPct(s) * 100) + '%' : '—');

export default async function FlexPage() {
  const admin = getSupabaseAdmin();
  const divisions: Division[] = [];

  for (const cfg of FLEX_CONFIG) {
    const { data: ev } = await admin.from('events').select('id').eq('slug', cfg.slug).maybeSingle();
    if (!ev) continue;
    const eid = (ev as { id: string }).id;

    // Auto-populate placement playoffs BEFORE reading matches, so a flight that
    // just finished shows its playoff on this very render.
    await syncFlexPlayoffs(admin, eid, cfg).catch(() => null);

    const { data: entries } = await admin
      .from('tournament_entries').select('id, player_name, partner_name').eq('event_id', eid);
    const nameById = new Map(
      ((entries as Array<{ id: string; player_name: string; partner_name: string | null }>) || []).map((e) => [
        e.id, e.partner_name ? `${e.player_name} / ${e.partner_name}` : e.player_name,
      ])
    );
    const { data: matches } = await admin
      .from('tournament_matches')
      .select('score_token, bracket, round, slot, player1_id, player3_id, score, winner_side, status').eq('event_id', eid);
    const allMatches = (matches as Array<Record<string, unknown>>) || [];

    const toMatchT = (m: Record<string, unknown>): MatchT => ({
      token: m.score_token as string,
      a: (nameById.get(m.player1_id as string) as string) || 'TBD',
      b: (nameById.get(m.player3_id as string) as string) || 'TBD',
      score: (m.score as string) || '',
      winner_side: (m.winner_side as 'a' | 'b' | null) || null,
      status: m.status as string,
    });

    const byPair = new Map<string, MatchT>();
    for (const m of allMatches) {
      const mt = toMatchT(m);
      byPair.set(pairKey(mt.a, mt.b), mt);
    }
    const lookup = (a: string, b: string): MatchT => {
      // ALWAYS present in DB order (a = player1, b = player3) so the winner
      // buttons' 'a'/'b' match exactly what the score API writes. Previously this
      // swapped display order + flipped winner_side when the stored order differed
      // from the pool's config order — but the buttons still posted raw 'a'/'b',
      // so a swapped match recorded (and showed) the OPPOSITE winner.
      return byPair.get(pairKey(a, b)) || { token: '', a, b, score: '', winner_side: null, status: 'pending' };
    };

    if (cfg.type === 'compass') {
      const STAGE_LABEL: Record<string, string> = {
        'main:1': 'Round 1 — everyone starts here', 'main:2': 'East · Round 2', 'main:3': 'East · Semifinals', 'main:4': 'East · Championship Final',
        'consolation:1': 'West · Round 1', 'consolation:2': 'West · Round 2', 'consolation:3': 'West · Final',
        'consolation:4': 'North · Round 1', 'consolation:5': 'North · Final',
        'consolation:6': 'South · Round 1', 'consolation:7': 'South · Final',
        'consolation:8': 'Northeast', 'consolation:9': 'Southwest', 'consolation:10': 'Northwest', 'consolation:11': 'Southeast',
      };
      const ORDER = ['main:1', 'main:2', 'main:3', 'main:4', 'consolation:1', 'consolation:2', 'consolation:3', 'consolation:4', 'consolation:5', 'consolation:6', 'consolation:7', 'consolation:8', 'consolation:9', 'consolation:10', 'consolation:11'];
      const byStage: Record<string, { slot: number; m: MatchT }[]> = {};
      for (const mm of allMatches) {
        const key = `${mm.bracket}:${mm.round}`;
        (byStage[key] ??= []).push({ slot: mm.slot as number, m: toMatchT(mm) });
      }
      const groups = ORDER.filter((k) => byStage[k]).map((k) => ({
        title: STAGE_LABEL[k], standings: null, matches: byStage[k].sort((x, y) => x.slot - y.slot).map((r) => r.m),
      }));
      // Structured stage → match map so the visual draw can render every
      // direction (East main + West/North/South/corner consolations) and fill
      // in winners live as results come in.
      const compassStages: Record<string, MatchT[]> = {};
      for (const k of ORDER) {
        if (byStage[k]) compassStages[k] = byStage[k].slice().sort((x, y) => x.slot - y.slot).map((r) => r.m);
      }
      // The East final decides the division outright.
      const champions: ChampionT[] = [];
      const final = (compassStages['main:4'] || [])[0];
      if (final && final.status === 'completed' && final.winner_side) {
        const won = final.winner_side === 'a';
        champions.push({
          crownTitle: cfg.crownTitle || `${cfg.name} Champion`,
          name: won ? final.a : final.b,
          runnerUp: won ? final.b : final.a,
          recordLine: 'Compass draw — East champion',
          clincher: `Won the final ${winnerFirst(final.score, final.winner_side)}`,
          road: [],
          podium: [],
        });
      }
      divisions.push({ id: cfg.id, name: cfg.name, num: cfg.num, color: cfg.color, accent: cfg.accent, type: 'compass', compassR1: cfg.r1, compassStages, groups, playoffGroups: [], champions });
      continue;
    }

    // ---- Round-robin flights ----
    const groupCfg = cfg.groups || {};
    const groups: GroupT[] = Object.entries(groupCfg).map(([title, members]) => {
      const ms = allPairs(members).map(([a, b]) => lookup(a, b));
      const standings = groupStandings(members, ms).map((s) => ({ ...s }));
      return { title, matches: ms, standings, complete: isGroupComplete(members, ms) };
    });

    // ---- Placement playoffs (auto-generated above) ----
    const playoffGroups: GroupT[] = [];
    const champions: ChampionT[] = [];

    for (const po of cfg.playoffs || []) {
      const rows = allMatches
        .filter((m) => m.bracket === 'main' && (m.round as number) === po.round)
        .sort((x, y) => (x.slot as number) - (y.slot as number));
      if (rows.length === 0) continue;

      const feederTitles = po.from;
      const pending = feederTitles.filter((t) => !groups.find((g) => g.title === t)?.complete);
      playoffGroups.push({
        title: po.title,
        subtitle: pending.length
          ? `Waiting on ${pending.join(' and ')} to finish — the other side is already seeded.`
          : `${feederTitles[0]} vs ${feederTitles[1]} — seeded by final flight standings.`,
        matches: rows.map((m) => ({ ...toMatchT(m), label: placementLabel(m.slot as number, po.crownTitle) })),
        standings: null,
        isPlayoff: true,
      });

      // Title match decided → crown.
      const finalRow = rows.find((m) => (m.slot as number) === 1);
      const finalM = finalRow ? toMatchT(finalRow) : null;
      if (finalM && finalM.status === 'completed' && finalM.winner_side) {
        const won = finalM.winner_side === 'a';
        champions.push({
          crownTitle: po.crownTitle,
          name: won ? finalM.a : finalM.b,
          runnerUp: won ? finalM.b : finalM.a,
          recordLine: 'Won the placement playoff final',
          clincher: `def. ${won ? finalM.b : finalM.a} ${winnerFirst(finalM.score, finalM.winner_side)}`,
          road: [],
          podium: podiumFromPlayoff(rows.map(toMatchT)),
        });
      }
    }

    // ---- Single-flight divisions crown the round-robin winner outright ----
    if (!cfg.playoffs?.length && groups.length === 1 && groups[0].complete && cfg.crownTitle) {
      const g = groups[0];
      const winner = g.standings![0];
      const road = g.matches
        .filter((m) => m.a === winner.name || m.b === winner.name)
        .map((m) => {
          const isA = m.a === winner.name;
          return {
            opponent: isA ? m.b : m.a,
            score: winnerFirst(m.score, m.winner_side),
            won: (m.winner_side === 'a') === isA,
          };
        });
      champions.push({
        crownTitle: cfg.crownTitle,
        name: winner.name,
        runnerUp: g.standings![1]?.name || null,
        recordLine: `${winner.w}–${winner.l}${winner.l === 0 ? ' · undefeated' : ''} · ${winner.gf} games won, ${winner.ga} lost (${pct(winner)})`,
        clincher: null,
        road,
        podium: g.standings!.map((s, i) => ({
          place: i + 1, name: s.name, wl: `${s.w}–${s.l}`, pct: pct(s),
        })),
      });
    }

    divisions.push({ id: cfg.id, name: cfg.name, num: cfg.num, color: cfg.color, accent: cfg.accent, type: 'group', groups, playoffGroups, champions });
  }

  return <FlexHub divisions={divisions} />;
}

/** Show a score winner-first so it reads naturally next to "winner def. loser". */
function winnerFirst(score: string, winner: 'a' | 'b' | null): string {
  if (!score || winner !== 'b') return score;
  return score
    .split(',')
    .map((s) => {
      const m = s.trim().match(/^(\d+)\s*-\s*(\d+)(.*)$/);
      return m ? `${m[2]}-${m[1]}${m[3] ?? ''}` : s.trim();
    })
    .join(', ');
}

/** Slot 1 decides 1st/2nd, slot 2 decides 3rd/4th, and so on. */
function podiumFromPlayoff(ms: MatchT[]): { place: number; name: string; wl: string; pct: string }[] {
  const out: { place: number; name: string; wl: string; pct: string }[] = [];
  ms.forEach((m, i) => {
    if (m.status !== 'completed' || !m.winner_side) return;
    const won = m.winner_side === 'a';
    out.push({ place: i * 2 + 1, name: won ? m.a : m.b, wl: 'W', pct: '' });
    out.push({ place: i * 2 + 2, name: won ? m.b : m.a, wl: 'L', pct: '' });
  });
  return out;
}

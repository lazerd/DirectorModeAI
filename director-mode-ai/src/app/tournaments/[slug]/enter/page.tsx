import { getSupabaseAdmin } from '@/lib/supabase/admin';
import EnterScores, { type EnterGroup, type Row } from './EnterScores';

export const dynamic = 'force-dynamic';

type Match = {
  id: string;
  score_token: string;
  bracket: string;
  round: number;
  slot: number;
  player1_id: string | null;
  player3_id: string | null;
  score: string | null;
  winner_side: 'a' | 'b' | null;
  status: string;
  winner_feeds_to: string | null;
  loser_feeds_to: string | null;
};

const keyOf = (m: { bracket: string; round: number; slot: number }) =>
  `${m.bracket}:${m.round}:${m.slot}`;
// A feed ref is "bracket:round:slot:side" — the destination match is the first 3.
const destKeyOf = (ref: string | null) => (ref ? ref.split(':').slice(0, 3).join(':') : null);
const ordinal = (n: number) => ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'][n] || `${n}th`;

/**
 * Describe a win/loss path so a coach knows exactly who plays in a stage, e.g.
 * ['W','L'] -> "won their 1st match, then lost their 2nd match". Empty = round 1.
 */
function describePath(path: ('W' | 'L')[]): string {
  if (path.length === 0) return 'Everyone plays here — first match for all players.';
  const parts = path.map((r, i) => `${r === 'W' ? 'won' : 'lost'} their ${ordinal(i + 1)} match`);
  const joined =
    parts.length === 1 ? parts[0] : parts.slice(0, -1).join(', ') + ', then ' + parts[parts.length - 1];
  return `For players who ${joined}.`;
}

export default async function EnterScoresPage({ params }: { params: { slug: string } }) {
  const admin = getSupabaseAdmin();
  const { data: ev } = await admin
    .from('events')
    .select('id, name, format_notes, match_format')
    .eq('slug', params.slug)
    .maybeSingle();
  if (!ev) {
    return (
      <main style={{ fontFamily: 'system-ui, sans-serif', padding: 40, color: '#1f2937' }}>
        Event not found.
      </main>
    );
  }
  const e = ev as { id: string; name: string; format_notes: string | null; match_format: string };

  const { data: entries } = await admin
    .from('tournament_entries')
    .select('id, player_name, partner_name')
    .eq('event_id', e.id);
  const nameById = new Map(
    ((entries as Array<{ id: string; player_name: string; partner_name: string | null }>) || []).map((en) => [
      en.id,
      en.partner_name ? `${en.player_name} / ${en.partner_name}` : en.player_name,
    ])
  );

  const { data: matchData } = await admin
    .from('tournament_matches')
    .select(
      'id, score_token, bracket, round, slot, player1_id, player3_id, score, winner_side, status, winner_feeds_to, loser_feeds_to'
    )
    .eq('event_id', e.id)
    .order('round')
    .order('slot');
  const matches = (matchData as Match[]) || [];

  const toRow = (m: Match): Row => ({
    token: m.score_token,
    a: (m.player1_id && nameById.get(m.player1_id)) || 'TBD',
    b: (m.player3_id && nameById.get(m.player3_id)) || 'TBD',
    score: m.score || '',
    winner_side: m.winner_side,
    status: m.status,
  });

  // --- Build the feed graph so stages read "1st matches, then 2nd matches…" ---
  const hasFeeds = matches.some((m) => m.winner_feeds_to || m.loser_feeds_to);
  // incoming edges: for each destination match, how its players got there
  const incoming = new Map<string, { from: string; type: 'W' | 'L' }[]>();
  const addEdge = (dest: string | null, from: string, type: 'W' | 'L') => {
    if (!dest) return;
    if (!incoming.has(dest)) incoming.set(dest, []);
    incoming.get(dest)!.push({ from, type });
  };
  for (const m of matches) {
    addEdge(destKeyOf(m.winner_feeds_to), keyOf(m), 'W');
    addEdge(destKeyOf(m.loser_feeds_to), keyOf(m), 'L');
  }

  const depthMemo = new Map<string, number>();
  const pathMemo = new Map<string, ('W' | 'L')[]>();
  const guard = new Set<string>();
  const depthOf = (k: string): number => {
    if (depthMemo.has(k)) return depthMemo.get(k)!;
    if (guard.has(k)) return 1; // cycle safety (shouldn't happen in a valid draw)
    guard.add(k);
    const ins = incoming.get(k) || [];
    const d = ins.length === 0 ? 1 : 1 + Math.max(...ins.map((edge) => depthOf(edge.from)));
    guard.delete(k);
    depthMemo.set(k, d);
    return d;
  };
  const pathOf = (k: string): ('W' | 'L')[] => {
    if (pathMemo.has(k)) return pathMemo.get(k)!;
    const ins = incoming.get(k) || [];
    if (ins.length === 0) { pathMemo.set(k, []); return []; }
    const rep = ins[0]; // both sides of a compass stage share the same win/loss path
    const p: ('W' | 'L')[] = [...pathOf(rep.from), rep.type];
    pathMemo.set(k, p);
    return p;
  };

  let groups: EnterGroup[] = [];

  if (hasFeeds) {
    // Group by stage (bracket:round). Order: match number (depth), then the
    // winners' side before the consolation side, then round/slot.
    type Stage = {
      stageKey: string;
      depth: number;
      path: ('W' | 'L')[];
      terminal: boolean;
      sample: Match;
      ms: Match[];
    };
    const stages = new Map<string, Stage>();
    for (const m of matches) {
      const sk = `${m.bracket}:${m.round}`;
      if (!stages.has(sk)) {
        stages.set(sk, {
          stageKey: sk,
          depth: depthOf(keyOf(m)),
          path: pathOf(keyOf(m)),
          terminal: false,
          sample: m,
          ms: [],
        });
      }
      const st = stages.get(sk)!;
      st.ms.push(m);
      if (!m.winner_feeds_to) st.terminal = true; // no onward match = a final
    }
    const ordered = [...stages.values()].sort(
      (a, b) =>
        a.depth - b.depth ||
        (a.path[0] === 'L' ? 1 : 0) - (b.path[0] === 'L' ? 1 : 0) ||
        a.sample.bracket.localeCompare(b.sample.bracket) ||
        a.sample.round - b.sample.round
    );
    groups = ordered.map((st) => {
      const roundLabel = `Round ${st.depth}`;
      const side = st.path.length === 0 ? '' : st.path[0] === 'W' ? "Winners' side" : 'Consolation side';
      const undefeated = st.terminal && st.path.length > 0 && st.path.every((x) => x === 'W');
      const title =
        st.path.length === 0
          ? `${roundLabel} — First matches`
          : undefeated
            ? `${roundLabel} — Championship`
            : st.terminal
              ? `${roundLabel} — Playoff · ${side}`
              : `${roundLabel} · ${side}`;
      return {
        key: st.stageKey,
        title,
        description: describePath(st.path),
        matches: st.ms.sort((a, b) => a.slot - b.slot).map(toRow),
      };
    });
  } else {
    // Round-robin (no feeds): group by round, note flight when slots are banded.
    const FLIGHT = ['Flight A', 'Flight B', 'Flight C', 'Flight D', 'Flight E', 'Flight F'];
    const multiFlight = matches.some((m) => (m.slot ?? 0) >= 100);
    const bucket = new Map<string, Match[]>();
    for (const m of matches) {
      const band = Math.floor((m.slot ?? 1) / 100);
      const gk = `${m.round}:${band}`;
      if (!bucket.has(gk)) bucket.set(gk, []);
      bucket.get(gk)!.push(m);
    }
    groups = [...bucket.entries()]
      .sort((a, b) => {
        const [ar, ab] = a[0].split(':').map(Number);
        const [br, bb] = b[0].split(':').map(Number);
        return ar - br || ab - bb;
      })
      .map(([gk, ms]) => {
        const [round, band] = gk.split(':').map(Number);
        return {
          key: gk,
          title: multiFlight ? `Round ${round} · ${FLIGHT[band] ?? `Flight ${band + 1}`}` : `Round ${round}`,
          description: '',
          matches: ms.sort((a, b) => a.slot - b.slot).map(toRow),
        };
      });
  }

  // Fallback: if grouping produced nothing, show one flat list.
  if (groups.length === 0 && matches.length > 0) {
    groups = [{ key: 'all', title: 'Matches', description: '', matches: matches.map(toRow) }];
  }

  return <EnterScores eventName={e.name} notes={e.format_notes || ''} groups={groups} />;
}

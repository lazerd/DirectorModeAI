import { getSupabaseAdmin } from '@/lib/supabase/admin';
import FlexHub, { type Division, type MatchT } from './FlexHub';

export const dynamic = 'force-dynamic';

const td = (t: string[]) => t.join(' / ');
const allPairs = (a: string[]): [string, string][] => {
  const r: [string, string][] = [];
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) r.push([a[i], a[j]]);
  return r;
};
const pairKey = (a: string, b: string) => [a, b].map((s) => s.toLowerCase()).sort().join(' ~~ ');
function parseGames(score: string): [number, number] {
  let ga = 0, gb = 0;
  for (const set of (score || '').split(/[,;]/)) {
    const m = set.trim().match(/^(\d+)\s*-\s*(\d+)/);
    if (m) { ga += +m[1]; gb += +m[2]; }
  }
  return [ga, gb];
}

const CONFIG = [
  {
    id: 'mens-singles', slug: 'mens-singles-flex-2026', name: "Men's Singles", num: '01',
    color: '#1B448C', accent: '#2052A8', type: 'compass' as const,
    r1: [['Harman Batra', 'Craig Sato'], ['Blair Schmicker', 'Walden Browne'], ['Darryl Rains', 'Simon Chan'], ['Justin White', 'Decio Shimura'], ['Abhijeet Kumar', 'Gabe Fett'], ['Tony Helvey', 'Dimitry Lerner'], ['Powell Jose', 'Oliver Gibbons'], ['Alex Rogin', 'Adam Branson']] as [string, string][],
  },
  {
    id: 'womens-singles', slug: 'womens-singles-flex-2026', name: "Women's Singles", num: '02',
    color: '#E03313', accent: '#FF4A26', type: 'group' as const,
    groups: {
      'Championship · Flight A': ['Jennifer Stern', 'Sarah Binder', 'Heather Young', 'Allison Weinstein'],
      'Championship · Flight B': ['Chelsea McClure', 'Shannon Moore', 'Katie Shogan', 'Karen Yoo'],
      'Challenger · Flight A': ['Vi Le', 'Laurie Coyle', 'Caedmon Patalano', 'Nancy Jiang'],
      'Challenger · Flight B': ['Jillian Helvey', 'Erica Desjardins', 'Julie Bryant', 'Megan Sullivan'],
    } as Record<string, string[]>,
  },
  {
    id: 'mens-doubles', slug: 'mens-doubles-flex-2026', name: "Men's Doubles", num: '03',
    color: '#0C7B8C', accent: '#109AAD', type: 'group' as const,
    groups: { 'Round Robin': [td(['Walden Browne', 'Simon Chan']), td(['Sinan Akay', 'Adam Branson']), td(['Gabe Fett', 'Oliver Gibbons']), td(['Craig Sato', 'Justin White'])] } as Record<string, string[]>,
  },
  {
    id: 'womens-doubles', slug: 'womens-doubles-flex-2026', name: "Women's Doubles", num: '04',
    color: '#B07D00', accent: '#F5B000', type: 'group' as const,
    groups: {
      'Championship · Pool 1': [td(['Chitra Balasubramanian', 'Kersti Peter']), td(['Sarah Binder', 'Leena Elias']), td(['Yvette Girard', 'Dena McManis']), td(['Allison Weinstein', 'Jen Acker Parks'])],
      'Championship · Pool 2': [td(['Anne Schwaikert', 'Daralisa Kelley']), td(['Heather Young', 'Leah Branson']), td(['Robyn Rogin', 'Katie Shogan']), td(['Lauren Disston', 'Danielle Hawley'])],
      'Challenger · Pool 1': [td(['Erica Desjardins', 'Christina Gibbons']), td(['Vi Le', 'Jen Hill']), td(['Jessica Howard', 'Liz Lawrence'])],
      'Challenger · Pool 2': [td(['Julie Bryant', 'Jennifer Walker']), td(['Megan Sullivan', 'Kate Woodcox']), td(['Meghan Schmicker', 'Susie Hsu'])],
    } as Record<string, string[]>,
  },
];

export default async function FlexPage() {
  const admin = getSupabaseAdmin();
  const divisions: Division[] = [];

  for (const cfg of CONFIG) {
    const { data: ev } = await admin.from('events').select('id').eq('slug', cfg.slug).maybeSingle();
    if (!ev) continue;
    const eid = (ev as { id: string }).id;
    const { data: entries } = await admin
      .from('tournament_entries').select('id, player_name, partner_name').eq('event_id', eid);
    const nameById = new Map(
      ((entries as Array<{ id: string; player_name: string; partner_name: string | null }>) || []).map((e) => [
        e.id, e.partner_name ? `${e.player_name} / ${e.partner_name}` : e.player_name,
      ])
    );
    const { data: matches } = await admin
      .from('tournament_matches')
      .select('score_token, player1_id, player3_id, score, winner_side, status').eq('event_id', eid);
    const byPair = new Map<string, { token: string; a: string; b: string; score: string; winner_side: 'a' | 'b' | null; status: string }>();
    for (const m of (matches as Array<Record<string, unknown>>) || []) {
      const a = (nameById.get(m.player1_id as string) as string) || 'TBD';
      const b = (nameById.get(m.player3_id as string) as string) || 'TBD';
      byPair.set(pairKey(a, b), {
        token: m.score_token as string, a, b,
        score: (m.score as string) || '', winner_side: (m.winner_side as 'a' | 'b' | null) || null, status: m.status as string,
      });
    }
    const lookup = (a: string, b: string): MatchT => {
      const m = byPair.get(pairKey(a, b));
      if (!m) return { token: '', a, b, score: '', winner_side: null, status: 'pending' };
      if (m.a.toLowerCase() === a.toLowerCase()) return m;
      return { ...m, a: m.b, b: m.a, winner_side: m.winner_side === 'a' ? 'b' : m.winner_side === 'b' ? 'a' : null };
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
      for (const mm of (matches as Array<Record<string, unknown>>) || []) {
        const key = `${mm.bracket}:${mm.round}`;
        const a = (nameById.get(mm.player1_id as string) as string) || 'TBD';
        const b = (nameById.get(mm.player3_id as string) as string) || 'TBD';
        (byStage[key] ??= []).push({ slot: mm.slot as number, m: { token: mm.score_token as string, a, b, score: (mm.score as string) || '', winner_side: (mm.winner_side as 'a' | 'b' | null) || null, status: mm.status as string } });
      }
      const groups = ORDER.filter((k) => byStage[k]).map((k) => ({
        title: STAGE_LABEL[k], standings: null, matches: byStage[k].sort((x, y) => x.slot - y.slot).map((r) => r.m),
      }));
      divisions.push({ id: cfg.id, name: cfg.name, num: cfg.num, color: cfg.color, accent: cfg.accent, type: 'compass', compassR1: cfg.r1, groups });
      continue;
    }

    const groups = Object.entries(cfg.groups).map(([title, members]) => {
      const ms = allPairs(members).map(([a, b]) => lookup(a, b));
      const st = new Map(members.map((n) => [n, { name: n, w: 0, l: 0, gf: 0, ga: 0 }]));
      for (const mt of ms) {
        if (mt.status !== 'completed' || !mt.winner_side) continue;
        const [ga, gb] = parseGames(mt.score);
        const A = st.get(mt.a), B = st.get(mt.b);
        if (!A || !B) continue;
        A.gf += ga; A.ga += gb; B.gf += gb; B.ga += ga;
        if (mt.winner_side === 'a') { A.w++; B.l++; } else { B.w++; A.l++; }
      }
      const standings = [...st.values()].sort((x, y) => y.w - x.w || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf);
      return { title, matches: ms, standings };
    });
    divisions.push({ id: cfg.id, name: cfg.name, num: cfg.num, color: cfg.color, accent: cfg.accent, type: 'group', groups });
  }

  return <FlexHub divisions={divisions} />;
}

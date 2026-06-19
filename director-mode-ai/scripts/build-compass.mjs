// Rebuild the Men's Singles event as a full 16-player COMPASS draw:
// 32 matches across all 8 directions, each wired with winner_feeds_to +
// loser_feeds_to so the existing /api/tournaments/match/[token] auto-advance
// routes winners East and losers into West/North/South/NE/NW/SE/SW.
// Run: node scripts/build-compass.mjs [--commit]
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const COMMIT = process.argv.includes('--commit');

// direction → (bracket, round). bracket limited to main|consolation by schema.
const S = {
  R1:  { bracket: 'main',        round: 1, n: 8, w: 'ER2', l: 'WR1' }, // start
  ER2: { bracket: 'main',        round: 2, n: 4, w: 'ESF', l: 'NR1' }, // East R2
  ESF: { bracket: 'main',        round: 3, n: 2, w: 'EF',  l: 'NE'  }, // East semis
  EF:  { bracket: 'main',        round: 4, n: 1, w: null,  l: null  }, // East final (champ)
  WR1: { bracket: 'consolation', round: 1, n: 4, w: 'WR2', l: 'SR1' },
  WR2: { bracket: 'consolation', round: 2, n: 2, w: 'WF',  l: 'SW'  },
  WF:  { bracket: 'consolation', round: 3, n: 1, w: null,  l: null  },
  NR1: { bracket: 'consolation', round: 4, n: 2, w: 'NF',  l: 'NW'  },
  NF:  { bracket: 'consolation', round: 5, n: 1, w: null,  l: null  },
  SR1: { bracket: 'consolation', round: 6, n: 2, w: 'SF',  l: 'SE'  },
  SF:  { bracket: 'consolation', round: 7, n: 1, w: null,  l: null  },
  NE:  { bracket: 'consolation', round: 8, n: 1, w: null,  l: null  },
  SW:  { bracket: 'consolation', round: 9, n: 1, w: null,  l: null  },
  NW:  { bracket: 'consolation', round: 10, n: 1, w: null, l: null  },
  SE:  { bracket: 'consolation', round: 11, n: 1, w: null, l: null  },
};
const R1 = [['Harman Batra', 'Craig Sato'], ['Blair Schmicker', 'Walden Browne'], ['Darryl Rains', 'Simon Chan'], ['Justin White', 'Decio Shimura'], ['Abhijeet Kumar', 'Gabe Fett'], ['Alex Rogin', 'Dimitry Lerner'], ['Powell Jose', 'Oliver Gibbons'], ['Tony Helvey', 'Adam Branson']];

// feeders pair (1,2)->slot1, (3,4)->slot2; odd source -> side a, even -> side b
const ref = (destKey, s) => { const d = S[destKey]; return `${d.bracket}:${d.round}:${Math.ceil(s / 2)}:${s % 2 === 1 ? 'a' : 'b'}`; };

const { data: ev } = await admin.from('events').select('id').eq('slug', 'mens-singles-flex-2026').single();
const { data: entries } = await admin.from('tournament_entries').select('id, player_name').eq('event_id', ev.id);
const id = (name) => { const e = (entries || []).find((x) => x.player_name === name); if (!e) throw new Error('no entry: ' + name); return e.id; };

const rows = [];
for (const [key, st] of Object.entries(S)) {
  for (let s = 1; s <= st.n; s++) {
    rows.push({
      event_id: ev.id, bracket: st.bracket, round: st.round, slot: s, match_type: 'singles',
      player1_id: key === 'R1' ? id(R1[s - 1][0]) : null,
      player3_id: key === 'R1' ? id(R1[s - 1][1]) : null,
      winner_feeds_to: st.w ? ref(st.w, s) : null,
      loser_feeds_to: st.l ? ref(st.l, s) : null,
      status: 'pending',
    });
  }
}
console.log(`Compass matches to create: ${rows.length}`);
for (const [k, st] of Object.entries(S)) console.log(`  ${k}: ${st.n} match(es) at ${st.bracket}:${st.round}  win->${st.w || 'TERMINAL'} lose->${st.l || 'TERMINAL'}`);

if (!COMMIT) { console.log('\nDRY RUN — add --commit to rebuild the Men\'s Singles event.'); process.exit(0); }
await admin.from('tournament_matches').delete().eq('event_id', ev.id);
const { error } = await admin.from('tournament_matches').insert(rows);
if (error) { console.log('ERROR:', error.message); process.exit(1); }
console.log(`\n✓ Rebuilt Men's Singles as a full compass (${rows.length} matches). Auto-advance is live.`);

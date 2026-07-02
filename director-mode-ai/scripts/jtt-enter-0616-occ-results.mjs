// Enter 2026-06-16 results for the three OCC-host matchups in Lamorinda JTT:
//   10U OCC vs MDW, 12U OCC vs MDW, 13O OCC vs RAN.
// HOME = OCC in all three; score stored HOME-AWAY (OCC games first).
// Deletes the scheduled stub lines on each matchup, then inserts the lines
// played fully assigned/scored/completed. The recompute trigger sets each
// matchup aggregate + winner, feeding standings.
//
// Missing roster players are auto-created (Meadow has no roster yet; a few new
// OCC kids). Names are written to match existing roster spelling where one
// exists so we don't create duplicates.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const DRY = process.argv.includes('--dry');
const REPORTER = 'Director entry (0616 OCC)';

// U12 3rd doubles: "Williams/Ross def James/Evan 6-1" had no club label and is
// the deciding line. Set this once Darrin confirms which pair is OCC:
//   'home' -> Williams/Ross are OCC (OCC wins 3-2)
//   'away' -> James/Evan are OCC (Meadow wins 3-2)
//   null   -> omit the line (matchup shows 2-2 tie)
// PROVISIONAL (2026-06-17): Darrin is confirming with the other coach. Assumed
// Williams/Ross = OCC -> 'home'. Flip to 'away' if it turns out James/Evan are OCC.
const U12_3DBS_WINNER = 'home';

const { data: league } = await admin.from('leagues').select('id').eq('slug', 'lamorinda-jtt-summer-2026').single();
const { data: clubs } = await admin.from('league_clubs').select('id, short_code').eq('league_id', league.id);
const clubId = s => clubs.find(c => c.short_code === s).id;
const { data: divs } = await admin.from('league_divisions').select('id, short_code').eq('league_id', league.id);
const divId = s => divs.find(d => d.short_code === s).id;

const norm = s => s.trim().toLowerCase();
async function rosterMap(divShort, clubShort) {
  const { data } = await admin.from('league_team_rosters').select('id, player_name, ladder_position')
    .eq('division_id', divId(divShort)).eq('club_id', clubId(clubShort));
  return { rows: data, byName: new Map(data.map(r => [norm(r.player_name), r])) };
}
const created = [];
async function resolve(divShort, clubShort, name) {
  if (!name) return null;
  const rm = await rosterMap(divShort, clubShort);
  const hit = rm.byName.get(norm(name));
  if (hit) return hit.id;
  const nextPos = (rm.rows.reduce((mx, r) => Math.max(mx, r.ladder_position ?? 0), 0)) + 1;
  if (DRY) { created.push(`${divShort} ${clubShort}: ${name} (#${nextPos})`); return `NEW:${clubShort}:${name}`; }
  const { data, error } = await admin.from('league_team_rosters')
    .insert({ division_id: divId(divShort), club_id: clubId(clubShort), player_name: name, ladder_position: nextPos, status: 'active' })
    .select('id').single();
  if (error) throw new Error(`create ${name}: ${error.message}`);
  created.push(`${divShort} ${clubShort}: ${name} (#${nextPos})`);
  return data.id;
}

// HOME=OCC, AWAY=opponent. score is HOME-AWAY (OCC games first).
const MATCHUPS = [
  { div: '10U', away: 'MDW', id: '825f688e-e14a-488a-a53f-629897214e8d', lines: [
    { type: 'singles', home: ['Thomas Voelker'],               away: ['Owen'],           score: '7-5', winner: 'home' }, // Thomas Voelker def Owen 7-5
    { type: 'singles', home: ['Luke Korpi'],                   away: ['Oden'],           score: '2-6', winner: 'away' }, // Oden def Luke Korpi 6-2
    { type: 'doubles', home: ['Will Cleveland', 'McCashin'],   away: ['Cameron', 'Ben'], score: '2-6', winner: 'away' }, // Cameron/Ben def Will/McCashin 6-2
    { type: 'doubles', home: ['Van Voelker', 'Rory Frase'],    away: ['Nina', 'Nick'],   score: '4-6', winner: 'away' }, // Nina/Nick def Van/Rory 6-4
  ]},
  { div: '12U', away: 'MDW', id: '558715e4-1d57-4c53-be45-3e8f81bf5aeb', lines: [
    { type: 'singles', home: ['Kai Krimmel'],                  away: ['Luca'],            score: '6-3', winner: 'home' }, // Kai Krimmel def Luca 6-3
    { type: 'singles', home: ['Aidan Frase'],                  away: ['Nico'],            score: '6-3', winner: 'home' }, // Aiden(Aidan) Frase def Nico 6-3
    { type: 'doubles', home: ['Tseng', "Charlie O'Sullivan"],  away: ['Kai', 'Whitaker'], score: '4-6', winner: 'away' }, // Kai/Whitaker def Tseng/O'Sullivan 6-4
    { type: 'doubles', home: ['Cora Gaffney', 'Kippels'],      away: ['Alec', 'Will'],    score: '4-6', winner: 'away' }, // Alec/Will def Gaffney/Kippels 6-4
    // 3dbs pending club assignment — added only if U12_3DBS_WINNER set:
    { type: 'doubles', home: ['Williams', 'Ross'],             away: ['James', 'Evan'],   score: '6-1', winner: U12_3DBS_WINNER, _pending3dbs: true },
  ]},
  { div: '13O', away: 'RAN', id: '3c1766e4-de5f-41ae-a119-d535b4dd379a', lines: [
    { type: 'singles', home: ['Posey'],                        away: ['Dominic Obertello'], score: '6-3', winner: 'home' }, // Posey def Dom 6-3
    { type: 'singles', home: ['Declan Tseng'],                 away: ['Lucy Mercier'],      score: '6-2', winner: 'home' }, // D Tseng def Lucy 6-2
    { type: 'doubles', home: ['A Posey', 'Kubas'],             away: [null, null],          score: '6-3', winner: 'home' }, // A Posey/Kubas def (Rancho names not recorded) 6-3
    { type: 'doubles', home: ['McIlwain', 'Owen Rapp'],        away: ['Cian Feeley', 'Vivek Prabhakara'], score: '6-3', winner: 'home' }, // McIlwain/Rapp def Cian/Vivak 6-3
  ]},
];

for (const mu of MATCHUPS) {
  const HOME = 'OCC', AWAY = mu.away;
  console.log(`\n=== ${mu.div}  OCC(H) vs ${AWAY}(A) ===`);
  if (!DRY) await admin.from('league_matchup_lines').delete().eq('matchup_id', mu.id);
  let n = 1;
  for (const ln of mu.lines) {
    if (ln._pending3dbs && U12_3DBS_WINNER === null) {
      console.log(`  L5 doubles: SKIPPED (3dbs club unassigned — Williams/Ross vs James/Evan 6-1)`);
      continue;
    }
    const homeIds = []; for (const nm of ln.home) homeIds.push(await resolve(mu.div, HOME, nm));
    const awayIds = []; for (const nm of ln.away) awayIds.push(await resolve(mu.div, AWAY, nm));
    const row = {
      matchup_id: mu.id, round_number: 1, line_number: n, line_type: ln.type,
      home_player1_id: homeIds[0] || null, home_player2_id: homeIds[1] || null,
      away_player1_id: awayIds[0] || null, away_player2_id: awayIds[1] || null,
      score: ln.score, winner: ln.winner, status: 'completed',
      reported_at: new Date().toISOString(), reported_by_name: REPORTER,
    };
    const wlabel = ln.winner === 'home' ? HOME : AWAY;
    console.log(`  L${n} ${ln.type}: OCC[${ln.home.filter(Boolean).join(' & ') || '—'}] vs ${AWAY}[${ln.away.filter(Boolean).join(' & ') || '(no names)'}]  ${ln.score} (${wlabel} won)`);
    if (!DRY) {
      const { error } = await admin.from('league_matchup_lines').insert(row);
      if (error) console.log(`    ERR insert: ${error.message}`);
    }
    n++;
  }
}

console.log('\nPlayers created:', created.length ? '\n  ' + created.join('\n  ') : '(none)');

if (!DRY) {
  console.log('\n=== Resulting matchup totals (trigger-computed) ===');
  for (const mu of MATCHUPS) {
    const { data: m } = await admin.from('league_team_matchups').select('home_lines_won, away_lines_won, winner, status').eq('id', mu.id).single();
    console.log(`  ${mu.div}: OCC ${m.home_lines_won} – ${m.away_lines_won} ${mu.away}   winner=${m.winner}  status=${m.status}`);
  }
}
console.log('\nDone.');

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const DRY = process.argv.includes('--dry');

const { data: league } = await admin.from('leagues').select('id').eq('slug', 'lamorinda-jtt-summer-2026').single();
const { data: divs } = await admin.from('league_divisions').select('id, short_code').eq('league_id', league.id);
const divId = s => divs.find(d => d.short_code === s).id;
const { data: clubs } = await admin.from('league_clubs').select('id, short_code').eq('league_id', league.id);
const clubId = s => clubs.find(c => c.short_code === s).id;

// Score stored HOME-AWAY (home value first). winner = 'home' | 'away'.
const MATCHUPS = [
  // ---- Tuesday July 7 ----
  { div: '10U', id: '2288fcec-9113-43fd-9993-8d78ef47c3ea', home: 'OCC', away: 'MDW', lines: [
    { type: 'singles', home: ['Bennett Stocker'], away: ['Owen King'],      score: '3-6', winner: 'away' }, // Owen King (MDW) def Bennett Stocker (OCC) 6-3
    { type: 'singles', home: ['Rory Frase'],      away: ['Fares Fakhouri'], score: '6-4', winner: 'home' }, // Rory Frase (OCC) def Fares Fakhouri (MDW) 6-4
  ]},
  { div: '12U', id: '36403111-a6c8-43cf-8c73-31b0a6933fc3', home: 'OCC', away: 'MDW', lines: [
    { type: 'singles', home: ['JJ McGinley'],      away: ['Jackson Click'], score: '3-6', winner: 'away' }, // Jackson Click (MDW) def JJ McGinley (OCC) 6-3
    { type: 'singles', home: ['Mayer Loscotoff'],  away: ['Jack Stock'],    score: '6-1', winner: 'home' }, // Mayer Loscotoff (OCC) def Jack Stock (MDW) 6-1
    { type: 'doubles', home: ['Blair Williams', 'Collins Kippels'], away: ['Rohin', 'James'], score: '6-4', winner: 'home' }, // Blair/Collins (OCC) def Rohin/James (MDW) 6-4
  ]},
  { div: '13O', id: '6bad9b88-3ba4-4b38-82b1-061ad93f9b19', home: 'OCC', away: 'MCC', lines: [
    { type: 'singles', home: ['Charlie McIlwain'], away: ['Aaron'], score: '0-6', winner: 'away' }, // Aaron (MCC) def Charlie McIlwain (OCC) 6-0
    { type: 'singles', home: ['Sloane Larsen'],    away: ['Chloe'], score: '5-7', winner: 'away' }, // Chloe (MCC) def Sloane Larsen (OCC) 7-5
    { type: 'doubles', home: ['Addi Posey', 'Vivienne Williams'], away: ['Alex', 'Hyland'],  score: '7-5', winner: 'home' }, // Addi Posey/Vivienne Williams (OCC) def Alex/Hyland (MCC) 7-5
    { type: 'doubles', home: ['Teddy Davies', 'Grace Kroger'],    away: ['Declan', 'Cooper'], score: '6-2', winner: 'home' }, // Teddy Davies/Grace Kroger (OCC) def Declan/Cooper (MCC) 6-2
  ]},
  // ---- Thursday July 9 (Open) ----
  { div: 'OPEN', id: '2c25b36e-2477-48c3-a462-6e35708478b1', home: 'OCC', away: 'MCC', lines: [
    { type: 'singles', home: ['Declan Tseng'], away: ['Lindsay'],  score: '6-1, 6-2', winner: 'home' }, // Declan Tseng (OCC) def Lindsay (MCC) 6-1, 6-2
    { type: 'singles', home: ['Addi Posey'],   away: ['Addison'],  score: '3-6, 1-6', winner: 'away' }, // Addison (MCC) def Addi Posey (OCC) 6-3, 6-1
    { type: 'doubles', home: ['Sloane Larsen', 'Audrey Tseng'], away: ['Kayaan', 'Alex'],  score: '6-3, 6-1', winner: 'home' }, // Sloane Larsen/Audrey Tseng (OCC) def Kayaan/Alex (MCC) 6-3, 6-1
    { type: 'doubles', home: ['Will Mrachek', 'Teddy Mrachek'], away: ['Declan', 'Andrew'], score: '2-6, 6-3, (7-5)', winner: 'home' }, // Will/Teddy Mrachek (OCC) def Declan/Andrew (MCC) 2-6, 6-3 (7-5 3rd-set breaker, ran out of time)
  ]},
];

const norm = s => s.trim().toLowerCase();
async function rosterMap(divShort, clubShort) {
  const { data } = await admin.from('league_team_rosters').select('id, player_name, ladder_position')
    .eq('division_id', divId(divShort)).eq('club_id', clubId(clubShort));
  return { rows: data || [], byName: new Map((data || []).map(r => [norm(r.player_name), r])) };
}
const created = [];
async function resolve(divShort, clubShort, name) {
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

for (const mu of MATCHUPS) {
  console.log(`\n=== ${mu.div}  (HOME ${mu.home} / AWAY ${mu.away}) ===`);
  if (!DRY) await admin.from('league_matchup_lines').delete().eq('matchup_id', mu.id);
  let n = 1;
  for (const ln of mu.lines) {
    const homeIds = []; for (const nm of ln.home) homeIds.push(await resolve(mu.div, mu.home, nm));
    const awayIds = []; for (const nm of ln.away) awayIds.push(await resolve(mu.div, mu.away, nm));
    const row = {
      matchup_id: mu.id, round_number: 1, line_number: n, line_type: ln.type,
      home_player1_id: homeIds[0] || null, home_player2_id: homeIds[1] || null,
      away_player1_id: awayIds[0] || null, away_player2_id: awayIds[1] || null,
      score: ln.score, winner: ln.winner, status: 'completed', reported_by_name: 'Director entry',
    };
    const wlabel = ln.winner === 'home' ? mu.home : mu.away;
    console.log(`  L${n} ${ln.type}: ${mu.home}[${ln.home.join(' & ')}] vs ${mu.away}[${ln.away.join(' & ')}]  ${ln.score} (${wlabel} won)`);
    if (!DRY) {
      const { error } = await admin.from('league_matchup_lines').insert(row);
      if (error) console.log(`    ERR insert: ${error.message}`);
    }
    n++;
  }
}

console.log('\nPlayers created:', created.length ? '\n  ' + created.join('\n  ') : '(none — all already on rosters)');

if (!DRY) {
  console.log('\n=== Resulting matchup totals (trigger-computed) ===');
  for (const mu of MATCHUPS) {
    const { data: m } = await admin.from('league_team_matchups').select('home_lines_won, away_lines_won, winner, status').eq('id', mu.id).single();
    console.log(`  ${mu.div}: ${mu.away} ${m.away_lines_won} – ${m.home_lines_won} ${mu.home}   winner=${m.winner}  status=${m.status}`);
  }
}
console.log('\nDone.');

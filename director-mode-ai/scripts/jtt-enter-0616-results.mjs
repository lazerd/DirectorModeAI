import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const DRY = process.argv.includes('--dry');

const { data: league } = await admin.from('leagues').select('id').eq('slug', 'lamorinda-jtt-summer-2026').single();
const { data: clubs } = await admin.from('league_clubs').select('id, short_code').eq('league_id', league.id);
const clubId = s => clubs.find(c => c.short_code === s).id;
const { data: divs } = await admin.from('league_divisions').select('id, short_code').eq('league_id', league.id);
const divId = s => divs.find(d => d.short_code === s).id;

// Today's three SH @ MCC matchups (HOME=MCC, AWAY=SH). Score stored HOME-AWAY.
const MATCHUPS = {
  '10U': { id: '6ceba181-5df6-4ea3-91a7-ec8cfe377de1', lines: [
    { type: 'singles', home: ['Niam Kadakia'],   away: ['Jacob Chiu'],  score: '1-8', winner: 'away' }, // Jacob def Niam 8-1
    { type: 'singles', home: ['Calvin Karlberg'], away: ['Nathan Yang'], score: '2-8', winner: 'away' }, // Nathan def Calvin 8-2
  ]},
  '12U': { id: '3c916759-876d-4a63-b365-9a7e34305717', lines: [
    { type: 'singles', home: ['Hyland Caulfield'], away: ['Jacob Chiu'],   score: '6-1', winner: 'home' }, // Hyland def Jacob 6-1
    { type: 'singles', home: ['Owen Jacobowitz'],   away: ['Cameron Park'], score: '8-1', winner: 'home' }, // Owen def Cameron 8-1
    { type: 'singles', home: ['Isabella'],          away: ['Griffin White'],score: '5-6', winner: 'away' }, // Griffin def Isabella 6-5
    { type: 'doubles', home: ['Crew Kirk', 'Harper Brush'], away: ['Lana Morgan', 'Scarlett Harmssen'], score: '3-8', winner: 'away' }, // Lana&Scarlett def Crew&Harper 8-3
  ]},
  '13O': { id: 'a1912deb-e9cc-440b-adf2-b20d7c2216e9', lines: [
    { type: 'singles', home: ['Chloe Sabo-Nichols'], away: ['Ben Hawley'],     score: '8-2', winner: 'home' }, // Chloe def Ben H 8-2
    { type: 'singles', home: ['Kayaan Shinde'],       away: ['Benjamin Wolff'], score: '8-3', winner: 'home' }, // Kayaan def Ben W 8-3
    { type: 'singles', home: ['Josh Haugh'],          away: ['Reed Lusch'],     score: '7-9', winner: 'away' }, // Reed def Josh 9-7
    { type: 'doubles', home: ['Jagger Chagan', 'Brooke McGuire'], away: ['Everett Johnson', 'Maggie Harmasen'], score: '8-3', winner: 'home' }, // Jagger/Brooke def Everett&Maggie 8-3
    { type: 'doubles', home: ['Carter Grenlee', 'Declan Gonzales'], away: ['Vedica', 'Josie Disston'],          score: '6-4', winner: 'home' }, // Carter&Declan def Vedica&Josie 6-4
  ]},
};
// which club is home/away per matchup today
const HOME = 'MCC', AWAY = 'SH';

const norm = s => s.trim().toLowerCase();

// roster cache + find-or-create
async function rosterMap(divShort, clubShort) {
  const { data } = await admin.from('league_team_rosters').select('id, player_name, ladder_position')
    .eq('division_id', divId(divShort)).eq('club_id', clubId(clubShort));
  return { rows: data, byName: new Map(data.map(r => [norm(r.player_name), r])) };
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

for (const [divShort, mu] of Object.entries(MATCHUPS)) {
  console.log(`\n=== ${divShort}  (HOME ${HOME} / AWAY ${AWAY}) ===`);
  // delete existing (placeholder) lines for a clean slate
  if (!DRY) await admin.from('league_matchup_lines').delete().eq('matchup_id', mu.id);
  let n = 1;
  for (const ln of mu.lines) {
    const homeIds = []; for (const nm of ln.home) homeIds.push(await resolve(divShort, HOME, nm));
    const awayIds = []; for (const nm of ln.away) awayIds.push(await resolve(divShort, AWAY, nm));
    const row = {
      matchup_id: mu.id, round_number: 1, line_number: n, line_type: ln.type,
      home_player1_id: homeIds[0] || null, home_player2_id: homeIds[1] || null,
      away_player1_id: awayIds[0] || null, away_player2_id: awayIds[1] || null,
      score: ln.score, winner: ln.winner, status: 'completed', reported_by_name: 'Director entry',
    };
    const wlabel = ln.winner === 'home' ? HOME : AWAY;
    console.log(`  L${n} ${ln.type}: ${HOME}[${ln.home.join(' & ')}] vs ${AWAY}[${ln.away.join(' & ')}]  ${ln.score} (${wlabel} won)`);
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
  for (const [divShort, mu] of Object.entries(MATCHUPS)) {
    const { data: m } = await admin.from('league_team_matchups').select('home_lines_won, away_lines_won, winner, status').eq('id', mu.id).single();
    console.log(`  ${divShort}: ${AWAY} ${m.away_lines_won} – ${m.home_lines_won} ${HOME}   winner=${m.winner}  status=${m.status}`);
  }
}
console.log('\nDone.');

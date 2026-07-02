// One-off: enter the 2026-06-09 MCC (home) vs OCC (away) results for all three
// Tuesday divisions (10U / 12U / 13O). Deletes the empty stub lines on each
// matchup and inserts the exact lines played, fully assigned, scored, and
// marked completed. The recompute_matchup_from_lines trigger then sets each
// matchup's aggregate score + winner, which feeds division standings.
//
// Scores stored HOME-AWAY (MCC games first), matching the scorecard layout.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const DRY = process.argv.includes('--dry');

const SLUG = 'lamorinda-jtt-summer-2026';
const DATE = '2026-06-09';
const REPORTER = 'Darrin (manual entry)';

// Spelling/nickname aliases: result first-name -> roster first-name
const ALIAS = { aiden: 'aidan', chacha: 'charley' };

const { data: league } = await admin.from('leagues').select('id').eq('slug', SLUG).single();
const { data: divisions } = await admin.from('league_divisions').select('id, short_code').eq('league_id', league.id);
const { data: clubs } = await admin.from('league_clubs').select('id, short_code').eq('league_id', league.id);
const divByCode = Object.fromEntries(divisions.map(d => [d.short_code, d.id]));
const MCC = clubs.find(c => c.short_code === 'MCC').id;
const OCC = clubs.find(c => c.short_code === 'OCC').id;

const { data: rosters } = await admin
  .from('league_team_rosters')
  .select('id, player_name, division_id, club_id');

// (division_id|club_id|firstname-lowercased) -> roster id
const rosterByFirst = new Map();
for (const r of rosters) {
  const first = r.player_name.trim().split(/\s+/)[0].toLowerCase();
  rosterByFirst.set(`${r.division_id}|${r.club_id}|${first}`, r.id);
}
const unresolved = [];
function rid(divCode, clubId, firstName) {
  const key = (n) => `${divByCode[divCode]}|${clubId}|${n.toLowerCase()}`;
  let id = rosterByFirst.get(key(firstName));
  if (!id && ALIAS[firstName.toLowerCase()]) id = rosterByFirst.get(key(ALIAS[firstName.toLowerCase()]));
  if (!id) unresolved.push(`${divCode} ${clubId === MCC ? 'MCC' : 'OCC'} "${firstName}"`);
  return id || null;
}

// Results. home = MCC, away = OCC. score is HOME-AWAY (MCC games first).
const RESULTS = {
  '10U': [
    { line_type: 'singles', home: ['Emmett'], away: ['Will'],          score: '8-2', winner: 'home' },
    { line_type: 'singles', home: ['Anand'],  away: ['Luke'],          score: '4-8', winner: 'away' },
    { line_type: 'singles', home: ['Niam'],   away: ['Ryan'],          score: '3-8', winner: 'away' },
    { line_type: 'doubles', home: ['Dean', 'Lucas'], away: ['Bennett', 'Van'], score: '6-7', winner: 'away' },
  ],
  '12U': [
    { line_type: 'singles', home: ['Andrew'],    away: ['JJ'],              score: '5-7', winner: 'away' },
    { line_type: 'singles', home: ['Christian'], away: ['Aiden'],           score: '6-8', winner: 'away' },
    { line_type: 'doubles', home: ['Owen', 'Jack'],   away: ['Alex', 'Charlie'], score: '4-8', winner: 'away' },
    { line_type: 'doubles', home: ['Emmett', 'Crew'], away: ['Cora', 'Tilly'],   score: '7-6', winner: 'home' },
  ],
  '13O': [
    { line_type: 'singles', home: ['Chloe'],  away: ['Mina'],            score: '2-7', winner: 'away' },
    { line_type: 'singles', home: ['Cooper'], away: ['Declan'],          score: '0-8', winner: 'away' },
    { line_type: 'doubles', home: ['Jagger', 'Brooke'], away: ['Owen', 'Vivienne'], score: '5-6', winner: 'away' },
    { line_type: 'doubles', home: ['Siena', 'Carter'],  away: ['Paige', 'Chacha'],  score: '5-7', winner: 'away' },
  ],
};

for (const [divCode, lines] of Object.entries(RESULTS)) {
  const divId = divByCode[divCode];
  const { data: matchups } = await admin
    .from('league_team_matchups')
    .select('id, home_club_id, away_club_id')
    .eq('division_id', divId).eq('match_date', DATE);
  const m = matchups.find(x => x.home_club_id === MCC && x.away_club_id === OCC);
  if (!m) { console.log(`!! ${divCode}: no MCC-vs-OCC matchup on ${DATE}`); continue; }

  const rows = lines.map((l, i) => ({
    matchup_id: m.id,
    line_type: l.line_type,
    line_number: i + 1,
    home_player1_id: rid(divCode, MCC, l.home[0]),
    home_player2_id: l.home[1] ? rid(divCode, MCC, l.home[1]) : null,
    away_player1_id: rid(divCode, OCC, l.away[0]),
    away_player2_id: l.away[1] ? rid(divCode, OCC, l.away[1]) : null,
    score: l.score,
    winner: l.winner,
    status: 'completed',
    reported_at: new Date().toISOString(),
    reported_by_name: REPORTER,
  }));

  const homeWon = lines.filter(l => l.winner === 'home').length;
  const awayWon = lines.length - homeWon;
  console.log(`\n${divCode}: ${lines.length} lines  MCC ${homeWon}-${awayWon} OCC  -> ${homeWon > awayWon ? 'MCC' : awayWon > homeWon ? 'OCC' : 'TIE'} wins`);
  rows.forEach(r => console.log(`  L${r.line_number} ${r.line_type} ${r.score} ${r.winner}  H[${r.home_player1_id ? 'ok' : 'NULL'}${r.home_player2_id !== null || r.line_type==='singles' ? '' : ''}${r.home_player2_id===null && r.line_type==='doubles' ? ',NULL' : r.home_player2_id ? ',ok' : ''}] A[${r.away_player1_id ? 'ok' : 'NULL'}${r.away_player2_id===null && r.line_type==='doubles' ? ',NULL' : r.away_player2_id ? ',ok' : ''}]`));

  if (!DRY) {
    await admin.from('league_matchup_lines').delete().eq('matchup_id', m.id);
    const { error } = await admin.from('league_matchup_lines').insert(rows);
    if (error) console.log(`  ERROR inserting ${divCode}:`, error.message);
  }
}

if (unresolved.length) console.log('\nUNRESOLVED players (left unassigned):', unresolved.join('; '));
console.log(DRY ? '\n[DRY RUN — nothing written]' : '\nDone.');

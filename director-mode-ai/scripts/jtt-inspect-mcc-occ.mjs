// Inspect the MCC vs OCC matchups on 2026-06-09 (all divisions): matchups,
// their lines (with player assignments), and the MCC/OCC rosters per division.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const SLUG = 'lamorinda-jtt-summer-2026';
const DATE = '2026-06-09';

const { data: league } = await admin.from('leagues').select('id, name, status').eq('slug', SLUG).single();
console.log('League:', league);

const { data: divisions } = await admin.from('league_divisions').select('id, short_code, name').eq('league_id', league.id);
const { data: clubs } = await admin.from('league_clubs').select('id, short_code, name').eq('league_id', league.id);
const divName = Object.fromEntries(divisions.map(d => [d.id, d.short_code]));
const clubName = Object.fromEntries(clubs.map(c => [c.id, c.short_code]));
const MCC = clubs.find(c => c.short_code === 'MCC');
const OCC = clubs.find(c => c.short_code === 'OCC');
console.log('MCC id:', MCC?.id, 'OCC id:', OCC?.id);

// All rosters for MCC + OCC keyed by division
const { data: rosters } = await admin
  .from('league_team_rosters')
  .select('id, player_name, division_id, club_id, ladder_position, status')
  .in('club_id', [MCC.id, OCC.id]);

// The matchups on this date involving MCC and OCC
const { data: matchups } = await admin
  .from('league_team_matchups')
  .select('id, match_date, division_id, home_club_id, away_club_id, status, home_lines_won, away_lines_won, winner')
  .eq('match_date', DATE);

for (const m of matchups.filter(m => [m.home_club_id, m.away_club_id].includes(MCC.id) && [m.home_club_id, m.away_club_id].includes(OCC.id))) {
  console.log(`\n=== ${divName[m.division_id]}  ${clubName[m.away_club_id]} @ ${clubName[m.home_club_id]}  [${m.status}] lines ${m.home_lines_won}-${m.away_lines_won} winner=${m.winner}`);
  console.log('matchup_id:', m.id);

  const divRosters = rosters.filter(r => r.division_id === m.division_id);
  const rName = Object.fromEntries(divRosters.map(r => [r.id, `${r.player_name}(${clubName[r.club_id]})`]));
  console.log('  HOME', clubName[m.home_club_id], 'roster:', divRosters.filter(r => r.club_id === m.home_club_id).sort((a,b)=>(a.ladder_position??99)-(b.ladder_position??99)).map(r => `${r.player_name}#${r.ladder_position}`).join(', ') || '(none)');
  console.log('  AWAY', clubName[m.away_club_id], 'roster:', divRosters.filter(r => r.club_id === m.away_club_id).sort((a,b)=>(a.ladder_position??99)-(b.ladder_position??99)).map(r => `${r.player_name}#${r.ladder_position}`).join(', ') || '(none)');

  const { data: lines } = await admin
    .from('league_matchup_lines')
    .select('id, line_type, line_number, home_player1_id, home_player2_id, away_player1_id, away_player2_id, score, winner, status, score_token')
    .eq('matchup_id', m.id)
    .order('line_number');
  for (const l of lines) {
    const home = [l.home_player1_id, l.home_player2_id].filter(Boolean).map(id => rName[id] || id).join(' / ') || '—';
    const away = [l.away_player1_id, l.away_player2_id].filter(Boolean).map(id => rName[id] || id).join(' / ') || '—';
    console.log(`    L${l.line_number} ${l.line_type}: HOME[${home}] vs AWAY[${away}]  score=${l.score ?? ''} winner=${l.winner ?? ''} [${l.status}] token=${l.score_token}`);
  }
}

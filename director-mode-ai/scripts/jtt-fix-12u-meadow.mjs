import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

// Target 12U schedule — mirrors LAMORINDA_2026.matchups (12U) in src/lib/jtt.ts.
// 5-club round-robin, "away @ home", one bye per week.
const TARGET_12U = [
  { match_date: '2026-06-09', away_short: 'OCC', home_short: 'MCC' }, // MDW bye
  { match_date: '2026-06-09', away_short: 'RAN', home_short: 'SH' },
  { match_date: '2026-06-16', away_short: 'SH', home_short: 'MCC' },  // RAN bye
  { match_date: '2026-06-16', away_short: 'MDW', home_short: 'OCC' },
  { match_date: '2026-06-23', away_short: 'MDW', home_short: 'SH' },  // OCC bye
  { match_date: '2026-06-23', away_short: 'MCC', home_short: 'RAN' },
  { match_date: '2026-07-07', away_short: 'SH', home_short: 'RAN' },  // MCC bye
  { match_date: '2026-07-07', away_short: 'MDW', home_short: 'OCC' },
  { match_date: '2026-07-14', away_short: 'OCC', home_short: 'RAN' }, // SH bye
  { match_date: '2026-07-14', away_short: 'MDW', home_short: 'MCC' },
];

// linesForFormat('singles_and_doubles')
const LINES_SINGLES_AND_DOUBLES = [
  { line_type: 'singles', line_number: 1 },
  { line_type: 'doubles', line_number: 2 },
];
function linesForFormat(format) {
  if (format === 'singles_only') return [{ line_type: 'singles', line_number: 1 }];
  if (format === 'doubles_only') return [{ line_type: 'doubles', line_number: 1 }];
  if (format === 'custom') return [];
  return LINES_SINGLES_AND_DOUBLES;
}

const env = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const SLUG = 'lamorinda-jtt-summer-2026';
const APPLY = process.argv.includes('--apply');

const { data: league } = await admin.from('leagues').select('id').eq('slug', SLUG).single();
const { data: clubs } = await admin.from('league_clubs').select('id, short_code').eq('league_id', league.id);
const clubIdByShort = new Map(clubs.map(c => [c.short_code, c.id]));
const clubShortById = new Map(clubs.map(c => [c.id, c.short_code]));

const { data: div } = await admin
  .from('league_divisions')
  .select('id, short_code, line_format')
  .eq('league_id', league.id)
  .eq('short_code', '12U')
  .single();

const mdwId = clubIdByShort.get('MDW');

// 1. Guard: is Meadow already linked to 12U?
const { data: existingDc } = await admin
  .from('league_division_clubs')
  .select('club_id')
  .eq('division_id', div.id)
  .eq('club_id', mdwId);
const meadowAlreadyLinked = (existingDc || []).length > 0;

// 2. Guard: abort if any existing 12U line has been scored
const { data: existingMatchups } = await admin
  .from('league_team_matchups')
  .select('id')
  .eq('division_id', div.id);
const existingMatchupIds = (existingMatchups || []).map(m => m.id);

let scoredLines = [];
if (existingMatchupIds.length) {
  const { data: lines } = await admin
    .from('league_matchup_lines')
    .select('id, score, winner, status, matchup_id')
    .in('matchup_id', existingMatchupIds);
  scoredLines = (lines || []).filter(l => l.score || l.winner || l.status === 'completed');
}

console.log(`12U division: ${div.id}`);
console.log(`Meadow already in 12U division_clubs: ${meadowAlreadyLinked}`);
console.log(`Existing 12U matchups: ${existingMatchupIds.length}`);
console.log(`Scored 12U lines (must be 0 to proceed): ${scoredLines.length}`);

if (scoredLines.length > 0) {
  console.log('\n*** ABORT: 12U already has scored lines. Not touching it. ***');
  console.log(JSON.stringify(scoredLines, null, 2));
  process.exit(1);
}

// Target 12U matchups (source of truth, mirrors src/lib/jtt.ts)
const target12u = TARGET_12U;
console.log(`\nTarget 12U matchups: ${target12u.length}`);
for (const m of target12u) {
  console.log(`  ${m.match_date}  ${m.away_short} @ ${m.home_short}`);
}

if (!APPLY) {
  console.log('\n(dry run — pass --apply to execute)');
  process.exit(0);
}

// === APPLY ===
// a. Link Meadow to 12U division
if (!meadowAlreadyLinked) {
  const { error } = await admin
    .from('league_division_clubs')
    .insert({ division_id: div.id, club_id: mdwId });
  if (error) throw new Error('link Meadow: ' + error.message);
  console.log('\n[ok] Linked Meadow to 12U division');
}

// b. Delete old 12U matchups (cascades to lines)
if (existingMatchupIds.length) {
  const { error } = await admin
    .from('league_team_matchups')
    .delete()
    .in('id', existingMatchupIds);
  if (error) throw new Error('delete old matchups: ' + error.message);
  console.log(`[ok] Deleted ${existingMatchupIds.length} old 12U matchups`);
}

// c. Insert new 12U matchups
const rows = target12u.map(m => ({
  division_id: div.id,
  match_date: m.match_date,
  home_club_id: clubIdByShort.get(m.home_short),
  away_club_id: clubIdByShort.get(m.away_short),
  status: 'scheduled',
}));
const { data: inserted, error: insErr } = await admin
  .from('league_team_matchups')
  .insert(rows)
  .select('id');
if (insErr) throw new Error('insert matchups: ' + insErr.message);
console.log(`[ok] Inserted ${inserted.length} new 12U matchups`);

// d. Insert empty lines per matchup based on division line_format
const skel = linesForFormat(div.line_format);
const lineRows = [];
for (const m of inserted) {
  for (const line of skel) {
    lineRows.push({ matchup_id: m.id, line_type: line.line_type, line_number: line.line_number });
  }
}
if (lineRows.length) {
  const { error: lErr } = await admin.from('league_matchup_lines').insert(lineRows);
  if (lErr) throw new Error('insert lines: ' + lErr.message);
  console.log(`[ok] Inserted ${lineRows.length} empty lines (${skel.length}/matchup)`);
}

console.log('\nDONE.');

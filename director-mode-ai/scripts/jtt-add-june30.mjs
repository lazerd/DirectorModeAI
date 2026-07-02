import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const SLUG = 'lamorinda-jtt-summer-2026';
const DATE = '2026-06-30';
const APPLY = process.argv.includes('--apply');

// host (home) vs each visitor (away). One mashup gathering per division at the host site.
const PLAN = [
  { div: '10U', host: 'MCC', visitors: ['SH', 'MDW'] },
  { div: '12U', host: 'SH', visitors: ['MCC', 'MDW'] },
  { div: '13O', host: 'MCC', visitors: ['SH'] }, // 13+ : only MCC & SH; host unspecified -> MCC
];

const { data: league } = await admin.from('leagues').select('id').eq('slug', SLUG).single();
const { data: clubs } = await admin.from('league_clubs').select('id, short_code').eq('league_id', league.id);
const clubId = new Map(clubs.map(c => [c.short_code, c.id]));
const { data: divisions } = await admin
  .from('league_divisions')
  .select('id, short_code, line_format')
  .eq('league_id', league.id);
const divBy = new Map(divisions.map(d => [d.short_code, d]));

function linesForFormat(format) {
  if (format === 'singles_only') return [{ line_type: 'singles', line_number: 1 }];
  if (format === 'doubles_only') return [{ line_type: 'doubles', line_number: 1 }];
  if (format === 'custom') return [];
  return [
    { line_type: 'singles', line_number: 1 },
    { line_type: 'doubles', line_number: 2 },
  ];
}

// Guard: any existing matchups already on this date?
const divIds = PLAN.map(p => divBy.get(p.div).id);
const { data: existing } = await admin
  .from('league_team_matchups')
  .select('id, division_id')
  .eq('match_date', DATE)
  .in('division_id', divIds);

console.log(`Existing matchups on ${DATE} in target divisions: ${(existing || []).length}`);
if ((existing || []).length > 0 && !process.argv.includes('--force')) {
  console.log('*** ABORT: matchups already exist on this date. Re-run with --force to add anyway. ***');
  process.exit(1);
}

// Build matchup rows
const rows = [];
for (const p of PLAN) {
  const d = divBy.get(p.div);
  for (const v of p.visitors) {
    rows.push({
      division_id: d.id,
      match_date: DATE,
      home_club_id: clubId.get(p.host),
      away_club_id: clubId.get(v),
      status: 'scheduled',
      notes: '3-team mashup date (host = ' + p.host + ')',
    });
  }
}

console.log(`\nPlanned matchups for ${DATE}:`);
for (const p of PLAN) {
  for (const v of p.visitors) console.log(`  ${p.div}: ${v} @ ${p.host}`);
}
console.log(`Total: ${rows.length} matchups`);

if (!APPLY) {
  console.log('\n(dry run — pass --apply to execute)');
  process.exit(0);
}

const { data: inserted, error: insErr } = await admin
  .from('league_team_matchups')
  .insert(rows)
  .select('id, division_id');
if (insErr) throw new Error('insert matchups: ' + insErr.message);
console.log(`\n[ok] Inserted ${inserted.length} matchups`);

// Empty lines per matchup
const fmtByDivId = new Map(divisions.map(d => [d.id, d.line_format]));
const lineRows = [];
for (const m of inserted) {
  for (const line of linesForFormat(fmtByDivId.get(m.division_id))) {
    lineRows.push({ matchup_id: m.id, line_type: line.line_type, line_number: line.line_number });
  }
}
if (lineRows.length) {
  const { error: lErr } = await admin.from('league_matchup_lines').insert(lineRows);
  if (lErr) throw new Error('insert lines: ' + lErr.message);
  console.log(`[ok] Inserted ${lineRows.length} empty lines`);
}
console.log('\nDONE.');

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
const { data: clubs } = await admin.from('league_clubs').select('id, short_code').eq('league_id', league.id);
const divId = s => divs.find(d => d.short_code === s).id;
const clubId = s => clubs.find(c => c.short_code === s).id;

async function findRow(div, club, name) {
  const { data } = await admin.from('league_team_rosters').select('id, player_name')
    .eq('division_id', divId(div)).eq('club_id', clubId(club)).eq('player_name', name);
  return data;
}

// MERGE: delete the first-name-only row, repoint its lines to the existing full-name row (same div+club).
const MERGES = [
  ['13O','MCC','Chloe',  'Chloe Sabo-Nichols'],
  ['13O','MCC','Cooper', 'Cooper Watkins'],
  ['13O','MCC','Declan', 'Declan Gonzales'],
  ['12U','MDW','Rohin',  'Rohin Behzadi'],
  ['OPEN','MCC','Lindsay','Lindsay Foster'],
  ['OPEN','MCC','Alex',  'Alex Martinez'],
  ['OPEN','MCC','Declan', 'Declan Gonzalez'],
];
// RENAME: add a surname in place, sourced from the same club in an adjacent division.
const RENAMES = [
  ['13O','MCC','Hyland', 'Hyland Caulfield'],   // from 12U MCC
  ['13O','MCC','Alex',   'Alex Martinez'],      // from OPEN MCC
  ['OPEN','MCC','Kayaan','Kayaan Shinde'],      // from 13O MCC
  ['OPEN','MCC','Andrew','Andrew Grayson'],     // from 12U MCC
];

console.log('=== MERGES (dedupe into existing full-name roster row) ===');
for (const [div, club, single, full] of MERGES) {
  const srcs = await findRow(div, club, single);
  const dsts = await findRow(div, club, full);
  if (srcs.length !== 1 || dsts.length !== 1) {
    console.log(`  SKIP ${div} ${club} "${single}"→"${full}"  (src=${srcs.length} dst=${dsts.length})`);
    continue;
  }
  const srcId = srcs[0].id, dstId = dsts[0].id;
  const { data: lines } = await admin.from('league_matchup_lines')
    .select('id, home_player1_id, home_player2_id, away_player1_id, away_player2_id')
    .or(`home_player1_id.eq.${srcId},home_player2_id.eq.${srcId},away_player1_id.eq.${srcId},away_player2_id.eq.${srcId}`);
  console.log(`  ${div} ${club} "${single}" → "${full}"  (repoint ${lines.length} line-slot(s), then delete dup)`);
  if (!DRY) {
    for (const ln of lines) {
      const patch = {};
      for (const col of ['home_player1_id','home_player2_id','away_player1_id','away_player2_id'])
        if (ln[col] === srcId) patch[col] = dstId;
      if (Object.keys(patch).length) await admin.from('league_matchup_lines').update(patch).eq('id', ln.id);
    }
    const { error } = await admin.from('league_team_rosters').delete().eq('id', srcId);
    if (error) console.log(`    ERR delete: ${error.message}`);
  }
}

console.log('\n=== RENAMES (add surname in place) ===');
for (const [div, club, single, full] of RENAMES) {
  const srcs = await findRow(div, club, single);
  if (srcs.length !== 1) { console.log(`  SKIP ${div} ${club} "${single}" (found ${srcs.length})`); continue; }
  console.log(`  ${div} ${club} "${single}" → "${full}"`);
  if (!DRY) {
    const { error } = await admin.from('league_team_rosters').update({ player_name: full }).eq('id', srcs[0].id);
    if (error) console.log(`    ERR update: ${error.message}`);
  }
}

console.log('\n=== LEFT AS FIRST-NAME-ONLY (no same-club evidence) ===');
console.log('  13O MCC "Aaron", OPEN MCC "Addison", 12U MDW "James"');
console.log(DRY ? '\n(dry run — pass --apply... actually run without --dry to execute)' : '\nDone.');

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
const MCC = clubs.find(c => c.short_code === 'MCC').id;
const { data: divs } = await admin.from('league_divisions').select('id, short_code').eq('league_id', league.id);
const divId = short => divs.find(d => d.short_code === short).id;

// Desired final ladder order per division (existing players + new inserts).
const PLAN = {
  '10U': ['Emmett Leong', 'Anand Jain', 'Niam Kadakia', 'Calvin Karlberg', 'Dean Jacobowitz', 'Liam Troch', 'Lucas Hagopian'],
  '12U': ['Andrew Grayson', 'Owen Jacobowitz', 'Christian Leong', 'Hyland Caulfield', 'Emmett Leong', 'Crew Kirk', 'Gwyneth Hanahan', 'Harper Brush', 'Jack Diessner'],
  '13O': ['Chloe Sabo-Nichols', 'Kayaan Shinde', 'Josh Haugh', 'Jagger Chagan', 'Cooper Watkins', 'Siena Kurtzman', 'Declan Gonzales', 'Brooke McGuire', 'Christian Leong', 'Carter Grenlee'],
};

const norm = s => s.trim().toLowerCase();

for (const short of Object.keys(PLAN)) {
  const dId = divId(short);
  const { data: rows } = await admin
    .from('league_team_rosters')
    .select('id, player_name, ladder_position')
    .eq('division_id', dId).eq('club_id', MCC);
  const byName = new Map(rows.map(r => [norm(r.player_name), r]));
  const finalOrder = PLAN[short];

  // Sanity: every existing player must appear in the plan (so nobody is dropped).
  const planned = new Set(finalOrder.map(norm));
  const orphaned = rows.filter(r => !planned.has(norm(r.player_name)));
  if (orphaned.length) {
    console.log(`!! ${short}: existing players missing from plan — ABORTING:`, orphaned.map(r => r.player_name));
    continue;
  }
  const newNames = finalOrder.filter(n => !byName.has(norm(n)));

  console.log(`\n=== MCC ${short} === (${rows.length} existing, adding ${newNames.length}: ${newNames.join(', ')})`);
  if (DRY) {
    finalOrder.forEach((n, i) => console.log(`  #${i + 1}  ${n}${byName.has(norm(n)) ? '' : '   <-- NEW'}`));
    continue;
  }

  // Phase 1: vacate positive positions to avoid any unique(div,club,position) clash.
  for (const r of rows) {
    await admin.from('league_team_rosters').update({ ladder_position: -(rows.indexOf(r) + 1) }).eq('id', r.id);
  }
  // Phase 2: write final positions (update existing, insert new).
  for (let i = 0; i < finalOrder.length; i++) {
    const name = finalOrder[i];
    const pos = i + 1;
    const existing = byName.get(norm(name));
    if (existing) {
      await admin.from('league_team_rosters').update({ ladder_position: pos }).eq('id', existing.id);
    } else {
      const { error } = await admin.from('league_team_rosters').insert({
        division_id: dId, club_id: MCC, player_name: name, ladder_position: pos, status: 'active',
      });
      if (error) { console.log(`  ERR insert ${name}:`, error.message); }
    }
  }

  // Verify
  const { data: after } = await admin.from('league_team_rosters')
    .select('player_name, ladder_position').eq('division_id', dId).eq('club_id', MCC)
    .order('ladder_position', { nullsFirst: false });
  after.forEach(r => console.log(`  #${r.ladder_position}  ${r.player_name}${newNames.map(norm).includes(norm(r.player_name)) ? '   <-- NEW' : ''}`));
}
console.log('\nDone.');

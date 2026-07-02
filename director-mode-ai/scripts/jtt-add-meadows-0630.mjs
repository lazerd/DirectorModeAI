// Adds Meadow (MDW) attendance to the 2026-06-30 JTT mashup matchups:
//   1. Upserts each MDW player into league_team_rosters (dedupe by division+name)
//   2. Checks them into that division's 06-30 mashup matchup (league_matchup_checkins)
//   3. Ensures the 13O mashup notes include MDW so its pool loads Meadow rosters
// Idempotent. Run with --dry to preview.
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

const ROSTER = {
  '10U': ['Odin Slikker', 'Lucy Allen', 'Ryan Au'],
  '12U': ['Gavin Allen', 'William Runft', 'Alek Sage', 'Whitaker Steinert', 'Jack Stock', 'Alex Dun', 'Rohin Behzadi'],
  '13O': ['Jackson Click'],
};
const MATCHUP_ID = {
  '10U': '47d5ad69-e5e7-4f2b-bc55-67d0e66f284f',
  '12U': 'a6ee6acd-e4f3-448d-a211-f1c0424fa903',
  '13O': '41ad60cd-4885-4273-8145-f4e06370a599',
};

const { data: league } = await admin.from('leagues').select('id').eq('slug', SLUG).single();
const { data: divisions } = await admin.from('league_divisions').select('id, short_code').eq('league_id', league.id);
const { data: clubs } = await admin.from('league_clubs').select('id, short_code').eq('league_id', league.id);
const divByCode = Object.fromEntries(divisions.map(d => [d.short_code, d.id]));
const MDW = clubs.find(c => c.short_code === 'MDW').id;

// Existing MDW rosters
const { data: existing } = await admin
  .from('league_team_rosters').select('id, player_name, division_id, ladder_position').eq('club_id', MDW);
const key = (divId, name) => `${divId}||${name.trim().toLowerCase()}`;
const rosterMap = new Map(existing.map(r => [key(r.division_id, r.player_name), r]));
const nextLadder = {};
for (const r of existing) nextLadder[r.division_id] = Math.max(nextLadder[r.division_id] ?? 0, r.ladder_position ?? 0);

const checkinRows = [];
let added = 0, present = 0;

for (const [code, names] of Object.entries(ROSTER)) {
  const divId = divByCode[code];
  for (const name of names) {
    let rosterId;
    const ex = rosterMap.get(key(divId, name));
    if (ex) {
      rosterId = ex.id; present++;
    } else if (DRY) {
      rosterId = `DRY-${code}-${name}`; added++;
    } else {
      const pos = (nextLadder[divId] = (nextLadder[divId] ?? 0) + 1);
      const { data: ins, error } = await admin.from('league_team_rosters')
        .insert({ division_id: divId, club_id: MDW, player_name: name, ladder_position: pos })
        .select('id').single();
      if (error) { console.log(`ERR insert ${name}:`, error.message); continue; }
      rosterId = ins.id; rosterMap.set(key(divId, name), { id: rosterId }); added++;
    }
    checkinRows.push({ matchup_id: MATCHUP_ID[code], roster_id: rosterId, code, name });
  }
}

// Ensure 13O mashup notes include MDW
const { data: m13 } = await admin.from('league_team_matchups').select('id, notes').eq('id', MATCHUP_ID['13O']).single();
let notesUpdate = null;
if (!/MASHUP\[[^\]]*MDW[^\]]*\]/.test(m13.notes || '')) {
  notesUpdate = (m13.notes || '').replace(/MASHUP\[([^\]]*)\]/, (_, inner) => `MASHUP[${inner}|MDW]`);
  console.log(`13O notes: ${JSON.stringify(m13.notes)} -> ${JSON.stringify(notesUpdate)}`);
  if (!DRY) await admin.from('league_team_matchups').update({ notes: notesUpdate }).eq('id', MATCHUP_ID['13O']);
} else {
  console.log('13O notes already include MDW.');
}

if (!DRY && checkinRows.length) {
  const { error } = await admin.from('league_matchup_checkins')
    .upsert(checkinRows.map(({ matchup_id, roster_id }) => ({ matchup_id, roster_id })),
      { onConflict: 'matchup_id,roster_id', ignoreDuplicates: true });
  if (error) console.log('ERR checkins:', error.message);
}

console.log(`\n${DRY ? '[DRY RUN] ' : ''}=== Meadow add to 06-30 ===`);
console.log(`Rosters: ${added} added, ${present} already present`);
for (const [code] of Object.entries(ROSTER)) {
  const list = checkinRows.filter(r => r.code === code).map(r => r.name);
  console.log(`  ${code}: ${list.length} checked in -> ${list.join(', ')}`);
}

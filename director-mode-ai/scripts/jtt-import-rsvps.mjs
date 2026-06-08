// Imports Sleepy Hollow JTT RSVPs into the live league:
//   1. Upserts SH players into league_team_rosters (dedupe by name+division)
//   2. Checks in each "Available" player to the SH matchup(s) on that date
//      (league_matchup_checkins = match-day attendance the lineup optimizer reads)
//
// Source JSON produced by court-booker/jtt-rsvp-export.js.
// Idempotent: safe to re-run after new sign-ups.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const SLUG = 'lamorinda-jtt-summer-2026';
const RSVP_PATH = 'C:/Users/darri/court-booker/jtt-rsvps.json';
const DRY = process.argv.includes('--dry');

const records = JSON.parse(readFileSync(RSVP_PATH, 'utf8'));

const { data: league } = await admin.from('leagues').select('id').eq('slug', SLUG).single();
const { data: divisions } = await admin.from('league_divisions').select('id, short_code').eq('league_id', league.id);
const { data: clubs } = await admin.from('league_clubs').select('id, short_code').eq('league_id', league.id);
const divByCode = Object.fromEntries(divisions.map(d => [d.short_code, d.id]));
const SH = clubs.find(c => c.short_code === 'SH').id;

// Existing SH roster rows, keyed by division_id + lowercased name
const { data: existingRosters } = await admin
  .from('league_team_rosters').select('id, player_name, division_id, parent_email').eq('club_id', SH);
const rosterKey = (divId, name) => `${divId}||${name.trim().toLowerCase()}`;
const rosterMap = new Map(existingRosters.map(r => [rosterKey(r.division_id, r.player_name), r]));

// SH matchups -> { division_id: { 'YYYY-MM-DD': [matchup_id,...] } }
const { data: matchups } = await admin
  .from('league_team_matchups')
  .select('id, match_date, division_id, home_club_id, away_club_id')
  .or(`home_club_id.eq.${SH},away_club_id.eq.${SH}`);
const matchupIndex = {};
for (const m of matchups) {
  // match_date may come back as full ISO timestamp; keep the date part
  const d = String(m.match_date).slice(0, 10);
  (matchupIndex[m.division_id] ??= {})[d] ??= [];
  matchupIndex[m.division_id][d].push(m.id);
}

let rostersAdded = 0, rostersExisting = 0, checkinsAdded = 0, checkinDateMisses = [];
const checkinRows = [];

for (const rec of records) {
  const divId = divByCode[rec.division];
  if (!divId) { console.log(`SKIP unknown division ${rec.division} for ${rec.player_name}`); continue; }

  // 1. roster upsert
  let rosterId;
  const existing = rosterMap.get(rosterKey(divId, rec.player_name));
  if (existing) {
    rosterId = existing.id;
    rostersExisting++;
    // backfill contact info if the form has it and the row doesn't
    if (!existing.parent_email && rec.parent_email && !DRY) {
      await admin.from('league_team_rosters').update({
        parent_name: rec.parent_name, parent_email: rec.parent_email, parent_phone: rec.parent_phone,
      }).eq('id', rosterId);
    }
  } else {
    if (DRY) {
      rosterId = `DRY-${rec.division}-${rec.player_name}`;
    } else {
      const { data: ins, error } = await admin.from('league_team_rosters').insert({
        division_id: divId, club_id: SH, player_name: rec.player_name,
        parent_name: rec.parent_name, parent_email: rec.parent_email, parent_phone: rec.parent_phone,
      }).select('id').single();
      if (error) { console.log(`ERR insert roster ${rec.player_name}:`, error.message); continue; }
      rosterId = ins.id;
    }
    rosterMap.set(rosterKey(divId, rec.player_name), { id: rosterId });
    rostersAdded++;
  }

  // 2. check-ins for each AVAILABLE date
  for (const date of rec.available) {
    const ids = matchupIndex[divId]?.[date];
    if (!ids || ids.length === 0) { checkinDateMisses.push(`${rec.division} ${rec.player_name} ${date}`); continue; }
    for (const matchupId of ids) checkinRows.push({ matchup_id: matchupId, roster_id: rosterId });
  }
}

if (!DRY && checkinRows.length) {
  // upsert with ignoreDuplicates so re-runs don't error on the (matchup_id, roster_id) PK
  const { error } = await admin.from('league_matchup_checkins')
    .upsert(checkinRows, { onConflict: 'matchup_id,roster_id', ignoreDuplicates: true });
  if (error) console.log('ERR checkins:', error.message);
  else checkinsAdded = checkinRows.length;
} else {
  checkinsAdded = checkinRows.length;
}

console.log(`\n${DRY ? '[DRY RUN] ' : ''}=== JTT RSVP import ===`);
console.log(`Rosters: ${rostersAdded} added, ${rostersExisting} already present`);
console.log(`Check-ins written (Available): ${checkinsAdded} player-matchup rows`);
if (checkinDateMisses.length) {
  console.log(`\nNo SH matchup found for these (player available on a non-SH / off date):`);
  checkinDateMisses.forEach(x => console.log('  ' + x));
}

// Tomorrow's first-match summary
const TMRW = '2026-06-09';
console.log(`\n=== Check-in counts for ${TMRW} (first match day) ===`);
for (const code of ['10U', '12U', '13O']) {
  const divId = divByCode[code];
  const ids = matchupIndex[divId]?.[TMRW] || [];
  const names = records.filter(r => r.division === code && r.available.includes(TMRW)).map(r => r.player_name).sort();
  console.log(`  ${code}: ${names.length} checked in -> ${names.join(', ') || '(none)'}`);
}

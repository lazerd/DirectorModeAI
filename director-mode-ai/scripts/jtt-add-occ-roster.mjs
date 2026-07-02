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
const TODAY = '2026-06-09';
const ROSTER = {
  '10U': ['Will Cleveland', 'Luke Korpi', 'Ryan Villarosa', 'Bennett Stocker', 'Van Voelker'],
  '12U': ['JJ McGinley', 'Aidan Frase', 'Alex Ewing', "Charlie O'Sullivan", 'Cora Gaffney', 'Tilly Kubas'],
  '13O': ['Mina Lin', 'Declan Tseng', 'Owen Rapp', 'Vivienne Williams', 'Paige Hegarty', 'Charley Harter'],
};

const { data: league } = await admin.from('leagues').select('id').eq('slug', SLUG).single();
const { data: divs } = await admin.from('league_divisions').select('id, short_code').eq('league_id', league.id);
const { data: clubs } = await admin.from('league_clubs').select('id, short_code').eq('league_id', league.id);
const OCC = clubs.find(c => c.short_code === 'OCC').id;
const divId = Object.fromEntries(divs.map(d => [d.short_code, d.id]));
const dc = Object.fromEntries(divs.map(d => [d.id, d.short_code]));

// OCC matchups today (per division) for check-in
const { data: mus } = await admin
  .from('league_team_matchups')
  .select('id, division_id, match_date, home_club_id, away_club_id')
  .or(`home_club_id.eq.${OCC},away_club_id.eq.${OCC}`);
const todayMatchup = {};
for (const m of mus) {
  if (String(m.match_date).slice(0, 10) === TODAY) todayMatchup[dc[m.division_id]] = m.id;
}

for (const [code, names] of Object.entries(ROSTER)) {
  const dId = divId[code];
  const { data: existing } = await admin
    .from('league_team_rosters')
    .select('id, player_name, ladder_position')
    .eq('club_id', OCC)
    .eq('division_id', dId);
  const have = new Map(existing.map(r => [r.player_name.trim().toLowerCase(), r]));
  let maxPos = existing.reduce((mx, r) => Math.max(mx, r.ladder_position || 0), 0);
  const checkinRows = [];
  for (const name of names) {
    let row = have.get(name.trim().toLowerCase());
    if (row) {
      console.log(`${code} ${name}: already on roster`);
    } else {
      maxPos++;
      const { data: ins, error } = await admin
        .from('league_team_rosters')
        .insert({ division_id: dId, club_id: OCC, player_name: name, ladder_position: maxPos })
        .select('id')
        .single();
      if (error) { console.log(`ERR ${code} ${name}: ${error.message}`); continue; }
      row = ins;
      console.log(`${code} ${name}: added (#${maxPos})`);
    }
    if (todayMatchup[code]) checkinRows.push({ matchup_id: todayMatchup[code], roster_id: row.id });
  }
  if (checkinRows.length) {
    const { error } = await admin
      .from('league_matchup_checkins')
      .upsert(checkinRows, { onConflict: 'matchup_id,roster_id', ignoreDuplicates: true });
    console.log(`  ${code}: checked in ${checkinRows.length} for today's match` + (error ? ` (ERR ${error.message})` : ''));
  }
}
console.log('\nDone.');

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

// Load .env.local
const env = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const SLUG = 'lamorinda-jtt-summer-2026';

const { data: league } = await admin.from('leagues').select('id, name, slug, status').eq('slug', SLUG).maybeSingle();
if (!league) {
  console.log('LEAGUE NOT FOUND for slug', SLUG);
  process.exit(0);
}
console.log('LEAGUE:', league);

const { data: clubs } = await admin.from('league_clubs').select('id, short_code, name').eq('league_id', league.id).order('sort_order');
console.log('\nCLUBS:', clubs.map(c => c.short_code).join(', '));
const clubShort = new Map(clubs.map(c => [c.id, c.short_code]));

const { data: divisions } = await admin.from('league_divisions').select('id, short_code, name').eq('league_id', league.id).order('sort_order');
console.log('\nDIVISIONS:', divisions.map(d => d.short_code).join(', '));

for (const d of divisions) {
  const { data: dc } = await admin.from('league_division_clubs').select('club_id').eq('division_id', d.id);
  const inDiv = dc.map(x => clubShort.get(x.club_id)).sort();
  const { data: mus } = await admin
    .from('league_team_matchups')
    .select('match_date, home_club_id, away_club_id')
    .eq('division_id', d.id)
    .order('match_date');
  const { data: rosters } = await admin.from('league_team_rosters').select('id, player_name, club_id').eq('division_id', d.id);
  const rosterByClub = {};
  for (const r of (rosters || [])) {
    const cs = clubShort.get(r.club_id);
    rosterByClub[cs] = (rosterByClub[cs] || 0) + 1;
  }
  console.log(`\n=== ${d.short_code} (${d.name}) ===`);
  console.log('  clubs:', inDiv.join(', '));
  console.log('  rosters by club:', JSON.stringify(rosterByClub));
  console.log('  matchups:');
  for (const m of (mus || [])) {
    console.log(`    ${m.match_date}  ${clubShort.get(m.away_club_id)} @ ${clubShort.get(m.home_club_id)}`);
  }
}

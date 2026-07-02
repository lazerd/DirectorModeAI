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

const { data: league } = await admin.from('leagues').select('id').eq('slug', SLUG).single();
const { data: clubs } = await admin.from('league_clubs').select('id, short_code').eq('league_id', league.id);
const cs = new Map(clubs.map(c => [c.id, c.short_code]));
const id = new Map(clubs.map(c => [c.short_code, c.id]));
const { data: div } = await admin
  .from('league_divisions').select('id').eq('league_id', league.id).eq('short_code', '13O').single();

// Find the 13+ June 30 matchup (currently SH @ MCC)
const { data: mus } = await admin
  .from('league_team_matchups')
  .select('id, home_club_id, away_club_id, home_lines_won, away_lines_won, winner, status')
  .eq('division_id', div.id)
  .eq('match_date', DATE);

if (!mus || mus.length !== 1) {
  console.log(`ABORT: expected exactly 1 13+ matchup on ${DATE}, found ${mus?.length || 0}`);
  process.exit(1);
}
const m = mus[0];
console.log(`Current 13+ ${DATE}: ${cs.get(m.away_club_id)} @ ${cs.get(m.home_club_id)} (status=${m.status})`);

// Guard: don't flip if it's been scored
if (m.winner || m.home_lines_won || m.away_lines_won || m.status === 'completed') {
  console.log('*** ABORT: matchup already has results. Not flipping. ***');
  process.exit(1);
}

const newHome = id.get('SH');
const newAway = id.get('MCC');
console.log(`New 13+ ${DATE}: MCC @ SH  (LOCATION: Sleepy Hollow)`);

if (!APPLY) { console.log('\n(dry run — pass --apply)'); process.exit(0); }

const { error } = await admin
  .from('league_team_matchups')
  .update({ home_club_id: newHome, away_club_id: newAway, notes: '3-team mashup date (host = SH)' })
  .eq('id', m.id);
if (error) throw new Error(error.message);
console.log('\n[ok] Flipped. 13+ now MCC @ SH (Sleepy Hollow hosts).');

// Create Summer Slam 2026 (Thu Jun 11) team-battle event from paper results.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter(l => l.includes('='))
    .map(l => [
      l.slice(0, l.indexOf('=')).trim(),
      l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, ''),
    ])
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const USER_ID = '7ff5078a-ee6d-46b7-9af7-20b35f62729d';

// Winners (2 pts) — team with most games. Losers (1 pt participation).
const WINNERS = ['Justin White', 'Jamie Larson', 'Jen Hill', 'Amanda (guest)', 'Hedieh Haghighi'];
const OTHERS = ['Gary Yang', 'Decio Schimura', 'Vi Le', 'Cindy Yang', 'Jessie Howard', 'Erica Desjardins'];

const KNOWN_IDS = {
  'gary yang': '82b66cca-08f0-47de-b2c8-648b397e46b6',
  'cindy yang': 'a812ae37-ac9d-4d93-bbad-025ac671e867',
  'jessie howard': '152d723b-4104-4a67-96a6-db1d8cec97cf',
  'erica desjardins': '8baec260-682b-4483-b656-73bfdc908dee',
  'justin white': '7f029b29-aa01-479f-aaf5-3436148bdd76', // older of two dupes
};

const fail = (m) => { console.error('ABORT:', m); process.exit(1); };

// idempotency: bail if the event already exists
const { data: existing } = await supabase
  .from('events').select('id').eq('user_id', USER_ID)
  .eq('name', 'Summer Slam 2026').eq('event_date', '2026-06-11').maybeSingle();
if (existing) fail(`event already exists: ${existing.id}`);

const playerId = async (name) => {
  const known = KNOWN_IDS[name.toLowerCase()];
  if (known) return known;
  const { data: found } = await supabase
    .from('players').select('id').eq('user_id', USER_ID).ilike('name', name).maybeSingle();
  if (found) return found.id;
  const { data: created, error } = await supabase
    .from('players').insert({ user_id: USER_ID, name }).select('id').single();
  if (error) fail(`create player ${name}: ${error.message}`);
  console.log(`Created player: ${name}`);
  return created.id;
};

const notes = [
  'Played on paper Thu 6/11 (internet outage) — results entered after the fact.',
  '3 rounds of singles + doubles. Team Blue won on total games.',
  'Points: 2 each — Justin White, Jamie Larson, Jen Hill, Amanda G (guest), Hedieh Haghighi.',
  '1 each (participation) — Gary Yang, Decio Schimura, Vi Le, Cindy Yang, Jessie Howard, Erica Desjardins.',
  'Amanda G = GUEST of Jen Hill (no member account) — Jen Hill billed $20 to cover both; all other players $10 (Social Tennis).',
].join('\n');

const { data: event, error: evErr } = await supabase
  .from('events')
  .insert({
    user_id: USER_ID,
    name: 'Summer Slam 2026',
    event_date: '2026-06-11',
    end_date: '2026-06-11',
    start_time: '18:00:00',
    event_code: 'SLAM11',
    num_courts: 4,
    scoring_format: 'timed',
    match_format: 'team-battle',
    team_battle_singles_courts: 2,
    team_battle_doubles_courts: 2,
    format_notes: notes,
    is_paid: false,
  })
  .select('id, event_code')
  .single();
if (evErr) fail(`event: ${evErr.message}`);
console.log('Event created:', event.id, 'code', event.event_code);

const { data: teams, error: tErr } = await supabase
  .from('event_teams')
  .insert([
    { event_id: event.id, name: 'Team Blue', color: '#3B82F6' },
    { event_id: event.id, name: 'Team Red', color: '#EF4444' },
  ])
  .select('id, name');
if (tErr) fail(`teams: ${tErr.message}`);
const blue = teams.find(t => t.name === 'Team Blue');
const red = teams.find(t => t.name === 'Team Red');

const rows = [];
for (const name of WINNERS) rows.push({ event_id: event.id, player_id: await playerId(name), team_id: blue.id, active: true });
for (const name of OTHERS) rows.push({ event_id: event.id, player_id: await playerId(name), team_id: red.id, active: true });

const { error: epErr } = await supabase.from('event_players').insert(rows);
if (epErr) fail(`event_players: ${epErr.message}`);

console.log(`\nDone: ${WINNERS.length} on Team Blue (winners, 2 pts), ${OTHERS.length} on Team Red (1 pt).`);
console.log('Event URL: /mixer/events/' + event.id);

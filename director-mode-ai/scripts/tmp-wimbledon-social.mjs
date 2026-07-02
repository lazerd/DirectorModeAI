// Create "Wimbledon Social 2026" mixer event and add the adult roster.
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

const ADULTS = [
  'Ben Schneider', 'Cindy Yang', 'Gabrial Fett',
  'Gary Yang', 'Heather Bonar', 'Jamie Larson', 'Jen Hill', 'Kersti Peter',
  'Megan Sullivan', 'Robert Bonar', 'Sarah Binder', 'Shannon Koffman',
  'Vi Le', 'William Peter', 'Yvette Girard', 'Shannon Moore', 'Stef Cohen',
];

const KNOWN_IDS = {
  'gary yang': '82b66cca-08f0-47de-b2c8-648b397e46b6',
  'cindy yang': 'a812ae37-ac9d-4d93-bbad-025ac671e867',
};

const fail = (m) => { console.error('ABORT:', m); process.exit(1); };

// idempotency: bail if the event already exists
const { data: existing } = await supabase
  .from('events').select('id').eq('user_id', USER_ID)
  .eq('name', 'Wimbledon Social 2026').maybeSingle();
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

const { data: event, error: evErr } = await supabase
  .from('events')
  .insert({
    user_id: USER_ID,
    name: 'Wimbledon Social 2026',
    event_date: '2026-07-11',
    end_date: '2026-07-11',
    start_time: '10:00:00',
    event_code: 'WIMB26',
    num_courts: 4,
    scoring_format: 'fixed_games',
    match_format: 'doubles',
    format_notes: 'Wimbledon-themed adult social doubles. Strawberries, cream & Pimm\'s.',
    is_paid: false,
  })
  .select('id, event_code')
  .single();
if (evErr) fail(`event: ${evErr.message}`);
console.log('Event created:', event.id, 'code', event.event_code);

const rows = [];
for (const name of ADULTS) rows.push({ event_id: event.id, player_id: await playerId(name), active: true });

const { error: epErr } = await supabase.from('event_players').insert(rows);
if (epErr) fail(`event_players: ${epErr.message}`);

console.log(`\nDone: ${ADULTS.length} adults added to Wimbledon Social 2026.`);
console.log('Event URL: /mixer/events/' + event.id);

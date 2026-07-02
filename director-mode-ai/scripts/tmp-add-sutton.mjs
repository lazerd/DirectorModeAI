// Add Sutton Koffman to the existing Wimbledon Social 2026 event.
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
const EVENT_ID = 'd88e8452-d6a4-4a21-8f0d-90046dc37a90';
const NAME = 'Sutton Koffman';
const fail = (m) => { console.error('ABORT:', m); process.exit(1); };

let { data: player } = await supabase
  .from('players').select('id').eq('user_id', USER_ID).ilike('name', NAME).maybeSingle();
if (!player) {
  const { data: created, error } = await supabase
    .from('players').insert({ user_id: USER_ID, name: NAME }).select('id').single();
  if (error) fail(`create player: ${error.message}`);
  player = created;
  console.log('Created player:', NAME);
}

const { data: existing } = await supabase
  .from('event_players').select('event_id').eq('event_id', EVENT_ID).eq('player_id', player.id).maybeSingle();
if (existing) { console.log('Already on event.'); process.exit(0); }

const { error: epErr } = await supabase
  .from('event_players').insert({ event_id: EVENT_ID, player_id: player.id, active: true });
if (epErr) fail(`event_players: ${epErr.message}`);
console.log('Added', NAME, 'to Wimbledon Social 2026.');

// Set Wimbledon Social 2026 to use physical courts 2,3,4,5 and remap any
// already-generated matches from slots 1-4 to those court numbers.
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

const EVENT_ID = 'd88e8452-d6a4-4a21-8f0d-90046dc37a90';
const COURTS = ['2', '3', '4', '5'];
const fail = (m) => { console.error('ABORT:', m); process.exit(1); };

// 1. Set the court list + count on the event.
const { error: evErr } = await supabase
  .from('events')
  .update({ court_names: COURTS, num_courts: COURTS.length })
  .eq('id', EVENT_ID);
if (evErr) fail(`event update: ${evErr.message}`);
console.log(`Set court_names = [${COURTS.join(', ')}], num_courts = ${COURTS.length}`);

// 2. Remap existing matches: slot N (court_number 1..4) -> COURTS[N-1].
const { data: rounds, error: rErr } = await supabase
  .from('rounds').select('id').eq('event_id', EVENT_ID);
if (rErr) fail(`rounds: ${rErr.message}`);
const roundIds = (rounds ?? []).map(r => r.id);

let remapped = 0;
if (roundIds.length) {
  const { data: matches, error: mErr } = await supabase
    .from('matches').select('id, court_number').in('round_id', roundIds);
  if (mErr) fail(`matches: ${mErr.message}`);
  for (const m of matches ?? []) {
    const target = COURTS[m.court_number - 1];
    if (!target) continue;
    const n = parseInt(target, 10);
    if (n === m.court_number) continue;
    const { error } = await supabase.from('matches').update({ court_number: n }).eq('id', m.id);
    if (error) fail(`match ${m.id}: ${error.message}`);
    remapped++;
  }
}
console.log(`Remapped ${remapped} existing match court number(s).`);
console.log('Done. Wimbledon Social 2026 is now on courts 2, 3, 4, 5.');

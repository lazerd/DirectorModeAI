// Fix duplicate court numbers in Wimbledon Social 2026's not-yet-completed
// rounds: real matches (>=2 players) -> courts 2,3,4,5; byes -> 0 (no court).
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim().replace(/^["']|["']$/g,'')]));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const EVENT_ID = 'd88e8452-d6a4-4a21-8f0d-90046dc37a90';
const REAL_COURTS = [2, 3, 4, 5];
// Byes don't need a real court; park them on unused positive numbers so they
// stay unique (the current Save validation rejects 0 / duplicates).
const BYE_POOL = [1, 6, 7, 8, 9, 10];
const fail = (m) => { console.error('ABORT:', m); process.exit(1); };

const { data: rounds, error: rErr } = await supabase
  .from('rounds').select('id, round_number, status').eq('event_id', EVENT_ID).order('round_number');
if (rErr) fail(rErr.message);

for (const r of rounds ?? []) {
  if (r.status === 'completed') { console.log(`Round ${r.round_number}: completed — left as-is.`); continue; }
  const { data: matches, error: mErr } = await supabase
    .from('matches').select('id, court_number, player1_id, player2_id, player3_id, player4_id')
    .eq('round_id', r.id).order('court_number').order('id');
  if (mErr) fail(mErr.message);

  let courtIdx = 0, byeIdx = 0;
  const assigns = [];
  for (const m of matches ?? []) {
    const count = [m.player1_id, m.player2_id, m.player3_id, m.player4_id].filter(Boolean).length;
    const court = count < 2 ? (BYE_POOL[byeIdx++] ?? 99) : (REAL_COURTS[courtIdx++] ?? (BYE_POOL[byeIdx++] ?? 99));
    assigns.push({ id: m.id, court });
  }
  for (const a of assigns) {
    const { error } = await supabase.from('matches').update({ court_number: a.court }).eq('id', a.id);
    if (error) fail(`match ${a.id}: ${error.message}`);
  }
  console.log(`Round ${r.round_number} [${r.status}]: ${assigns.map(a=>a.court).join(',')}`);
}
console.log('Done.');

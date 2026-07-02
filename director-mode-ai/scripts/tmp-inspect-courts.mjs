import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim().replace(/^["']|["']$/g,'')]));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const EVENT_ID = 'd88e8452-d6a4-4a21-8f0d-90046dc37a90';
const { data: rounds } = await supabase.from('rounds').select('id, round_number, status').eq('event_id', EVENT_ID).order('round_number');
for (const r of rounds ?? []) {
  const { data: m } = await supabase.from('matches').select('court_number, player1_id, player2_id, player3_id, player4_id').eq('round_id', r.id).order('court_number');
  const nums = (m ?? []).map(x => x.court_number);
  const dupes = nums.filter((n,i)=>nums.indexOf(n)!==i);
  console.log(`Round ${r.round_number} [${r.status}]: courts ${JSON.stringify(nums)}${dupes.length?'  DUPLICATES: '+JSON.stringify([...new Set(dupes)]):''}`);
  (m ?? []).forEach(x => {
    const players = [x.player1_id,x.player2_id,x.player3_id,x.player4_id].filter(Boolean).length;
    if (players < 2) console.log(`   court ${x.court_number}: BYE (${players} player)`);
  });
}

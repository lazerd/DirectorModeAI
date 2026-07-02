import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim().replace(/^["']|["']$/g,'')]));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const EVENT_ID = 'd88e8452-d6a4-4a21-8f0d-90046dc37a90';

const { data: ev } = await supabase.from('events').select('*').eq('id', EVENT_ID).single();
console.log('EVENTS COLUMNS:', Object.keys(ev).sort().join(', '));
console.log('\nwinner-ish columns:', Object.keys(ev).filter(k => /win|champ|prize|gender|settings|meta|config/i.test(k)));

const { data: eps } = await supabase
  .from('event_players')
  .select('player_id, players(name, gender)')
  .eq('event_id', EVENT_ID);
const withG = (eps||[]).filter(e => e.players?.gender);
console.log(`\nEVENT PLAYERS: ${eps?.length} total, ${withG.length} have gender set`);
console.log('sample:', (eps||[]).slice(0,6).map(e => `${e.players?.name}=${e.players?.gender ?? 'null'}`).join(', '));

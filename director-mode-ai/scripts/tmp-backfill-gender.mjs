import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim().replace(/^["']|["']$/g,'')]));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const EVENT_ID = 'd88e8452-d6a4-4a21-8f0d-90046dc37a90';

const GENDER = {
  'cindy yang':'female','heather bonar':'female','jamie larson':'female','jen hill':'female',
  'kersti peter':'female','megan sullivan':'female','sarah binder':'female','vi le':'female',
  'yvette girard':'female','stef cohen':'female','sutton koffman':'female',
  'ben schneider':'male','gabrial fett':'male','gary yang':'male','robert bonar':'male',
  'shannon koffman':'male','william peter':'male',
  // shannon moore: unknown, left null
};

const { data: eps } = await supabase.from('event_players').select('player_id, players(id, name, gender)').eq('event_id', EVENT_ID);
let updated = 0, skipped = [];
for (const ep of eps || []) {
  const p = ep.players; if (!p) continue;
  const g = GENDER[(p.name||'').toLowerCase().trim()];
  if (!g) { if (!p.gender) skipped.push(p.name); continue; }
  if (p.gender === g) continue;
  const { error } = await supabase.from('players').update({ gender: g }).eq('id', p.id);
  if (error) { console.error('ERR', p.name, error.message); continue; }
  updated++;
}
console.log(`Updated gender on ${updated} players.`);
if (skipped.length) console.log('Left null (unknown gender):', skipped.join(', '));

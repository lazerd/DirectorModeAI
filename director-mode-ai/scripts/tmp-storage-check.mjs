import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim().replace(/^["']|["']$/g,'')]));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data: buckets, error } = await supabase.storage.listBuckets();
console.log('listBuckets error:', error?.message || 'none');
console.log('BUCKETS:', (buckets||[]).map(b => `${b.name} (public=${b.public})`).join(', ') || '(none)');

for (const name of ['event-photos','event-assets']) {
  const b = (buckets||[]).find(x => x.name === name);
  console.log(`  ${name}: ${b ? 'EXISTS public='+b.public : 'MISSING'}`);
}

// event_photos table
const { error: tErr } = await supabase.from('event_photos').select('id').limit(1);
console.log('event_photos table:', tErr ? 'ERROR: '+tErr.message : 'OK');

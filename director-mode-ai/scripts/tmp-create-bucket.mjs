import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim().replace(/^["']|["']$/g,'')]));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { data, error } = await supabase.storage.createBucket('event-photos', { public: true, fileSizeLimit: 10485760 });
if (error && !/already exists/i.test(error.message)) { console.error('ERROR:', error.message); process.exit(1); }
console.log(error ? 'Bucket already exists.' : 'Created event-photos bucket (public).');
const { data: buckets } = await supabase.storage.listBuckets();
console.log('Buckets now:', buckets.map(b=>`${b.name}(public=${b.public})`).join(', '));

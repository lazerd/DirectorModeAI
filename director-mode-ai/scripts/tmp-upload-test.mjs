import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim().replace(/^["']|["']$/g,'')]));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const EVENT_ID = 'd88e8452-d6a4-4a21-8f0d-90046dc37a90';
const USER_ID = '7ff5078a-ee6d-46b7-9af7-20b35f62729d';

// 1x1 transparent PNG
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAQDJj+wkAAAAAElFTkSuQmCC','base64');
const path = `${USER_ID}/${EVENT_ID}/selftest-${Date.now()}.png`;

const up = await admin.storage.from('event-photos').upload(path, png, { contentType:'image/png', upsert:false });
console.log('storage upload:', up.error ? 'FAIL '+up.error.message : 'OK');
if (up.error) process.exit(1);

const { data: urlData } = admin.storage.from('event-photos').getPublicUrl(path);
const ins = await admin.from('event_photos').insert({ event_id:EVENT_ID, photo_url:urlData.publicUrl, storage_path:path, display_order:99, uploaded_by:USER_ID }).select('id').single();
console.log('db insert:', ins.error ? 'FAIL '+ins.error.message : 'OK id='+ins.data.id);

// cleanup
if (ins.data?.id) await admin.from('event_photos').delete().eq('id', ins.data.id);
await admin.storage.from('event-photos').remove([path]);
console.log('cleaned up. Public URL sample:', urlData.publicUrl);

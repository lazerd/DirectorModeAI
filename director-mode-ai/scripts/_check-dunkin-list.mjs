// Read-only check (9/29/26): as Darrin, does the promo panel list the Dunkin'
// player list, and does a quad-promote audience built from it resolve to the
// families? GET /api/campaigns builds the audience; it sends nothing.
import { readFileSync } from 'fs';
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')&&!l.trimStart().startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim().replace(/^["']|["']$/g,'')]));
const APP = 'https://clubmode.ai';
const EVENT = 'c3f2b67c-ed22-41d7-a057-c3a6647bdae4';
const SB = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const gen = await (await fetch(`${SB}/auth/v1/admin/generate_link`, { method:'POST', headers:{ apikey:KEY, authorization:`Bearer ${KEY}`, 'content-type':'application/json' }, body: JSON.stringify({ type:'magiclink', email:'darrinjco@gmail.com' }) })).json();
const s = await (await fetch(`${SB}/auth/v1/verify`, { method:'POST', headers:{ apikey:KEY, 'content-type':'application/json' }, body: JSON.stringify({ type:'magiclink', token_hash: gen.hashed_token }) })).json();
const ref = new URL(SB).hostname.split('.')[0];
const val = 'base64-' + Buffer.from(JSON.stringify({ access_token:s.access_token, token_type:'bearer', expires_in:s.expires_in, expires_at:s.expires_at, refresh_token:s.refresh_token, user:s.user })).toString('base64');
const CH = 3180;
const cookie = val.length <= CH ? `sb-${ref}-auth-token=${val}` : Array.from({ length: Math.ceil(val.length/CH) }, (_, i) => `sb-${ref}-auth-token.${i}=${val.slice(i*CH,(i+1)*CH)}`).join('; ');

const pe = await (await fetch(`${APP}/api/campaigns/past-events?eventId=${EVENT}`, { headers:{ cookie } })).json();
const list = (pe.events || []).find((e) => e.id === 'list:sponsor:dunkin');
console.log('panel source:', list ? `${list.name} (${list.paidCount})` : 'MISSING', `of ${pe.events?.length} sources`);

const c = await (await fetch(`${APP}/api/campaigns?surface=quad-promote&targetId=${EVENT}&sourceEventId=list:sponsor:dunkin`, { headers:{ cookie } })).json();
console.log('audience from the list alone:', c.everyoneCount ?? c.error, 'families (anyone already entered + you are dropped)');
const all = await (await fetch(`${APP}/api/campaigns?surface=quad-promote&targetId=${EVENT}`, { headers:{ cookie } })).json();
console.log('audience with every source ticked:', all.everyoneCount ?? all.error);

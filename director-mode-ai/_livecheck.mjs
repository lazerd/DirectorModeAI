/**
 * Fetch the deployed timeline page as a real signed-in user, by minting a
 * Supabase session and presenting it the way @supabase/ssr stores it.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
);

const [email, password] = process.argv.slice(2);
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const { data, error } = await anon.auth.signInWithPassword({ email, password });
if (error) throw new Error('login failed: ' + error.message);

const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
const payload = 'base64-' + Buffer.from(JSON.stringify(data.session)).toString('base64');

// @supabase/ssr splits anything over ~3180 bytes into .0/.1 chunks.
const CHUNK = 3180;
const cookies = [];
if (payload.length > CHUNK) {
  for (let i = 0, n = 0; i < payload.length; i += CHUNK, n++) {
    cookies.push(`sb-${ref}-auth-token.${n}=${payload.slice(i, i + CHUNK)}`);
  }
} else {
  cookies.push(`sb-${ref}-auth-token=${payload}`);
}

const BASE = 'https://club.coachmode.ai';
const TEAM = '517c278c-3878-49be-83fd-a8faa2ab99d0';

async function get(path) {
  const res = await fetch(BASE + path, {
    headers: { cookie: cookies.join('; ') },
    redirect: 'manual',
  });
  return { status: res.status, location: res.headers.get('location'), body: await res.text() };
}

const page = await get(`/captain/${TEAM}/timeline`);
console.log(`GET /captain/${TEAM}/timeline -> ${page.status}${page.location ? ' -> ' + page.location : ''}`);

if (page.status === 200) {
  const has = (s) => (page.body.includes(s) ? 'yes' : 'NO');
  console.log('  renders "Season email timeline":', has('Season email timeline'));
  console.log('  renders automation rules:      ', has('Automation rules'));
  console.log('  renders a lineup subject:      ', has('lineup —'));
  console.log('  renders the nudge subject:     ', has('Still need your answer'));
  const days = [...page.body.matchAll(/days before each match/g)].length;
  console.log('  lead-time inputs rendered:     ', days);
  const rows = [...page.body.matchAll(/to \d+ players/g)].length;
  console.log('  timeline rows rendered:        ', rows);
}

const api = await get(`/api/captain/timeline?team_id=${TEAM}`);
console.log(`GET /api/captain/timeline -> ${api.status}`);
if (api.status === 200) {
  const j = JSON.parse(api.body);
  console.log('  events:', j.events.length, '· roster with email:', j.roster_with_email);
  const byStatus = {};
  for (const e of j.events) byStatus[e.status] = (byStatus[e.status] || 0) + 1;
  console.log('  by status:', JSON.stringify(byStatus));
  const next = j.events.find((e) => e.status === 'scheduled' || e.status === 'due');
  if (next) {
    const when = new Intl.DateTimeFormat('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      timeZone: 'America/Los_Angeles',
    }).format(new Date(next.sendAt));
    console.log(`  next real send: ${next.kind} on ${when} — "${next.subject}" to ${next.audienceCount}`);
  }
}

await anon.auth.signOut();

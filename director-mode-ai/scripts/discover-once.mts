/**
 * Run club discovery once by hand.
 *   npx tsx scripts/discover-once.mts --dry-run [--count 3]   (default: dry run)
 *   npx tsx scripts/discover-once.mts --live --count 3          (inserts into the CRM)
 */
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]));
Object.assign(process.env, env, { BRAVE_API_KEY: process.env.BRAVE_API_KEY, GEMINI_API_KEY: process.env.GEMINI_API_KEY });
const { discoverClubs } = await import('../src/lib/outreach/discover.ts');

const args = process.argv.slice(2);
const live = args.includes('--live');
const i = args.indexOf('--count');
const count = i >= 0 ? Number(args[i + 1]) : 3;
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const t0 = Date.now();
const r = await discoverClubs(db as never, { count, dryRun: !live });
console.log(`${live ? 'LIVE' : 'DRY RUN'} in ${Math.round((Date.now() - t0) / 1000)}s — ${r.note}`);
for (const c of r.accepted ?? []) console.log(`\nOK  ${c.club} (${c.city}, ${c.state})\n    ${c.contact_name}, ${c.contact_title} <${c.email}>\n    ${c.source_url}\n    ${c.why}`);
for (const s of r.skipped) console.log(`SKIP ${s}`);
if (live) console.log('\nadded:', r.added);

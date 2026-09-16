/**
 * Show tomorrow's deck without touching anything.
 *
 *   npx vite-node -c vitest.config.ts scripts/outreach-dry-run.ts
 *   npx vite-node -c vitest.config.ts scripts/outreach-dry-run.ts --write
 *
 * The planner, run against the real database, printing the cards it WOULD
 * queue. It writes no rows and sends nothing unless --write is passed, and
 * even then it only writes `planned` rows — a planned row has never been in
 * anyone's inbox and needs a swipe to get anywhere near one.
 *
 * This exists because the first thing to do with a cold engine pointed at 519
 * real clubs is read fifteen real cards and send none of them.
 */
import { readFileSync } from 'fs';

// The scripts in this repo read .env.local themselves; there is no dotenv.
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const i = line.indexOf('=');
  if (i < 1 || line.trimStart().startsWith('#')) continue;
  const k = line.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}

const { getSupabaseAdmin } = await import('../src/lib/supabase/admin');
const { planDay } = await import('../src/lib/outreach/plan');
const { capForDay } = await import('../src/lib/outreach/settings');
const { loadSettings } = await import('../src/lib/outreach/plan');

const write = process.argv.includes('--write');
const db = getSupabaseAdmin();
const settings = await loadSettings(db);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());

console.log(`\ncap today: ${capForDay(settings, today)}  ·  paused: ${settings.paused}  ·  follow-up after ${settings.follow_up_days} days`);
console.log(`warmup: ${settings.warmup_start_date ?? 'not started'}  ·  window ${settings.send_window_start}–${settings.send_window_end} club-local\n`);

const result = await planDay(db, {
  repEmail: process.env.OUTREACH_DRY_RUN_REP || 'darrinjco@gmail.com',
  repName: 'Darrin Cohen',
  dryRun: !write,
});

console.log(`${write ? 'WROTE' : 'WOULD WRITE'} ${result.cards.length} cards for ${result.date} (cap ${result.cap})`);
if (result.note) console.log(result.note);

for (const [i, c] of result.cards.entries()) {
  console.log('\n' + '─'.repeat(72));
  console.log(`${i + 1}. ${c.org_name}  →  ${c.to}   [${c.kind}, ${c.generated_by}]`);
  console.log(`   why: ${c.why}`);
  if (c.rejected) console.log(`   model draft REJECTED (${c.rejected.join(', ')}) — using the plain template`);
  console.log(`   subject: ${c.subject}`);
  console.log('');
  console.log(c.body.split('\n').map((l) => '   ' + l).join('\n'));
}

const counts = result.skipped.reduce<Record<string, number>>((m, s) => ({ ...m, [s.reason]: (m[s.reason] ?? 0) + 1 }), {});
console.log('\n' + '─'.repeat(72));
console.log('skipped:', counts);
console.log(write ? '\nRows are PLANNED. Nothing sends until someone swipes right at /crm/deck.\n' : '\nNothing was written. Nothing was sent.\n');

/**
 * reset-rossmoor-demo.mjs — put the Rossmoor sales demo back the way it started.
 *
 * The demo link lets a prospect click everything, so by the next morning the
 * court sheet has their test bookings, CourtConnect has their games and the
 * check-in board has their sessions. This runs nightly and undoes all of it:
 *
 *   1. clears what visitors made at the club: CourtConnect games (their players
 *      and links cascade), check-in sessions and wait-list entries, the court
 *      sheet rows check-in mirrored, and court sheet rows the demo logins made
 *   2. seed-rossmoor.mjs        the club, its website and weekly programs
 *                               (no --owner, so the owner stays as it is)
 *   3. seed-rossmoor-demo.mjs   the demo logins, residents, teams, court sheet,
 *                               events (passwords are NOT rotated)
 *   4. seed-rossmoor-mixer.mjs  the October Wild Card mixer
 *
 * What it keeps: the demo link token (demo_links is never touched), the demo
 * account passwords, and the check-in sign tokens, so printed QR codes and the
 * link Darrin sent keep working.
 *
 * Step 1 clears EVERY such row at the club, not just today's: none of the
 * seeds create CourtConnect games or check-in sessions, so everything there was
 * made by someone exploring since the last reset. It refuses to run unless the
 * club is in demo_mode, so it can never wipe a real club's activity.
 *
 *   node scripts/reset-rossmoor-demo.mjs
 *
 * Schedule (Windows Task Scheduler, 3:30am Pacific nightly), from cmd.exe:
 *
 *   mkdir C:\Users\darri\AppData\Local\ClubMode
 *   schtasks /Create /TN "ClubMode Rossmoor demo reset" /SC DAILY /ST 03:30 /F /TR "cmd /c cd /d C:\Users\darri\DirectorModeAI\director-mode-ai && node scripts\reset-rossmoor-demo.mjs >> C:\Users\darri\AppData\Local\ClubMode\rossmoor-demo-reset.log 2>&1"
 *
 * The log lives outside the repo so it never shows up in git. The machine must
 * be on at 3:30; "Run whether user is logged on or not" and "Run task as soon
 * as possible after a scheduled start is missed" are set in the Task Scheduler
 * UI afterwards.
 */

import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const SLUG = 'rossmoor-tennis-club';
const DEMO_EMAILS = ['rossmoor-demo@clubmode.ai', 'rossmoor-member@clubmode.ai', 'rossmoor-member2@clubmode.ai'];

// The seeds read .env.local from the working directory; run from the app root
// whatever directory the scheduler started in.
const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(APP_DIR);

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const stamp = () => new Date().toISOString();

async function must(p, what) {
  const { data, error, count } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return { data, count };
}

async function clearVisitorActivity() {
  const { data: club } = await db.from('cc_clubs').select('id, name, demo_mode').eq('slug', SLUG).maybeSingle();
  if (!club) {
    console.log('· no club yet — nothing to clear');
    return;
  }
  if (!club.demo_mode) throw new Error(`${club.name} is not in demo_mode; refusing to clear its activity.`);

  const games = await must(db.from('pf_games').delete({ count: 'exact' }).eq('club_id', club.id), 'pf_games');
  const waits = await must(db.from('checkin_waits').delete({ count: 'exact' }).eq('club_id', club.id), 'checkin_waits');
  const sessions = await must(db.from('checkin_sessions').delete({ count: 'exact' }).eq('club_id', club.id), 'checkin_sessions');
  const mirrored = await must(
    db.from('reservations').delete({ count: 'exact' }).eq('club_id', club.id).eq('meta->>origin', 'checkin'),
    'check-in court sheet rows',
  );

  // Court sheet rows the demo logins made by hand. The demo seed rebuilds its
  // own (meta.seed) itself.
  const ids = [];
  for (let page = 1; page < 50; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) if (DEMO_EMAILS.includes((u.email || '').toLowerCase())) ids.push(u.id);
    if (data.users.length < 1000) break;
  }
  let manual = { count: 0 };
  if (ids.length) {
    const { data: rows } = await db.from('reservations').select('id').eq('club_id', club.id).in('created_by', ids);
    const rowIds = (rows ?? []).map((r) => r.id);
    if (rowIds.length) {
      await db.from('reservation_signups').delete().in('reservation_id', rowIds);
      manual = await must(db.from('reservations').delete({ count: 'exact' }).in('id', rowIds), 'demo reservations');
    }
  }

  console.log(
    `· cleared ${games.count ?? 0} CourtConnect game(s), ${sessions.count ?? 0} check-in session(s), ` +
      `${waits.count ?? 0} wait-list entr(ies), ${(mirrored.count ?? 0) + (manual.count ?? 0)} court sheet row(s)`,
  );
}

function run(script) {
  console.log(`\n[${stamp()}] node scripts/${script}`);
  const r = spawnSync(process.execPath, [join('scripts', script)], { stdio: 'inherit', cwd: APP_DIR });
  if (r.status !== 0) throw new Error(`${script} exited ${r.status}`);
}

async function main() {
  console.log(`\n[${stamp()}] Resetting the Rossmoor demo`);
  await clearVisitorActivity();
  run('seed-rossmoor.mjs');
  run('seed-rossmoor-demo.mjs');
  run('seed-rossmoor-mixer.mjs');
  console.log(`\n[${stamp()}] Rossmoor demo reset complete`);
}

main().catch((e) => {
  console.error(`\n[${stamp()}] RESET FAILED:`, e.message || e);
  process.exit(1);
});

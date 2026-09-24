/**
 * reset-sample-club-demo.mjs — put Harbor View Racquet Club (the shared cold
 * email demo) back the way it started, nightly.
 *
 * Every cold letter links here, so by morning the court sheet, CourtConnect
 * and check-in carry whatever strangers clicked. This undoes it, exactly like
 * reset-rossmoor-pickleball-demo.mjs:
 *
 *   1. clears what visitors made at the club (CourtConnect games, check-in
 *      sessions and waits, check-in court sheet rows, and court sheet rows /
 *      bookings made by the demo logins or the public booking page)
 *   2. seed-sample-club.mjs rebuilds everything, dated relative to today, with
 *      the SAME demo link token and the SAME mixer event id, so the pitch link
 *      in sent mail keeps working
 *
 * Refuses to run unless the club is in demo_mode.
 *
 *   node scripts/reset-sample-club-demo.mjs
 *
 * Scheduled (Windows Task Scheduler, 4:00am Pacific, after the two Rossmoor
 * resets):
 *
 *   schtasks /Create /TN "ClubMode sample club demo reset" /SC DAILY /ST 04:00 /F /TR "cmd /c cd /d C:\Users\darri\DirectorModeAI\director-mode-ai && node scripts\reset-sample-club-demo.mjs >> C:\Users\darri\AppData\Local\ClubMode\sample-club-demo-reset.log 2>&1"
 */

import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const SLUG = 'harbor-view-racquet-club';
const DEMO_EMAILS = ['sample-demo@clubmode.ai', 'sample-member@clubmode.ai', 'sample-member2@clubmode.ai'];

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

async function demoUserIds() {
  const ids = [];
  for (let page = 1; page < 50; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) if (DEMO_EMAILS.includes((u.email || '').toLowerCase())) ids.push(u.id);
    if (data.users.length < 1000) break;
  }
  return ids;
}

async function clearVisitorActivity() {
  const { data: club } = await db
    .from('cc_clubs')
    .select('id, name, demo_mode')
    .eq('slug', SLUG)
    .maybeSingle();
  if (!club) {
    console.log('· no club yet — nothing to clear');
    return;
  }
  if (!club.demo_mode) throw new Error(`${club.name} is not in demo_mode; refusing to clear its activity.`);

  const games = await must(db.from('pf_games').delete({ count: 'exact' }).eq('club_id', club.id), 'pf_games');
  const waits = await must(db.from('checkin_waits').delete({ count: 'exact' }).eq('club_id', club.id), 'checkin_waits');
  const sessions = await must(
    db.from('checkin_sessions').delete({ count: 'exact' }).eq('club_id', club.id),
    'checkin_sessions',
  );
  const mirrored = await must(
    db.from('reservations').delete({ count: 'exact' }).eq('club_id', club.id).eq('meta->>origin', 'checkin'),
    'check-in court sheet rows',
  );

  /*
   * Court sheet rows and court bookings a VISITOR made.
   *
   * Two ways in. Signed in through the demo link, a booking lands with
   * created_by set to that demo login. Not signed in — the booking page takes
   * a public booking at the guest rate — it lands with created_by set to the
   * club's owner and source 'courtconnect', which is the one thing no seeded
   * row here is. Either way the court_bookings row goes with the reservation
   * (ON DELETE CASCADE), and so do reservation_signups.
   *
   * Rows the demo seed made are left alone (meta.seed is set on every one of
   * them); that script deletes and rebuilds its own in step 3, so counting
   * them here would report 150 "visitor" rows every single night.
   */
  const ids = await demoUserIds();
  const visitorRows = new Set();
  const collect = async (q, what) => {
    const { data } = await must(q, what);
    for (const r of data ?? []) visitorRows.add(r.id);
  };
  const untagged = () =>
    db.from('reservations').select('id').eq('club_id', club.id).is('meta->>seed', null);
  if (ids.length) await collect(untagged().in('created_by', ids), 'demo-login court sheet rows');
  await collect(untagged().eq('source', 'courtconnect'), 'public court bookings');

  let manual = 0;
  let bookings = 0;
  if (visitorRows.size) {
    const rowIds = [...visitorRows];
    const { count: bc } = await db
      .from('court_bookings')
      .select('id', { count: 'exact', head: true })
      .in('reservation_id', rowIds);
    bookings = bc ?? 0;
    const res = await must(
      db.from('reservations').delete({ count: 'exact' }).in('id', rowIds),
      'visitor reservations',
    );
    manual = res.count ?? 0;
  }

  console.log(
    `· cleared ${games.count ?? 0} CourtConnect game(s), ${sessions.count ?? 0} check-in session(s), ` +
      `${waits.count ?? 0} wait-list entr(ies), ${(mirrored.count ?? 0) + manual} court sheet row(s), ` +
      `${bookings} court booking(s)`,
  );
}

function run(script) {
  console.log(`\n[${stamp()}] node scripts/${script}`);
  const r = spawnSync(process.execPath, [join('scripts', script)], { stdio: 'inherit', cwd: APP_DIR });
  if (r.status !== 0) throw new Error(`${script} exited ${r.status}`);
}

async function main() {
  console.log(`\n[${stamp()}] Resetting the sample club demo`);
  await clearVisitorActivity();
  run('seed-sample-club.mjs');
  console.log(`\n[${stamp()}] Sample club demo reset complete`);
}

main().catch((e) => {
  console.error(`\n[${stamp()}] RESET FAILED:`, e.message || e);
  process.exit(1);
});

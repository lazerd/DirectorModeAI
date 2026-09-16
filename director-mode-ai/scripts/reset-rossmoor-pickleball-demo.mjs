/**
 * reset-rossmoor-pickleball-demo.mjs — put the Rossmoor Pickleball Club sales
 * demo back the way it started.
 *
 * The demo link lets a prospect click everything, so by the next morning the
 * court sheet has their test bookings, CourtConnect has their games and the
 * check-in board has their sessions. This runs nightly and undoes all of it:
 *
 *   1. clears what visitors made at the club: CourtConnect games (their
 *      players and links cascade), check-in sessions and wait-list entries,
 *      the court sheet rows check-in mirrored, and the court sheet rows and
 *      court bookings the demo logins made
 *   2. seed-rossmoor-pickleball.mjs       the club, its website, its courts,
 *                                         rate cards and weekly programmes
 *                                         (no --owner, so the owner stays put)
 *   3. seed-rossmoor-pickleball-demo.mjs  the demo logins, the 80 invented
 *                                         residents, the week on the indoor
 *                                         courts, the bookings, the Hit and
 *                                         Giggle draw and the 2026 calendar
 *                                         (passwords are NOT rotated)
 *   4. two open CourtConnect games posted by the second demo member
 *
 * What it keeps: the demo link token (demo_links is never touched), the demo
 * account passwords, and the check-in sign tokens, so printed QR codes and the
 * link Darrin sent keep working.
 *
 * Step 1 clears EVERY such row at the club, not just today's: none of the
 * seeds create CourtConnect games or check-in sessions before step 4, so
 * everything there was made by someone exploring since the last reset. It
 * refuses to run unless the club is in demo_mode, so it can never wipe a real
 * club's activity.
 *
 *   node scripts/reset-rossmoor-pickleball-demo.mjs
 *
 * Schedule (Windows Task Scheduler, 3:45am Pacific nightly), from cmd.exe —
 * 3:45 rather than 3:30 so it does not overlap the Rossmoor Tennis reset:
 *
 *   mkdir C:\Users\darri\AppData\Local\ClubMode
 *   schtasks /Create /TN "ClubMode Rossmoor Pickleball demo reset" /SC DAILY /ST 03:45 /F /TR "cmd /c cd /d C:\Users\darri\DirectorModeAI\director-mode-ai && node scripts\reset-rossmoor-pickleball-demo.mjs >> C:\Users\darri\AppData\Local\ClubMode\rossmoor-pickleball-demo-reset.log 2>&1"
 *
 * NOT REGISTERED by this script. The log lives outside the repo so it never
 * shows up in git. The machine must be on at 3:45; "Run whether user is logged
 * on or not" and "Run task as soon as possible after a scheduled start is
 * missed" are set in the Task Scheduler UI afterwards.
 */

import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const SLUG = 'rossmoor-pickleball-club';
const DEMO_EMAILS = ['rpc-demo@clubmode.ai', 'rpc-member@clubmode.ai', 'rpc-member2@clubmode.ai'];
const MEMBER2 = 'rpc-member2@clubmode.ai';

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

/**
 * A CourtConnect board with nothing on it demos nothing: the member lands on
 * "No games need players right now". Casey (the second demo member) posts two
 * open games so Robin can tap "I'm in" on the first visit. Inserted directly —
 * posting through the app would notify the club, and this is a reset, not a
 * visitor.
 *
 * Delete-then-insert by poster, so this always leaves exactly two whether it
 * runs after the seed (which posts its own two) or on its own.
 *
 * Times are 10:00 and 16:00 club time, built with the zone's real offset on
 * that date (PDT until Nov 1 2026, PST after), never a naive server date.
 */
async function seedOpenGames() {
  const { data: club } = await db.from('cc_clubs').select('id, timezone').eq('slug', SLUG).maybeSingle();
  const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const casey = (list?.users ?? []).find((u) => (u.email || '').toLowerCase() === MEMBER2);
  if (!club || !casey) return console.log('· open games skipped (club or the second demo member is missing)');
  const tz = club.timezone || 'America/Los_Angeles';

  const clubTime = (daysAhead, hhmm) => {
    const day = new Date(Date.now() + daysAhead * 864e5);
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(day);
    const off =
      new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
        .formatToParts(new Date(`${ymd}T12:00:00Z`))
        .find((p) => p.type === 'timeZoneName')
        .value.replace('GMT', '') || '+00:00';
    return new Date(`${ymd}T${hhmm}:00${off}`).toISOString();
  };

  await must(db.from('pf_games').delete().eq('club_id', club.id).eq('posted_by', casey.id), 'clear prior open games');

  // The rating band is the club's own levels as the numbers CourtConnect
  // filters on: 2.75 is Intermediate, 3.25 Advanced Intermediate.
  const games = [
    {
      starts_at: clubTime(1, '10:00'),
      format: 'doubles',
      spots_needed: 2,
      rating_min: 2.75,
      rating_max: 3.25,
      include_unrated: false,
      note: 'Rec doubles, Intermediate and up. I’ll bring balls.',
    },
    {
      starts_at: clubTime(2, '16:00'),
      format: 'mixed',
      spots_needed: 2,
      rating_min: null,
      rating_max: null,
      include_unrated: true,
      note: 'Mixed, all levels welcome — new members especially.',
    },
  ];
  for (const g of games) {
    const { error } = await db
      .from('pf_games')
      .insert({ ...g, club_id: club.id, posted_by: casey.id, duration_min: 90, status: 'open' });
    if (error) throw new Error(`open game: ${error.message}`);
  }
  console.log(`· posted ${games.length} open CourtConnect games as the second demo member`);
}

async function main() {
  console.log(`\n[${stamp()}] Resetting the Rossmoor Pickleball demo`);
  await clearVisitorActivity();
  run('seed-rossmoor-pickleball.mjs');
  run('seed-rossmoor-pickleball-demo.mjs');
  await seedOpenGames();
  console.log(`\n[${stamp()}] Rossmoor Pickleball demo reset complete`);
  console.log(
    '\nTo schedule it nightly (cmd.exe, once):\n' +
      '  schtasks /Create /TN "ClubMode Rossmoor Pickleball demo reset" /SC DAILY /ST 03:45 /F /TR ' +
      '"cmd /c cd /d C:\\Users\\darri\\DirectorModeAI\\director-mode-ai && node scripts\\reset-rossmoor-pickleball-demo.mjs ' +
      '>> C:\\Users\\darri\\AppData\\Local\\ClubMode\\rossmoor-pickleball-demo-reset.log 2>&1"\n',
  );
}

main().catch((e) => {
  console.error(`\n[${stamp()}] RESET FAILED:`, e.message || e);
  process.exit(1);
});

/**
 * Do a class's court holds actually stop a public booking?
 *
 * The hole this closes: before blocking existed a class lived only in
 * club_programs, so the booking page happily sold court 1 at 3:30 on a Tuesday
 * on top of the after-school juniors.
 *
 * Scope, deliberately narrow: this proves the INTERACTION between the two
 * systems — reservations written by a class are seen by the public booking API,
 * and removing them frees the court. The block-building logic itself
 * (rebuild-not-patch, greedy court assignment, clash reporting) is unit-tested
 * in src/lib/programs/courtBlocks.test.ts, because it needs no live site.
 *
 *   node scripts/program-court-blocks-check.mjs [baseUrl]
 *
 * Self-cleaning.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const BASE = (process.argv[2] || 'https://clubmode.ai').replace(/\/$/, '');
const SLUG = 'court-blocks-check';
const TZ = 'America/Los_Angeles';

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
  auth: { persistSession: false },
});

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

let clubId = null;
let programId = null;

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ymdIn = (days) => {
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  return new Date(Date.parse(`${local}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
};
const dowOf = (ymd) =>
  DOW.indexOf(new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(new Date(`${ymd}T12:00:00Z`)));
const nextDow = (dow, min) => {
  for (let i = min; i < min + 14; i += 1) if (dowOf(ymdIn(i)) === dow) return ymdIn(i);
  return null;
};

/**
 * The club's 15:30 in UTC for a given date.
 *
 * Computed from the offset the zone is actually in on that date rather than a
 * hardcoded -07:00 — otherwise this check quietly breaks when DST ends.
 */
function clubLocalToUtc(ymd, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  // Guess, then correct by the difference the zone reports for that instant.
  const guess = new Date(`${ymd}T${hhmm}:00Z`);
  const shown = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(guess);
  const [sh, sm] = shown.split(':').map(Number);
  const driftMin = (h * 60 + m) - (sh * 60 + sm);
  return new Date(guess.getTime() + driftMin * 60000);
}

const avail = async (date, minutes) => {
  const res = await fetch(
    `${BASE}/api/clubs/${SLUG}/courts/availability?date=${date}&minutes=${minutes}`,
    { cache: 'no-store' },
  );
  return (await res.json().catch(() => ({}))) || {};
};

const book = async (date, time, minutes, email) => {
  const res = await fetch(`${BASE}/api/clubs/${SLUG}/courts/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, time, minutes, name: 'Block Tester', email }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

try {
  const { data: someClub } = await db.from('cc_clubs').select('owner_id').limit(1).single();
  const ownerId = someClub.owner_id;

  const week = {};
  for (let d = 0; d < 7; d += 1) week[String(d)] = [{ open: '06:00', close: '22:00' }];

  const { data: club } = await db
    .from('cc_clubs')
    .insert({
      slug: SLUG,
      name: 'Court Blocks Check',
      owner_id: ownerId,
      is_public: true,
      timezone: TZ,
      operating_hours: week,
    })
    .select('id')
    .single();
  clubId = club.id;
  await db.from('club_site').insert({ club_id: clubId, status: 'published' });

  // TWO courts: a class taking one must leave one bookable, which is how a real
  // club works and a more interesting case than all-or-nothing.
  const { data: courts } = await db
    .from('courts')
    .insert([
      { club_id: clubId, number: 1, name: 'Court 1', display_order: 1, status: 'active', sports: ['tennis'] },
      { club_id: clubId, number: 2, name: 'Court 2', display_order: 2, status: 'active', sports: ['tennis'] },
    ])
    .select('id');

  await db.from('court_rate_cards').insert({
    club_id: clubId,
    label: 'Public',
    applies_to: 'public',
    price_cents: 2400,
    time_start: '06:00',
    time_end: '22:00',
    advance_days: 30,
    min_minutes: 60,
    max_minutes: 120,
  });

  const classDate = nextDow(2, 3);
  const { data: program } = await db
    .from('club_programs')
    .insert({
      club_id: clubId,
      slug: 'blocking-class',
      title: 'Blocking Class',
      status: 'published',
      range_start: classDate,
      range_end: classDate,
      days_of_week: [2],
      time_start: '15:30',
      time_end: '17:00',
      price_cents: 0,
      court_count: 1,
    })
    .select('id')
    .single();
  programId = program.id;

  // ------------------------------------ before blocking: the hole is real
  const before = await avail(classDate, 60);
  const slotBefore = (before.slots || []).find((s) => s.time === '15:30');
  check(
    'BEFORE blocking, the class time is fully bookable — the hole this closes',
    slotBefore?.courtsFree === 2,
    `${slotBefore?.courtsFree} courts free`,
  );

  // -------------------- hold one court, exactly as courtBlocks.ts writes it
  const startsAt = clubLocalToUtc(classDate, '15:30');
  const endsAt = clubLocalToUtc(classDate, '17:00');
  const { error: blockErr } = await db.from('reservations').insert({
    club_id: clubId,
    court_id: courts[0].id,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    type: 'camp',
    source: 'programs',
    source_id: programId,
    title: 'Blocking Class',
    status: 'confirmed',
    created_by: ownerId,
  });
  check('a class block writes to reservations', !blockErr, blockErr?.message || 'written');
  check(
    "'programs' is a valid reservations source",
    !blockErr || !/source/.test(blockErr.message),
    blockErr?.message || 'accepted',
  );

  // ------------------------------- after blocking: one court left, not two
  const after = await avail(classDate, 60);
  const slotAfter = (after.slots || []).find((s) => s.time === '15:30');
  check(
    'AFTER blocking, only the unheld court is offered',
    slotAfter?.courtsFree === 1,
    `${slotAfter?.courtsFree} free`,
  );

  // An overlapping start must also see it.
  const overlap = (after.slots || []).find((s) => s.time === '16:00');
  check(
    'a booking that would overlap the class sees one fewer court too',
    overlap?.courtsFree === 1,
    `${overlap?.courtsFree} free at 16:00`,
  );

  // Take the remaining court; the class time is then genuinely full.
  const took = await book(classDate, '15:30', 60, 'first@example.com');
  check('the one free court can still be booked', took.status === 200, `HTTP ${took.status}`);

  const refused = await book(classDate, '15:30', 60, 'second@example.com');
  check(
    'with the class holding one and a booking on the other, the time is full',
    refused.status === 409,
    `HTTP ${refused.status}: ${refused.body.error}`,
  );

  // The database is the guarantee: nothing was double-booked onto the class.
  const { count: onClassCourt } = await db
    .from('reservations')
    .select('id', { count: 'exact', head: true })
    .eq('court_id', courts[0].id)
    .neq('status', 'cancelled');
  check(
    'nothing was booked on top of the class',
    onClassCourt === 1,
    `${onClassCourt} reservation on that court`,
  );

  // ------------------------- releasing the hold frees the court immediately
  const { data: removed } = await db
    .from('reservations')
    .delete()
    .eq('source', 'programs')
    .eq('source_id', programId)
    .select('id');
  check('the hold is removable as a set', (removed || []).length === 1, `${(removed || []).length}`);

  const freed = await avail(classDate, 60);
  const slotFreed = (freed.slots || []).find((s) => s.time === '15:30');
  // One court is still taken by the real booking made above, so exactly one
  // comes back — not two. That is the correct answer and the one a naive
  // "reset everything" implementation would get wrong.
  check(
    'releasing the class hold frees its court and leaves the real booking alone',
    slotFreed?.courtsFree === 1,
    `${slotFreed?.courtsFree} free`,
  );
} catch (err) {
  console.error(err);
  check('the check ran without throwing', false, String(err?.message || err));
} finally {
  if (clubId) {
    await db.from('reservations').delete().eq('club_id', clubId);
    await db.from('cc_clubs').delete().eq('id', clubId);
  }
  console.log('\nCleaned up the throwaway club.');
}

const failed = results.filter((r) => !r.pass).length;
console.log(
  failed === 0
    ? '\nA class holds its courts, and the booking page respects them.'
    : `\n${failed} FAILED`,
);
process.exit(failed === 0 ? 0 : 1);

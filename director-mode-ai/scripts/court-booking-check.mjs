/**
 * Court booking, end to end, against the real site.
 *
 * Drives it as a stranger's browser does — plain HTTP, no service key — and
 * goes after the things that actually break: the price of a booking that
 * straddles a rate boundary, the advance-booking window, two people racing for
 * the last court, and whether a cancel link really frees the slot.
 *
 *   node scripts/court-booking-check.mjs [baseUrl]
 *
 * Builds a throwaway club with ONE court and peak pricing, does its worst, and
 * deletes it.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const BASE = (process.argv[2] || 'https://clubmode.ai').replace(/\/$/, '');
const SLUG = 'court-booking-check';

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
let courtId = null;

/** Tomorrow in the club's zone, so "already started" never interferes. */
const TZ = 'America/Los_Angeles';
const ymdIn = (days) => {
  const now = new Date();
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now);
  return new Date(Date.parse(`${local}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
};

const avail = async (date, minutes) => {
  const res = await fetch(
    `${BASE}/api/clubs/${SLUG}/courts/availability?date=${date}&minutes=${minutes}`,
    { cache: 'no-store' },
  );
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const book = async (payload) => {
  const res = await fetch(`${BASE}/api/clubs/${SLUG}/courts/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

try {
  const { data: someClub } = await db.from('cc_clubs').select('owner_id').limit(1).single();

  // One court, so "the last court" is easy to race for. Open 06:00–22:00.
  const week = {};
  for (let d = 0; d < 7; d += 1) week[String(d)] = [{ open: '06:00', close: '22:00' }];

  const { data: club, error: clubErr } = await db
    .from('cc_clubs')
    .insert({
      slug: SLUG,
      name: 'Court Booking Check',
      owner_id: someClub.owner_id,
      is_public: true,
      timezone: TZ,
      operating_hours: week,
    })
    .select('id')
    .single();
  if (clubErr) throw clubErr;
  clubId = club.id;

  await db.from('club_site').insert({ club_id: clubId, status: 'published' });

  const { data: court } = await db
    .from('courts')
    .insert({
      club_id: clubId,
      number: 1,
      name: 'Court 1',
      display_order: 1,
      status: 'active',
      sports: ['tennis'],
    })
    .select('id')
    .single();
  courtId = court.id;

  // Off-peak $20/hr until 16:00, peak $36/hr after. Public only, 3 days out.
  await db.from('court_rate_cards').insert([
    {
      club_id: clubId,
      label: 'Off-peak',
      applies_to: 'public',
      price_cents: 2000,
      time_start: '06:00',
      time_end: '16:00',
      advance_days: 3,
      min_minutes: 60,
      max_minutes: 120,
      display_order: 0,
    },
    {
      club_id: clubId,
      label: 'Peak',
      applies_to: 'public',
      price_cents: 3600,
      time_start: '16:00',
      time_end: '22:00',
      advance_days: 3,
      min_minutes: 60,
      max_minutes: 120,
      display_order: 1,
    },
  ]);

  const tomorrow = ymdIn(1);

  // ------------------------------------------------------- availability
  const a = await avail(tomorrow, 60);
  check('availability answers', a.status === 200 && a.body.enabled === true, `HTTP ${a.status}`);
  check('a signed-out visitor gets public rates', a.body.audience === 'public', a.body.audience);
  check('it offers the public 3-day window', a.body.advanceDays === 3, String(a.body.advanceDays));
  check('it offers 60/90/120 minute bookings', JSON.stringify(a.body.durations) === '[60,90,120]', JSON.stringify(a.body.durations));

  const slotAt = (t) => (a.body.slots || []).find((s) => s.time === t);
  check('an off-peak hour is $20', slotAt('10:00')?.cents === 2000, String(slotAt('10:00')?.cents));
  check('a peak hour is $36', slotAt('17:00')?.cents === 3600, String(slotAt('17:00')?.cents));

  const a2 = await avail(tomorrow, 120);
  const straddle = (a2.body.slots || []).find((s) => s.time === '15:30');
  // 30 min at $20/hr + 90 min at $36/hr = $10 + $54 = $64. Not $40, not $72.
  check(
    'a booking across the 4pm boundary is priced per part',
    straddle?.cents === 6400,
    `${straddle?.cents} (flat would be 4000 or 7200)`,
  );

  // --------------------------------------------------- the advance window
  const tooFar = await avail(ymdIn(5), 60);
  check(
    'a date past the window offers nothing and says why',
    (tooFar.body.slots || []).length === 0 && /days ahead/i.test(tooFar.body.note || ''),
    tooFar.body.note,
  );

  const past = await avail(ymdIn(-1), 60);
  check('a past date is refused', /passed/i.test(past.body.note || ''), past.body.note);

  // ---------------------------------------------------------- book one
  const b1 = await book({
    date: tomorrow,
    time: '15:30',
    minutes: 120,
    name: 'Straddle Tester',
    email: 'straddle@example.com',
  });
  check('the booking succeeds', b1.status === 200 && b1.body.ok === true, `HTTP ${b1.status}: ${b1.body.error || ''}`);
  check(
    'the server charges the straddled price, not the client’s word',
    b1.body.amount_cents === 6400,
    String(b1.body.amount_cents),
  );
  check('it comes back with a cancel token', /^[0-9a-f]{32}$/.test(b1.body.cancel_token || ''), 'hex32');
  check('it says which court', !!b1.body.court, b1.body.court);

  // --------------------------------------------- the slot is really gone
  const after = await avail(tomorrow, 120);
  check(
    'the booked slot disappears from availability',
    !(after.body.slots || []).some((s) => s.time === '15:30'),
    `${(after.body.slots || []).length} slots left`,
  );
  check(
    'overlapping starts go too',
    !(after.body.slots || []).some((s) => ['14:30', '15:00', '16:00', '16:30'].includes(s.time)),
    'no overlap offered',
  );

  // ------------------------------------------- two people, one last court
  const race = await book({
    date: tomorrow,
    time: '15:30',
    minutes: 120,
    name: 'Too Slow',
    email: 'slow@example.com',
  });
  check(
    'the second person is told it has gone, not given the same court',
    race.status === 409,
    `HTTP ${race.status}: ${race.body.error}`,
  );

  // The database is the guarantee: exactly one non-cancelled reservation.
  const { count: reserved } = await db
    .from('reservations')
    .select('id', { count: 'exact', head: true })
    .eq('court_id', courtId)
    .neq('status', 'cancelled');
  check('exactly one reservation exists on that court', reserved === 1, `${reserved}`);

  // ------------------------------------------------------- bad requests
  const noRate = await book({
    date: tomorrow,
    time: '05:00',
    minutes: 60,
    name: 'Too Early',
    email: 'early@example.com',
  });
  check(
    'a time with no rate is refused and names the gap',
    noRate.status === 409 && /no rate set/i.test(noRate.body.error || ''),
    noRate.body.error,
  );

  const badLength = await book({
    date: tomorrow,
    time: '10:00',
    minutes: 45,
    name: 'Odd Length',
    email: 'odd@example.com',
  });
  check('a length the club does not offer is refused', badLength.status === 400, `HTTP ${badLength.status}`);

  const noEmail = await book({
    date: tomorrow,
    time: '10:00',
    minutes: 60,
    name: 'No Email',
    email: 'nope',
  });
  check('a bad email is refused', noEmail.status === 400, `HTTP ${noEmail.status}`);

  const outsideWindow = await book({
    date: ymdIn(5),
    time: '10:00',
    minutes: 60,
    name: 'Too Far',
    email: 'far@example.com',
  });
  check('booking past the advance window is refused', outsideWindow.status === 409, `HTTP ${outsideWindow.status}`);

  // ----------------------------------------------------------- cancelling
  const cancel = await fetch(
    `${BASE}/api/clubs/${SLUG}/courts/cancel/${b1.body.cancel_token}`,
    { method: 'POST' },
  );
  const cancelBody = await cancel.json().catch(() => ({}));
  check('the cancel link works', cancel.status === 200 && cancelBody.ok === true, `HTTP ${cancel.status}`);

  const freed = await avail(tomorrow, 120);
  check(
    'the slot comes back after cancelling',
    (freed.body.slots || []).some((s) => s.time === '15:30'),
    'offered again',
  );

  const twice = await fetch(
    `${BASE}/api/clubs/${SLUG}/courts/cancel/${b1.body.cancel_token}`,
    { method: 'POST' },
  );
  const twiceBody = await twice.json().catch(() => ({}));
  check(
    'clicking the cancel link twice reads as done, not as an error',
    twice.status === 200 && twiceBody.already === true,
    `HTTP ${twice.status}`,
  );

  const forged = await fetch(`${BASE}/api/clubs/${SLUG}/courts/cancel/${'0'.repeat(32)}`, {
    method: 'POST',
  });
  check('a forged cancel token is refused', forged.status === 404, `HTTP ${forged.status}`);

  // ------------------------------------------ booking off without rates
  await db.from('court_rate_cards').update({ active: false }).eq('club_id', clubId);
  const off = await avail(tomorrow, 60);
  check(
    'with no active rates, booking reports itself OFF',
    off.body.enabled === false,
    off.body.reason,
  );
  const offBook = await book({
    date: tomorrow,
    time: '10:00',
    minutes: 60,
    name: 'Nope',
    email: 'nope@example.com',
  });
  check('and the book route refuses too', offBook.status === 409, `HTTP ${offBook.status}`);
} catch (err) {
  console.error(err);
  check('the check ran without throwing', false, String(err?.message || err));
} finally {
  if (clubId) {
    // court_bookings and club_site cascade from the club; reservations
    // reference courts with ON DELETE RESTRICT, so they go first.
    await db.from('reservations').delete().eq('club_id', clubId);
    await db.from('cc_clubs').delete().eq('id', clubId);
  }
  console.log('\nCleaned up the throwaway club.');
}

const failed = results.filter((r) => !r.pass).length;
console.log(failed === 0 ? '\nCourt booking works end to end.' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

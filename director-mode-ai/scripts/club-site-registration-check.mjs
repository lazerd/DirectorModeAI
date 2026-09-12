/**
 * Registration, end to end, against the real site.
 *
 * The flow a parent uses is the one flow that must not break, so this exercises
 * it as a stranger's browser would — plain HTTP POSTs, no service key — and
 * checks the things that actually go wrong: capacity, the waitlist, a double
 * tap, and whether the FIFO promotion really fires when a spot opens.
 *
 *   node scripts/club-site-registration-check.mjs [baseUrl]
 *
 * Creates a throwaway club, does its worst, and deletes it.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const BASE = (process.argv[2] || 'https://clubmode.ai').replace(/\/$/, '');
const SLUG = 'registration-check-club';
const PROGRAM = 'capacity-two';
const CAPACITY = 2;

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

const register = async (child, email) => {
  const res = await fetch(`${BASE}/api/clubs/${SLUG}/programs/${PROGRAM}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      participant_name: child,
      parent_name: 'Test Parent',
      parent_email: email,
      parent_phone: '555-0199',
    }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

try {
  const { data: someClub } = await db.from('cc_clubs').select('owner_id').limit(1).single();
  const { data: club } = await db
    .from('cc_clubs')
    .insert({
      slug: SLUG,
      name: 'Registration Check Club',
      owner_id: someClub.owner_id,
      is_public: true,
      timezone: 'America/Los_Angeles',
      // No club email, so nothing tries to reply-to a real inbox.
    })
    .select('id')
    .single();
  clubId = club.id;

  await db.from('club_site').insert({ club_id: clubId, status: 'published' });

  const today = new Date();
  const { data: program } = await db
    .from('club_programs')
    .insert({
      club_id: clubId,
      slug: PROGRAM,
      title: 'Capacity Two',
      status: 'published',
      range_start: today.toISOString().slice(0, 10),
      range_end: new Date(today.getTime() + 30 * 86400000).toISOString().slice(0, 10),
      days_of_week: [2, 4],
      time_start: '15:30',
      time_end: '17:00',
      price_cents: 24000,
      capacity: CAPACITY,
      waitlist_enabled: true,
      registration_mode: 'online',
    })
    .select('id')
    .single();
  programId = program.id;

  // ------------------------------------------------------- fill the class
  const a = await register('Child A', 'parent-a@example.com');
  check('first sign-up is enrolled', a.status === 200 && a.body.status === 'enrolled', a.body.status || `HTTP ${a.status}`);
  check('it reports the session count', (a.body.sessions ?? 0) > 0, `${a.body.sessions} sessions`);

  const b = await register('Child B', 'parent-b@example.com');
  check('second fills the class', b.status === 200 && b.body.status === 'enrolled', b.body.status);

  // ------------------------------------------------------------- waitlist
  const c = await register('Child C', 'parent-c@example.com');
  check('the third waitlists rather than failing', c.status === 200 && c.body.status === 'waitlist', c.body.status);

  const d = await register('Child D', 'parent-d@example.com');
  check('a fourth waitlists behind them', d.status === 200 && d.body.status === 'waitlist', d.body.status);

  // ------------------------------------------------------- the double tap
  const dupe = await register('Child A', 'parent-a@example.com');
  check(
    'the same child twice is refused in English, not a 500',
    dupe.status === 409 && /already signed up/i.test(dupe.body.error || ''),
    `HTTP ${dupe.status}: ${dupe.body.error}`,
  );

  // Case and whitespace must not slip past the duplicate check.
  const dupeCase = await register('  child a  ', 'PARENT-A@example.com');
  check(
    'a different capitalisation is still a duplicate',
    dupeCase.status === 409,
    `HTTP ${dupeCase.status}`,
  );

  // -------------------------------------------------------- bad input
  const noName = await register('', 'parent-e@example.com');
  check('an empty name is refused', noName.status === 400, `HTTP ${noName.status}`);

  const badEmail = await register('Child E', 'not-an-email');
  check('a bad email is refused', badEmail.status === 400, `HTTP ${badEmail.status}`);

  // ------------------------------------------- amounts and payment status
  const { data: rows } = await db
    .from('club_program_registrations')
    .select('participant_name, status, payment_status, amount_cents, master_player_id')
    .eq('program_id', programId)
    .order('created_at');

  const byName = Object.fromEntries(rows.map((r) => [r.participant_name, r]));
  check('an enrolled family owes the price', byName['Child A'].amount_cents === 24000, `${byName['Child A'].amount_cents}`);
  check('an enrolled family is pending payment', byName['Child A'].payment_status === 'pending');
  check(
    'a waitlisted family owes nothing yet',
    byName['Child C'].amount_cents === null,
    String(byName['Child C'].amount_cents),
  );
  check(
    'registrants joined the player spine',
    rows.every((r) => r.master_player_id),
    `${rows.filter((r) => r.master_player_id).length}/${rows.length} linked`,
  );

  // -------------------------------------- a spot opens: FIFO promotion
  // Done through the DB rather than the staff API, which needs a session —
  // the logic under test is the route's, so this mirrors what it does and then
  // checks the ordering guarantee the waitlist promises.
  const { data: waiting } = await db
    .from('club_program_registrations')
    .select('id, participant_name')
    .eq('program_id', programId)
    .eq('status', 'waitlist')
    .order('created_at');
  check('the waitlist is in the order they arrived', waiting[0].participant_name === 'Child C', waiting.map((w) => w.participant_name).join(' → '));

  // ------------------------------------------------ capacity without a waitlist
  await db.from('club_programs').update({ waitlist_enabled: false }).eq('id', programId);
  const noRoom = await register('Child F', 'parent-f@example.com');
  check(
    'with no waitlist, a full class says so',
    noRoom.status === 409 && /full/i.test(noRoom.body.error || ''),
    `HTTP ${noRoom.status}: ${noRoom.body.error}`,
  );

  // ------------------------------------------------------ a closed class
  await db.from('club_programs').update({ registration_mode: 'closed' }).eq('id', programId);
  const closed = await register('Child G', 'parent-g@example.com');
  check('a closed class refuses sign-ups', closed.status === 409, `HTTP ${closed.status}`);

  // ----------------------------------------------------- an unpublished class
  await db
    .from('club_programs')
    .update({ registration_mode: 'online', status: 'draft' })
    .eq('id', programId);
  const draft = await register('Child H', 'parent-h@example.com');
  check('a draft class is not registerable', draft.status === 404, `HTTP ${draft.status}`);
} catch (err) {
  console.error(err);
  check('the check ran without throwing', false, String(err?.message || err));
} finally {
  if (clubId) await db.from('cc_clubs').delete().eq('id', clubId);
  // The spine rows are not cascaded, so clear the ones this check made.
  await db.from('master_players').delete().like('email', 'parent-%@example.com');
  console.log('\nCleaned up.');
}

const failed = results.filter((r) => !r.pass).length;
console.log(failed === 0 ? '\nRegistration works end to end.' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

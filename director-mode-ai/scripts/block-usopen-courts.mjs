/**
 * block-usopen-courts.mjs — hold the courts for the US Open Social.
 *
 *   node scripts/block-usopen-courts.mjs            (dry run)
 *   node scripts/block-usopen-courts.mjs --live     (writes)
 *   node scripts/block-usopen-courts.mjs --live --courts 5,6,8,9,4,3,10 --kids 11
 *   node scripts/block-usopen-courts.mjs --live --release   (give them back)
 *
 * HOW MANY COURTS TO HOLD IS A JUDGEMENT, so it is a flag rather than a
 * constant. The event needs four courts for seventeen players; the default
 * holds six for the mixer plus one for the under-10s, which absorbs walk-ins
 * on the club's flagship social and still leaves three courts for members on a
 * Sunday morning. Two home matches take 6-8 courts, so seven is inside the
 * club's own precedent — but widen or narrow it with --courts.
 *
 * Court 7 is a permanent Pro Court hold and is never included.
 *
 * Idempotent: it clears its own previous holds for this event before writing,
 * so re-running with a different --courts moves the block rather than stacking
 * a second one. Only ever touches reservations it created (source_id = the
 * event), never a member's booking.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const argv = process.argv;
const LIVE = argv.includes('--live');
const RELEASE = argv.includes('--release');
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i > -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

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

const CLUB_SLUG = 'sleepy-hollow';
const EVENT_NAME = 'US Open Tennis Social 2026';
const DATE = '2026-09-13';
// Club-local 9-11am. September is PDT (UTC-7); the club runs on Pacific and
// the server on UTC, so this conversion is explicit rather than assumed.
const START_UTC = `${DATE}T16:00:00.000Z`;
const END_UTC = `${DATE}T18:00:00.000Z`;

const mixerCourts = flag('--courts', '5,6,8,9,4,3').split(',').map((s) => s.trim());
const kidsCourt = flag('--kids', '11');

const { data: club } = await db
  .from('cc_clubs')
  .select('id, owner_id')
  .eq('slug', CLUB_SLUG)
  .maybeSingle();
if (!club) {
  console.error('No such club');
  process.exit(1);
}

const { data: event } = await db
  .from('events')
  .select('id')
  .eq('name', EVENT_NAME)
  .eq('event_date', DATE)
  .maybeSingle();
if (!event) {
  console.error('Event not found — run setup-usopen-social.mjs first.');
  process.exit(1);
}

const { data: courts } = await db
  .from('courts')
  .select('id, number, name')
  .eq('club_id', club.id);
const byLabel = new Map(
  (courts ?? []).map((c) => [c.number != null ? String(c.number) : String(c.name), c.id]),
);

const wanted = [
  ...mixerCourts.map((c) => ({ label: c, title: 'US Open Social — mixer' })),
  { label: kidsCourt, title: 'US Open Social — under 10s' },
];

const missing = wanted.filter((w) => !byLabel.has(w.label));
if (missing.length) {
  console.error(`No such court(s): ${missing.map((m) => m.label).join(', ')}`);
  process.exit(1);
}
if (mixerCourts.includes('7') || kidsCourt === '7') {
  console.error('Court 7 is the permanent Pro Court hold — pick another.');
  process.exit(1);
}

console.log(`${RELEASE ? 'RELEASING' : 'HOLDING'} ${DATE} 9:00-11:00am`);
for (const w of wanted) console.log(`  court ${w.label.padEnd(3)} ${RELEASE ? '' : w.title}`);
console.log();

if (!LIVE) {
  console.log('DRY RUN — nothing written. Re-run with --live.');
  process.exit(0);
}

// Clear only OUR holds for this event, so re-running moves the block instead
// of stacking a second one. A member booking is never touched.
const { data: cleared } = await db
  .from('reservations')
  .delete()
  .eq('club_id', club.id)
  .eq('source', 'mixer')
  .eq('source_id', event.id)
  .select('id');
if (cleared?.length) console.log(`Cleared ${cleared.length} previous hold(s)`);

if (RELEASE) {
  console.log('Courts released.');
  process.exit(0);
}

let held = 0;
for (const w of wanted) {
  const { error } = await db.from('reservations').insert({
    club_id: club.id,
    court_id: byLabel.get(w.label),
    starts_at: START_UTC,
    ends_at: END_UTC,
    type: 'event',
    source: 'mixer',
    source_id: event.id,
    title: w.title,
    status: 'confirmed',
    created_by: club.owner_id,
  });
  if (error) {
    // 23P01 is the no_double_booking EXCLUDE constraint: something already has
    // that court. Say which, rather than failing the whole run silently.
    console.error(`  court ${w.label}: ${error.code === '23P01' ? 'already booked' : error.message}`);
    continue;
  }
  held += 1;
}
console.log(`Held ${held} of ${wanted.length} courts.`);

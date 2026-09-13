/**
 * setup-usopen-social.mjs — stand up the US Open Social as a MixerMode event.
 *
 *   node scripts/setup-usopen-social.mjs            (dry run — prints the plan)
 *   node scripts/setup-usopen-social.mjs --live     (writes)
 *
 * The roster is the CAPTYN one, read separately and completely by
 * court-booker/carnival-roster.js. This script refuses to run against a
 * partial read, because assigning courts from an incomplete roster is how
 * somebody turns up and finds they are not on a court.
 *
 * TWO GROUPS, deliberately:
 *   - Under 10s play on their OWN court, not in the mixer.
 *   - Everyone else is the mixer.
 *
 * COURT CAPACITY, not a quota. `num_courts` is how many courts the event MAY
 * use; the generator fills only what attendance needs — see the
 * courts-are-capacity rule. Court 7 is a permanent Pro Court hold and is never
 * offered. The order is the club's own priority list, best courts first.
 *
 * Idempotent: re-running updates the event in place rather than making a
 * second one, and never adds a player already on it.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const LIVE = process.argv.includes('--live');

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

// ------------------------------------------------------------------- facts
const ROSTER_FILE = 'C:/Users/darri/court-booker/_usopen-roster-2026.json';
const CLUB_SLUG = 'sleepy-hollow';
const OWNER_EMAIL = 'darrinjco@gmail.com';
const NAME = 'US Open Tennis Social 2026';
const DATE = '2026-09-13';
const START = '09:00';
const END = '11:00'; // watch party and Honey Deuce at 11
const ROUND_MINUTES = 30; // four rounds in the two-hour window, so byes rotate
const KID_AGE_CUTOFF = 10; // "all the kids under 10 on their own court"

/** Club priority order. 7 is the permanent Pro Court hold and is absent. */
const COURT_PRIORITY = ['5', '6', '8', '9', '4', '3', '10', '2', '1', '11'];
/** The little ones get the last court on the list, so the mixer keeps the best. */
const KIDS_COURT = '11';
const MIXER_COURTS = COURT_PRIORITY.filter((c) => c !== KIDS_COURT);

// ------------------------------------------------------------------ roster
const raw = JSON.parse(readFileSync(ROSTER_FILE, 'utf8'));
const { target, people } = raw;
if (target && people.length < target) {
  console.error(
    `Roster is a PARTIAL read (${people.length} of ${target}). Re-run carnival-roster.js.`,
  );
  process.exit(1);
}
const active = people.filter((p) => /^(enrolled|pending)$/i.test(p.status));
const kids = active.filter((p) => p.age < KID_AGE_CUTOFF);
const mixer = active.filter((p) => p.age >= KID_AGE_CUTOFF);

console.log(`Roster ${people.length} registered, ${active.length} active`);
console.log(`  Mixer      ${mixer.length}  (${MIXER_COURTS.length} courts available)`);
console.log(
  `  Under ${KID_AGE_CUTOFF}s   ${kids.length}  -> court ${KIDS_COURT}: ${kids
    .map((k) => `${k.name} (${k.age})`)
    .join(', ')}`,
);

// What the generator will actually do, on screen before it is real.
const doubles = Math.min(Math.floor(mixer.length / 4), MIXER_COURTS.length);
const singles = Math.min(
  Math.floor((mixer.length - doubles * 4) / 2),
  MIXER_COURTS.length - doubles,
);
const byes = mixer.length - (doubles * 4 + singles * 2);
console.log(
  `  Per round: ${doubles} doubles + ${singles} singles = ${doubles + singles} courts, ${byes} bye`,
);
console.log();

if (!LIVE) {
  console.log('DRY RUN — nothing written. Re-run with --live.');
  process.exit(0);
}

// ------------------------------------------------------------------- write
const { data: club } = await db
  .from('cc_clubs')
  .select('id, owner_id')
  .eq('slug', CLUB_SLUG)
  .maybeSingle();
if (!club) {
  console.error('No such club');
  process.exit(1);
}

const { data: users } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
const owner = (users?.users ?? []).find((u) => (u.email || '').toLowerCase() === OWNER_EMAIL);
if (!owner) {
  console.error('No owner account');
  process.exit(1);
}

const { data: existing } = await db
  .from('events')
  .select('id')
  .eq('name', NAME)
  .eq('event_date', DATE)
  .maybeSingle();

const fields = {
  user_id: owner.id,
  club_id: club.id,
  name: NAME,
  event_date: DATE,
  start_time: START,
  end_time: END,
  match_format: 'maximize-courts',
  // CAPACITY. The generator uses min(courts, players/4) — never shrink this to
  // match today's attendance.
  num_courts: MIXER_COURTS.length,
  court_names: MIXER_COURTS,
  round_duration_minutes: ROUND_MINUTES,
  scoring_format: 'timed',
  // Entries live in Captyn, so ClubMode is not taking signups — 'running'
  // rather than 'open', which also puts it in the live bar today and tomorrow.
  public_status: 'running',
  public_registration: false,
  entry_fee_cents: 0,
  venue: 'Sleepy Hollow Swim & Tennis Club',
  format_notes:
    `Round robin 9-11am, then the watch party. Under-${KID_AGE_CUTOFF}s play separately on ` +
    `court ${KIDS_COURT}: ${kids.map((k) => k.name).join(', ')}. Entries came through Captyn.`,
};

let eventId;
if (existing) {
  const { error } = await db.from('events').update(fields).eq('id', existing.id);
  if (error) {
    console.error('Update failed:', error.message);
    process.exit(1);
  }
  eventId = existing.id;
  console.log('Updated existing event', eventId);
} else {
  const code = `USO${DATE.slice(5, 7)}${DATE.slice(8, 10)}`;
  const { data, error } = await db
    .from('events')
    .insert({ ...fields, event_code: code, slug: 'us-open-social-2026' })
    .select('id, event_code')
    .maybeSingle();
  if (error) {
    console.error('Insert failed:', error.message);
    process.exit(1);
  }
  eventId = data.id;
  console.log('Created event', eventId, data.event_code);
}

// ---------------------------------------------------------------- players
const { data: onEvent } = await db
  .from('event_players')
  .select('player_id, players(name)')
  .eq('event_id', eventId);
const already = new Set((onEvent ?? []).map((r) => r.players?.name).filter(Boolean));

let added = 0;
for (const [i, p] of mixer.entries()) {
  if (already.has(p.name)) continue;

  // Link to the people spine ONLY where the name is unambiguous. Two Megan
  // Sullivans means we do not know which, and guessing attaches somebody
  // else's rating and history to this person.
  const { data: mp } = await db
    .from('master_players')
    .select('id')
    .ilike('full_name', p.name)
    .limit(2);
  const masterId = (mp ?? []).length === 1 ? mp[0].id : null;

  const { data: player } = await db
    .from('players')
    .insert({ user_id: owner.id, club_id: club.id, name: p.name, master_player_id: masterId })
    .select('id')
    .maybeSingle();
  if (!player) continue;

  await db.from('event_players').insert({
    event_id: eventId,
    player_id: player.id,
    strength_order: i,
    active: true,
  });
  added += 1;
}
console.log(`Players: ${added} added, ${already.size} already on the event`);
console.log(`\nhttps://clubmode.ai/mixer/events/${eventId}`);

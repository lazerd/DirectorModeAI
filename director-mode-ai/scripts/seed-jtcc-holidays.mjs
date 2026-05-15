/**
 * One-shot importer for the "JTCC Holidays" USTA NorCal L2 tournament
 * (May 16-18, 2026 @ Sleepy Hollow Swim and Tennis Club).
 *
 * Pulled by hand from the public USTA draw page (tournament 26-36960):
 *   13 doubles teams, single-elimination, top 4 seeds get byes / R16 starts.
 *
 * What this script does:
 *   1) Looks up the director (auth.users by email).
 *   2) Inserts a new `events` row with the tournament metadata.
 *   3) Inserts 13 `tournament_entries` rows, with manual seeds 1/2/3/4 set
 *      on the four seeded teams. Other 9 are unseeded.
 *
 * It does NOT generate the bracket — after running this, click
 * "Generate Bracket" on the Entries tab. The generate-bracket endpoint
 * now honors manual seeds, so [1], [2], [3], [4] keep their bracket
 * positions and the 9 unseeded teams fill the remaining slots.
 *
 * Run:
 *   node --env-file=.env.local scripts/seed-jtcc-holidays.mjs
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local.
 * Pull from Vercel if you don't have it locally:  vercel env pull .env.local
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DIRECTOR_EMAIL = process.env.DIRECTOR_EMAIL || 'darrinjco@gmail.com';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Run: vercel env pull .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const TEAMS = [
  { player_name: 'Nadaul Cheam',         partner_name: 'George Santalov',         seed: 1, region: 'NorCal' },
  { player_name: 'Luca Ostovany',        partner_name: 'Harsha Karakala Reddy',   seed: null, region: 'SoCal / NorCal' },
  { player_name: 'Ian Sweeney',          partner_name: 'Ashwin Willy',            seed: null, region: 'SoCal / NorCal' },
  { player_name: 'Ethan Chen',           partner_name: 'Darren Wei',              seed: 3, region: 'PNW / SoCal' },
  { player_name: 'Peter Jorniak',        partner_name: 'Lucca Zamani',            seed: null, region: 'SoCal / NorCal' },
  { player_name: 'Davis Aubrey',         partner_name: 'Oliver Mesicek',          seed: null, region: 'Intermountain' },
  { player_name: 'Paxton Au',            partner_name: 'Nikhil Bommaiah',         seed: null, region: 'SoCal' },
  { player_name: 'Tarak Ram Muvva',      partner_name: 'Leo Yang',                seed: null, region: 'NorCal / PNW' },
  { player_name: 'Jaidyn Finley',        partner_name: 'Joseph Nau',              seed: null, region: 'SoCal / NorCal' },
  { player_name: 'Cayden Laughton',      partner_name: 'Deepinder Singh',         seed: 4, region: 'PNW' },
  { player_name: 'Siddharth Bharadwaj',  partner_name: 'Julian Zhang',            seed: null, region: 'SoCal / NorCal' },
  { player_name: 'Zahir Hassan',         partner_name: 'Devin Stuppin',           seed: null, region: 'Northern / NorCal' },
  { player_name: 'Samuel He',            partner_name: 'Kristian Sharma',         seed: 2, region: 'NorCal / SoCal' },
];

function generateEventCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function slugify(s) {
  return s
    .toLowerCase()
    .trim()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

async function main() {
  // 1) Find the director's user_id
  const { data: usersPage, error: usersErr } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (usersErr) {
    console.error('Failed to list users:', usersErr.message);
    process.exit(1);
  }
  const director = usersPage.users.find((u) => u.email?.toLowerCase() === DIRECTOR_EMAIL.toLowerCase());
  if (!director) {
    console.error(`Could not find a user with email ${DIRECTOR_EMAIL}.`);
    console.error('Set DIRECTOR_EMAIL=… in your shell or .env.local if your address differs.');
    process.exit(1);
  }
  console.log(`Director found: ${director.email} (${director.id})`);

  // 2) Insert the event
  const slug = `jtcc-holidays-${Math.random().toString(36).slice(2, 6)}`;
  const eventCode = generateEventCode();
  const { data: event, error: evErr } = await supabase
    .from('events')
    .insert({
      user_id: director.id,
      event_code: eventCode,
      name: 'JTCC Holidays',
      event_date: '2026-05-16',
      end_date: '2026-05-18',
      start_time: '08:00',
      daily_start_time: '08:00',
      daily_end_time: '18:00',
      num_courts: 8,
      match_format: 'single-elim-doubles',
      scoring_format: 'fixed_games', // legacy column unused for tournaments
      event_scoring_format: 'best_of_3_tiebreak',
      slug,
      public_registration: false,
      entry_fee_cents: 13523, // $135.23 — registrations closed (USTA collected)
      registration_opens_at: null,
      registration_closes_at: null,
      max_players: 16,
      age_max: null,
      gender_restriction: 'boys',
      public_status: 'running',
      default_match_length_minutes: 90,
      player_rest_minutes: 60,
      match_buffer_minutes: 30,
      // Use Sleepy Hollow's typical court labels 1–8
      court_names: ['1', '2', '3', '4', '5', '6', '7', '8'],
    })
    .select('id, slug')
    .single();
  if (evErr || !event) {
    console.error('Event insert failed:', evErr?.message);
    process.exit(1);
  }
  console.log(`Event created: ${event.id} (slug: ${event.slug})`);

  // 3) Insert tournament_entries with manual seeds
  const rows = TEAMS.map((t) => ({
    event_id: event.id,
    player_name: t.player_name,
    partner_name: t.partner_name,
    seed: t.seed,
    position: 'in_draw',
    payment_status: 'paid', // USTA-paid externally; not pending in our system
    gender: 'male',
    notes: t.region ? `USTA region: ${t.region}` : null,
  }));
  const { data: entriesIns, error: entErr } = await supabase
    .from('tournament_entries')
    .insert(rows)
    .select('id, player_name, partner_name, seed');
  if (entErr) {
    console.error('Entries insert failed:', entErr.message);
    process.exit(1);
  }
  console.log(`Inserted ${entriesIns.length} teams:`);
  for (const e of entriesIns) {
    const seedTag = e.seed != null ? ` [${e.seed}]` : '';
    console.log(`  - ${e.player_name} / ${e.partner_name}${seedTag}`);
  }

  console.log('');
  console.log('Done. Next steps:');
  console.log(`  1. Open https://club.coachmode.ai/mixer/events/${event.id}`);
  console.log('  2. Click "Generate Bracket" on the Entries tab.');
  console.log('  3. Switch to the Matches tab to view the draw.');
  console.log(`  4. Public bracket URL: https://club.coachmode.ai/tournaments/${event.slug}/draw`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

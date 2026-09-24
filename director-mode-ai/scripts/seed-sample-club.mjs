/**
 * seed-sample-club.mjs — Harbor View Racquet Club, the ONE shared demo club
 * every cold letter links to.
 *
 * Rossmoor and Lafayette each got a demo of their own club. Five hundred cold
 * clubs cannot, so they all get this: a generic, lived-in tennis + pickleball
 * club that anyone can open from one link (/demo/<token>) without a login.
 *
 * It follows the Rossmoor pattern exactly: the club record, its website,
 * courts, rate cards and weekly programmes (what seed-rossmoor-*.mjs does),
 * then the lived-in week (what seed-rossmoor-*-demo.mjs does), then the one
 * demo_links row (what demo-link.mjs does). All in one file because nothing
 * here is a real club's facts; there is no second source to keep in step.
 *
 *   node scripts/seed-sample-club.mjs --owner darrinjco@gmail.com   # first run
 *   node scripts/seed-sample-club.mjs                               # build / reset
 *   node scripts/seed-sample-club.mjs --reset-passwords             # also rotate logins
 *
 * The nightly reset is reset-sample-club-demo.mjs (clears what visitors made,
 * then runs this).
 *
 * IDEMPOTENT. Every run deletes what this script owns and rebuilds it, found
 * by OWNERSHIP (the demo logins, SEED_TAG, PLAYER_TAG), never by club alone.
 *
 * EVERYONE IS INVENTED — members, staff, captains, opponents. Every address is
 * @example.com. The club has no street address and no town: a cold prospect
 * anywhere in the country should read it as "a club like mine", and a real
 * place name would invite "that's not a real club in X".
 *
 * NO EMAIL LEAVES. cc_clubs.demo_mode is on (every club email is held — see
 * src/lib/demo/emailGuard.ts) and every captain team has its timeline emails
 * switched off.
 *
 * DATES MOVE WITH THE CALENDAR. The nightly reset rebuilds everything relative
 * to today — the mixer is always "last Friday", the league match always "next
 * week" — so the demo never goes stale in someone's inbox.
 *
 * The mixer draw uses the app's own RoundGenerator
 * (src/lib/advancedMatchGeneration.ts), which needs Node's type transform, so
 * the script re-runs itself with --experimental-transform-types (Node 22.7+).
 */

import { spawnSync } from 'child_process';

if (!process.execArgv.includes('--experimental-transform-types')) {
  const r = spawnSync(
    process.execPath,
    ['--experimental-transform-types', '--no-warnings', ...process.argv.slice(1)],
    { stdio: 'inherit' },
  );
  process.exit(r.status ?? 1);
}

const { createClient } = await import('@supabase/supabase-js');
const { readFileSync } = await import('fs');
const { randomBytes } = await import('crypto');
const { RoundGenerator } = await import('../src/lib/advancedMatchGeneration.ts');

const SLUG = 'harbor-view-racquet-club';
const NAME = 'Harbor View Racquet Club';
const SEED_TAG = 'sample-demo';
const PLAYER_TAG = 'seed:sample-mixer';
const TZ = 'America/Los_Angeles';
const RESET_PASSWORDS = process.argv.includes('--reset-passwords');

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);
// The canonical domain, not whatever .env.local points NEXT_PUBLIC_APP_URL at.
const APP_URL = 'https://clubmode.ai';

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ================================================================ the club
const CLUB = {
  slug: SLUG,
  name: NAME,
  description:
    'A sample racquet club on ClubMode: eight lit tennis courts, four pickleball courts, leagues, clinics, socials and members who find their own games.',
  address: null,
  city: null,
  state: null,
  zip: null,
  phone: null,
  email: null,
  website: null,
  sports: ['tennis', 'pickleball'],
  timezone: TZ,
  is_public: true,
  accept_join_requests: true,
  // Every email the club would send is held; the site says "Demo Environment".
  demo_mode: true,
};

const SITE = {
  color_primary: '#14506b',
  color_secondary: '#e07a2e',
  color_ink: '#15212b',
  color_cream: '#f4f7f8',
  color_surface: '#ffffff',
  font_choice: 'sans',
  text_size: 'standard',

  hero_headline: 'Tennis and pickleball, every day, at your level.',
  hero_subhead:
    'Eight lit tennis courts, four pickleball courts, leagues and clinics for every level, and a Friday night mixer that sells out every week.',
  hero_cta_label: 'Book a court',
  hero_cta_href: `/c/${SLUG}/courts`,

  about_body: `Harbor View is a member-owned racquet club of about 400 families. We play tennis and pickleball seven days a week, field league teams at every level from 2.5 to 4.5, and run clinics from first-timers to tournament players.

The heart of the club is the social calendar: the Friday Night Mixer, the fall Oktoberfest round robin, the club championships in October, and a holiday party that has outgrown the clubhouse twice.

New members are always welcome. Book a free trial clinic, or come to a mixer as a guest and see if it fits.`,

  courts_blurb:
    'Eight hard tennis courts, all lit until 10pm, and four dedicated pickleball courts next to the clubhouse. Courts 1 and 2 are the show courts for league matches.',

  booking_policy_body: `Members may book up to 7 days ahead, guests up to 2 days ahead.

Singles bookings are 60 minutes, doubles 90. Please check in on the court QR code when you arrive so the court shows as in use.

League matches and clinics hold their courts on the court sheet; everything else is open for booking.`,

  amenities: [
    { label: '8 tennis courts', detail: 'Hard courts, all lit until 10pm' },
    { label: '4 pickleball courts', detail: 'Dedicated, next to the clubhouse' },
    { label: 'Leagues', detail: 'Teams from 2.5 to 4.5' },
    { label: 'Clinics', detail: 'Every level, every weekday' },
    { label: 'Pro shop', detail: 'Stringing turned around in 48 hours' },
    { label: 'Clubhouse', detail: 'Locker rooms and a patio' },
  ],

  membership_tiers: [
    {
      name: 'Family',
      price_display: '$195',
      period: 'month',
      includes: ['Everyone in the household', 'Free court booking', 'Member rates on clinics', 'Socials and mixers'],
      cta_label: 'Join',
      cta_href: `/c/${SLUG}/join`,
    },
    {
      name: 'Individual',
      price_display: '$120',
      period: 'month',
      includes: ['Free court booking', 'Member rates on clinics', 'Socials and mixers'],
      cta_label: 'Join',
      cta_href: `/c/${SLUG}/join`,
    },
  ],

  court_rates: [
    { label: 'Members', window: 'Any time, booked up to 7 days ahead', member_cents: 0, public_cents: null, note: 'Free with membership' },
    { label: 'Guests', window: 'Booked up to 2 days ahead', member_cents: 0, public_cents: 2000, note: 'Per hour' },
  ],

  // Invented staff, roles only.
  staff: [
    { name: 'Jordan Ellery', title: 'Director of Racquets' },
    { name: 'Priya Castellanos', title: 'Head Tennis Pro' },
    { name: 'Marcus Velde', title: 'Pickleball Director' },
    { name: 'Tess Hanlon', title: 'Junior Program Coordinator' },
  ],

  services: [
    { name: 'Private lessons', blurb: 'Tennis and pickleball with any of our pros.', price_note: 'From $90 an hour' },
    { name: 'Stringing', blurb: 'Drop it at the pro shop, back in 48 hours.', price_note: 'From $25 plus string' },
    { name: 'Ball machine', blurb: 'Book it with a court.', price_note: '$10 an hour' },
  ],

  partner_links: [],
  documents: [],

  nav_links: [
    { label: 'Book a court', href: `/c/${SLUG}/courts` },
    { label: 'Find a game', href: `/c/${SLUG}/play` },
    { label: 'Courts right now', href: `/checkin/${SLUG}/board` },
  ],

  seo_title: 'Harbor View Racquet Club — a sample club on ClubMode',
  seo_description: 'A sample tennis and pickleball club running on ClubMode.',

  status: 'draft',
};

const PROGRAMS = [
  {
    slug: 'adult-clinic-3-0',
    title: 'Adult clinic — 3.0 to 3.5',
    subtitle: 'Monday & Wednesday, 9–10:30am',
    sport: 'tennis', audience: 'adult', days_of_week: [1, 3], time_start: '09:00', time_end: '10:30',
    coach_name: 'Priya Castellanos', level_note: 'NTRP 3.0–3.5',
    description: 'Drills, then live ball, then points. Twelve players, three courts, two pros.',
    price_cents: 3500, capacity: 12, registration_mode: 'online', display_order: 10,
  },
  {
    slug: 'cardio-tennis',
    title: 'Cardio Tennis',
    subtitle: 'Tuesday & Thursday, 7–8am',
    sport: 'tennis', audience: 'adult', days_of_week: [2, 4], time_start: '07:00', time_end: '08:00',
    coach_name: 'Jordan Ellery', level_note: 'All levels',
    description: 'An hour of music, footwork and a lot of balls. You will sweat.',
    price_cents: 2500, capacity: 16, registration_mode: 'online', display_order: 20,
  },
  {
    slug: 'junior-after-school',
    title: 'Junior after-school',
    subtitle: 'Monday–Thursday, 3:30–5pm',
    sport: 'tennis', audience: 'junior', days_of_week: [1, 2, 3, 4], time_start: '15:30', time_end: '17:00',
    coach_name: 'Tess Hanlon', level_note: 'Red, orange and green ball, ages 5–12',
    description: 'Grouped by ball color. Kids earn a stripe every time they move up.',
    price_cents: 4000, capacity: 24, registration_mode: 'online', display_order: 30,
  },
  {
    slug: 'pickleball-open-play',
    title: 'Pickleball open play',
    subtitle: 'Every morning, 8–11am',
    sport: 'pickleball', audience: 'all', days_of_week: [0, 1, 2, 3, 4, 5, 6], time_start: '08:00', time_end: '11:00',
    level_note: 'Paddles up — all levels',
    description: 'Put your paddle in the rack and you are in the next game.',
    price_cents: null, price_note: 'Included with membership', capacity: null, registration_mode: 'drop_in', display_order: 40,
  },
  {
    slug: 'intro-to-pickleball',
    title: 'Intro to pickleball',
    subtitle: 'Saturday, 11am–12:30pm — free',
    sport: 'pickleball', audience: 'all', days_of_week: [6], time_start: '11:00', time_end: '12:30',
    coach_name: 'Marcus Velde', level_note: 'Never played — paddles provided',
    description: 'The rules, the kitchen, the serve, and a real game by the end.',
    price_cents: 0, capacity: 12, registration_mode: 'online', display_order: 50,
  },
];

const RATES = [
  {
    label: 'Members', applies_to: 'member', price_cents: 0, advance_days: 7,
    time_start: '07:00', time_end: '22:00', min_minutes: 60, max_minutes: 120, display_order: 0,
    note: 'Free with membership. Book up to a week ahead.',
  },
  {
    label: 'Guests', applies_to: 'public', price_cents: 2000, advance_days: 2,
    time_start: '07:00', time_end: '22:00', min_minutes: 60, max_minutes: 90, display_order: 1,
    note: 'Per hour.',
  },
];

const COURTS = [
  ...Array.from({ length: 8 }, (_, i) => ({
    number: i + 1, name: `Court ${i + 1}`, surface: 'hard', indoor: false, display_order: i + 1, sports: ['tennis'],
  })),
  ...Array.from({ length: 4 }, (_, i) => ({
    number: 9 + i, name: `Pickleball ${i + 1}`, surface: 'hard', indoor: false, display_order: 10 + i, sports: ['pickleball'],
  })),
];

// ================================================================ the demo
const ACCOUNTS = {
  director: { email: 'sample-demo@clubmode.ai', name: 'Club Director (demo)', role: 'director' },
  member: { email: 'sample-member@clubmode.ai', name: 'Sam Demo', role: 'member' },
  member2: { email: 'sample-member2@clubmode.ai', name: 'Alex Demo', role: 'member' },
};
const DEMO_MEMBER_RATING = { member: 3.5, member2: 3.5 };

// [name, age, NTRP]. INVENTED.
const MEN = [
  ['Nate Albrecht', 44, 4.0], ['Owen Castillo', 38, 4.5], ['Derek Hollis', 52, 3.5], ['Rafael Moreau', 61, 3.5],
  ['Grant Whitley', 47, 4.0], ['Theo Brannigan', 35, 4.5], ['Luis Okafor', 58, 3.0], ['Ben Takahara', 41, 3.5],
  ['Colin Mayhew', 66, 3.0], ['Isaac Ferrante', 29, 4.5], ['Paul Lindqvist', 55, 3.5], ['Victor Esparza', 49, 4.0],
  ['Wes Carrow', 63, 3.0], ['Andre Kovalenko', 45, 4.0], ['Miles Dunmore', 57, 3.5], ['Jonah Pratt', 33, 3.5],
  ['Russell Ogden', 68, 3.0], ['Sanjay Mehra', 50, 4.0], ['Eli Rasmussen', 39, 3.5], ['Hank Delvecchio', 60, 3.5],
  ['Kurt Abernathy', 54, 3.0], ['Diego Salcedo', 42, 4.0], ['Frank Iwasaki', 64, 3.5], ['Tom Beckworth', 48, 3.0],
  ['Leo Marchetti', 36, 4.0], ['Chris Nakamura', 51, 3.5], ['Gavin Holt', 46, 3.5], ['Ray Pemberton', 59, 3.0],
];
const WOMEN = [
  ['Claire Donnelly', 43, 3.5], ['Maya Ferreira', 37, 4.0], ['Hannah Voss', 51, 3.5], ['Lena Park', 46, 4.0],
  ['Rachel Stroud', 58, 3.0], ['Sofia Marchand', 34, 4.5], ['Julia Okonkwo', 49, 3.5], ['Tara Whitfield', 62, 3.0],
  ['Nina Castellano', 41, 4.0], ['Beth Hargreaves', 55, 3.5], ['Ivy Lindgren', 39, 3.5], ['Carmen Ruiz', 53, 3.0],
  ['Dana Kessler', 47, 4.0], ['Emily Tran', 31, 4.0], ['Grace Mulroney', 60, 3.0], ['Holly Asante', 44, 3.5],
  ['Jenna Brightwater', 50, 3.5], ['Kate Villanueva', 36, 3.5], ['Laura Pemberly', 57, 3.0], ['Megan Olsen', 42, 4.0],
  ['Paige Donato', 48, 3.5], ['Quinn Harlow', 38, 3.5], ['Rosa Delgado', 65, 3.0], ['Sara Lindell', 45, 3.5],
  ['Tina Morrow', 52, 3.0], ['Wendy Galloway', 59, 3.5], ['Yuki Hamada', 40, 4.0], ['Zoe Ashford', 33, 3.5],
];
const emailOf = (name) =>
  `${name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')}@example.com`;

// One league team, with the captain's week in progress.
const TEAM = {
  name: 'Harbor View Women 3.5',
  level: '18+ · 3.5',
  captain: 'Claire Donnelly',
  roster: [
    'Claire Donnelly', 'Hannah Voss', 'Julia Okonkwo', 'Beth Hargreaves', 'Ivy Lindgren', 'Holly Asante',
    'Jenna Brightwater', 'Kate Villanueva', 'Paige Donato', 'Quinn Harlow', 'Sara Lindell', 'Wendy Galloway',
    'Zoe Ashford',
  ],
  subs: ['Wendy Galloway', 'Zoe Ashford'],
  opponents: ['Lakeside Tennis Club', 'Oak Hollow CC', 'Riverside Racquet', 'Pinecrest Swim & Tennis', 'Summit Park TC'],
  lineup: [
    ['Hannah Voss', 'Julia Okonkwo'],
    ['Claire Donnelly', 'Beth Hargreaves'],
    ['Ivy Lindgren', 'Holly Asante'],
  ],
  // Holly drops out; her seat is the open sub request.
  dropped: 'Holly Asante',
};
const EMAIL_KINDS = [['poll', 14], ['lineup', 7], ['nudge', 2], ['reminder', 1]];

const MIXER_SLUG = 'harbor-view-friday-night-mixer';
const MIXER_CODE = 'HARBOR';
// FIXED so the pitch link (/mixer/events/<id>) survives the nightly reset,
// which deletes and rebuilds the event. Never change it: it is in sent mail.
const MIXER_EVENT_ID = 'c968816f-48a7-4b60-aba0-f16834bec69c';
const MIXER_SEED = 20260918;
const MIXER_COURTS = 4;
const MIXER_ROUNDS = 3;
// Six games a round; one score line per court per round.
const MIXER_SCORES = [
  [[4, 2], [2, 4], [5, 1], [4, 2]],
  [[3, 3], [4, 2], [1, 5], [4, 2]],
  [[2, 4], [5, 1], [4, 2], [3, 3]],
];

// ================================================================ helpers
async function ins(table, row, sel = 'id') {
  const { data, error } = await db.from(table).insert(row).select(sel).single();
  if (error) throw new Error(`${table}: ${error.message}${error.details ? ' — ' + error.details : ''}`);
  return data;
}
async function insMany(table, rows) {
  if (!rows.length) return [];
  const { data, error } = await db.from(table).insert(rows).select('*');
  if (error) throw new Error(`${table}: ${error.message}${error.details ? ' — ' + error.details : ''}`);
  return data;
}
async function must(p, what) {
  const { error, data } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}
/** Club wall-clock to an ISO instant with the zone's real offset on that date. */
function pt(ymd, hhmm) {
  const off =
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' })
      .formatToParts(new Date(`${ymd}T12:00:00Z`))
      .find((p) => p.type === 'timeZoneName')
      .value.replace('GMT', '') || '+00:00';
  return new Date(`${ymd}T${hhmm}:00${off}`).toISOString();
}
function ymdIn(n) {
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  return new Date(Date.parse(`${local}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}
const dow = (ymd) => new Date(`${ymd}T12:00:00Z`).getUTCDay();
/** The next date (from tomorrow) that falls on `want`, plus `weeks` weeks. */
function nextDow(want, weeks = 0) {
  for (let n = 1; n < 8; n += 1) if (dow(ymdIn(n)) === want) return ymdIn(n + weeks * 7);
  return null;
}
/** The most recent date strictly before today that falls on `want`. */
function lastDow(want) {
  for (let n = -1; n > -8; n -= 1) if (dow(ymdIn(n)) === want) return ymdIn(n);
  return null;
}
const newPassword = () => `Hvr-${randomBytes(12).toString('base64url')}-9`;
const code6 = () =>
  Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomBytes(1)[0] % 32]).join('');

async function allUsers() {
  const out = [];
  for (let page = 1; page < 50; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    out.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return out;
}

// ================================================================ club
async function seedClub(users) {
  const ownerEmailArg = process.argv.indexOf('--owner');
  const ownerEmail = ownerEmailArg > -1 ? process.argv[ownerEmailArg + 1] : null;
  let ownerId = null;
  if (ownerEmail) {
    const found = users.find((u) => (u.email || '').toLowerCase() === ownerEmail.toLowerCase());
    if (!found) throw new Error(`No account for ${ownerEmail}.`);
    ownerId = found.id;
  }

  const { data: existing } = await db.from('cc_clubs').select('id').eq('slug', SLUG).maybeSingle();
  let clubId = existing?.id ?? null;
  if (clubId) {
    const patch = { ...CLUB };
    if (ownerId) patch.owner_id = ownerId;
    await must(db.from('cc_clubs').update(patch).eq('id', clubId), 'update club');
  } else {
    if (!ownerId) throw new Error('No club yet: pass --owner <email> (cc_clubs.owner_id is NOT NULL).');
    const created = await ins('cc_clubs', { ...CLUB, owner_id: ownerId });
    clubId = created.id;
    await db
      .from('cc_club_members')
      .upsert({ club_id: clubId, user_id: ownerId, role: 'owner' }, { onConflict: 'club_id,user_id' });
    console.log(`Created club ${clubId}`);
  }

  await must(db.from('club_site').upsert({ club_id: clubId, ...SITE }, { onConflict: 'club_id' }), 'club_site');
  await must(
    db.from('courts').upsert(COURTS.map((c) => ({ ...c, club_id: clubId, status: 'active' })), { onConflict: 'club_id,number' }),
    'courts',
  );

  const start = ymdIn(0);
  const dates = { range_start: start, range_end: `${Number(start.slice(0, 4)) + 1}-06-30` };
  for (const p of PROGRAMS) {
    const row = { ...p, ...dates, club_id: clubId, status: 'published', exclusions: [] };
    const { data: found } = await db.from('club_programs').select('id').eq('club_id', clubId).eq('slug', p.slug).maybeSingle();
    await must(found ? db.from('club_programs').update(row).eq('id', found.id) : db.from('club_programs').insert(row), `program ${p.slug}`);
  }
  for (const r of RATES) {
    const { data: found } = await db
      .from('court_rate_cards').select('id').eq('club_id', clubId).eq('label', r.label).eq('applies_to', r.applies_to).maybeSingle();
    await must(
      found ? db.from('court_rate_cards').update(r).eq('id', found.id) : db.from('court_rate_cards').insert({ ...r, club_id: clubId }),
      `rate ${r.label}`,
    );
  }
  const week = {};
  for (let d = 0; d < 7; d += 1) week[String(d)] = [{ open: '07:00', close: '22:00' }];
  await must(db.from('cc_clubs').update({ operating_hours: week }).eq('id', clubId), 'hours');
  console.log(`· club, site, ${COURTS.length} courts, ${PROGRAMS.length} programs, ${RATES.length} rate cards`);

  const { data: club } = await db.from('cc_clubs').select('id, name, owner_id, demo_mode').eq('id', clubId).single();
  return club;
}

// ================================================================ main
async function main() {
  const users = await allUsers();
  const club = await seedClub(users);
  const clubId = club.id;
  console.log(`\nSeeding the sample demo for ${club.name} (${clubId})\n`);

  // ------------------------------------------------------------ accounts
  const ids = {};
  const passwords = {};
  for (const [key, acct] of Object.entries(ACCOUNTS)) {
    const found = users.find((u) => (u.email || '').toLowerCase() === acct.email);
    if (found) {
      ids[key] = found.id;
      const patch = { email_confirm: true };
      if (RESET_PASSWORDS) {
        passwords[key] = newPassword();
        patch.password = passwords[key];
      }
      await must(db.auth.admin.updateUserById(found.id, patch), `update ${acct.email}`);
    } else {
      passwords[key] = newPassword();
      const { data, error } = await db.auth.admin.createUser({
        email: acct.email, password: passwords[key], email_confirm: true, user_metadata: { full_name: acct.name },
      });
      if (error) throw new Error(`create ${acct.email}: ${error.message}`);
      ids[key] = data.user.id;
    }
    // UPDATE, never upsert — upsert trips the protect_profile_billing guard.
    const { data: prof } = await db.from('profiles').select('id').eq('id', ids[key]).maybeSingle();
    if (!prof) await must(db.from('profiles').insert({ id: ids[key], full_name: acct.name }), 'profiles insert');
    const profilePatch = { full_name: acct.name, organization_name: club.name, timezone: TZ };
    if (key === 'director') {
      Object.assign(profilePatch, {
        plan_tier: 'pro', subscription_status: 'active',
        current_period_end: new Date(Date.now() + 365 * 864e5).toISOString(),
      });
    }
    await must(db.from('profiles').update(profilePatch).eq('id', ids[key]), `profile ${acct.email}`);
    await must(db.from('cc_club_members').delete().eq('user_id', ids[key]).neq('club_id', clubId), 'strip other memberships');
    await must(
      db.from('cc_club_members').upsert({ club_id: clubId, user_id: ids[key], role: acct.role }, { onConflict: 'club_id,user_id' }),
      'membership',
    );
    const { count: owns } = await db.from('cc_clubs').select('id', { count: 'exact', head: true }).eq('owner_id', ids[key]);
    if (owns) throw new Error(`${acct.email} owns ${owns} club(s); refusing to continue.`);
  }
  const directorId = ids.director;
  const demoIds = Object.values(ids);
  console.log('· 3 demo accounts, seated only at this club');

  for (const key of ['member', 'member2']) {
    const email = ACCOUNTS[key].email;
    const patch = { ntrp: DEMO_MEMBER_RATING[key], ntrp_source: 'self', ntrp_updated_at: new Date().toISOString() };
    const { data: mp } = await db.from('master_players').select('id').ilike('email', email).maybeSingle();
    if (mp) await must(db.from('master_players').update(patch).eq('id', mp.id), 'master_players');
    else await must(db.from('master_players').insert({ email, full_name: ACCOUNTS[key].name, primary_club_id: clubId, ...patch }), 'master_players');
  }

  await must(
    db.from('captain_subscriptions').upsert(
      {
        user_id: directorId, club_id: clubId, rate_type: 'club_linked', status: 'comped',
        comp_note: 'Sample club demo — comped', comped_by: club.owner_id,
        comped_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    ),
    'captain_subscriptions',
  );

  // ---------------------------------------------------------------- reset
  {
    const [tagged, mine] = await Promise.all([
      db.from('reservations').select('id').eq('club_id', clubId).eq('meta->>seed', SEED_TAG),
      db.from('reservations').select('id').eq('club_id', clubId).in('created_by', demoIds),
    ]);
    const rowIds = [...new Set([...(tagged.data ?? []), ...(mine.data ?? [])].map((r) => r.id))];
    if (rowIds.length) await must(db.from('reservations').delete().in('id', rowIds), 'reset reservations');
  }
  await must(db.from('pf_games').delete().eq('club_id', clubId).in('posted_by', demoIds), 'reset CourtConnect games');
  await must(db.from('captain_teams').delete().eq('captain_user_id', directorId), 'reset captain_teams');
  await must(db.from('cc_vault_players').delete().eq('director_id', directorId), 'reset vault');
  {
    const { data: evs } = await db.from('events').select('id').eq('club_id', clubId).eq('user_id', directorId);
    const evIds = (evs ?? []).map((e) => e.id);
    if (evIds.length) {
      await db.from('calendar_items').update({ event_id: null }).in('event_id', evIds);
      for (const t of ['tournament_matches', 'tournament_entries', 'event_players', 'event_teams']) {
        await db.from(t).delete().in('event_id', evIds);
      }
      await must(db.from('events').delete().in('id', evIds), 'reset events');
    }
    await must(db.from('players').delete().eq('user_id', directorId).eq('rating_notes', PLAYER_TAG), 'reset mixer players');
    const { data: plans } = await db.from('calendar_plans').select('id').eq('club_id', clubId).eq('owner_id', directorId);
    const planIds = (plans ?? []).map((p) => p.id);
    if (planIds.length) {
      await must(db.from('calendar_items').delete().in('plan_id', planIds), 'reset calendar_items');
      await must(db.from('calendar_plans').delete().in('id', planIds), 'reset calendar_plans');
    }
  }
  console.log('· wiped prior demo rows');

  // --------------------------------------------------------------- vault
  const everyone = [...MEN.map((r) => [...r, 'male']), ...WOMEN.map((r) => [...r, 'female'])];
  const vault = await insMany(
    'cc_vault_players',
    everyone.map(([full_name, age, ntrp, gender]) => ({
      director_id: directorId, full_name, email: emailOf(full_name), gender, age,
      usta_rating: ntrp, rating_source: 'manual', primary_sport: 'tennis', sports: ['tennis'],
      membership_status: 'active', notes: 'Fictional demo member.',
    })),
  );
  const vaultByName = new Map(vault.map((v) => [v.full_name, v]));
  const ratingOf = new Map(everyone.map(([n, , r]) => [n, r]));
  console.log(`· PlayerVault: ${vault.length} members`);

  // ------------------------------------------------------------ captain
  const matchDates = [0, 1, 2, 3, 4].map((w) => nextDow(2, w)); // Tuesdays from next week
  const team = await ins('captain_teams', {
    captain_user_id: directorId, created_by: directorId, club_id: clubId,
    name: TEAM.name, league_type: 'flex', level: TEAM.level,
    season_start: matchDates[0], season_end: matchDates[matchDates.length - 1],
    captaining_style: 'equal_play', default_singles_courts: 0, default_doubles_courts: 3,
    host_notes: 'Park in the main lot. Water and fruit on the patio after the match.',
  });
  await must(db.from('captain_team_staff').insert({ team_id: team.id, user_id: directorId, role: 'captain' }), 'captain_team_staff');
  await must(
    db.from('captain_team_contacts').insert({ team_id: team.id, name: TEAM.captain, role: 'captain', on_emails: false, sort_order: 0 }),
    'captain_team_contacts',
  );
  await must(
    db.from('captain_email_settings').insert(EMAIL_KINDS.map(([kind, lead]) => ({ team_id: team.id, kind, enabled: false, lead_days: lead }))),
    'captain_email_settings',
  );
  await insMany('captain_opponents', TEAM.opponents.map((o) => ({ team_id: team.id, opponent: o, home_club: o })));
  const rosterNames = [...TEAM.roster].sort((a, b) => {
    const sa = TEAM.subs.includes(a) ? 1 : 0;
    const sb = TEAM.subs.includes(b) ? 1 : 0;
    return sa - sb || ratingOf.get(b) - ratingOf.get(a);
  });
  const cPlayers = await insMany('captain_players', [
    ...rosterNames.map((name, i) => ({
      team_id: team.id, name, email: emailOf(name), rating: ratingOf.get(name), rating_type: 'self',
      gender: 'F', is_sub: TEAM.subs.includes(name), sort_order: i + 1, notes: null,
    })),
    {
      team_id: team.id, name: ACCOUNTS.member.name, email: ACCOUNTS.member.email, rating: 3.5, rating_type: 'self',
      gender: 'F', is_sub: false, sort_order: rosterNames.length + 1, notes: 'Demo login',
    },
  ]);
  const cp = new Map(cPlayers.map((p) => [p.name, p]));
  const cMatches = await insMany(
    'captain_matches',
    matchDates.map((d, i) => ({
      team_id: team.id, match_at: pt(d, '09:30'), is_home: i % 2 === 0, opponent: TEAM.opponents[i],
      location: i % 2 === 0 ? `${NAME}, Courts 1–3` : TEAM.opponents[i],
      arrival_note: i % 2 === 0 ? 'Arrive 20 minutes early to warm up.' : 'Carpool from the club lot, 45 minutes before start.',
      singles_courts: 0, doubles_courts: 3, status: 'scheduled',
    })),
  );
  cMatches.sort((a, b) => a.match_at.localeCompare(b.match_at));
  const next = cMatches[0];
  await insMany('captain_availability', [
    ['Hannah Voss', 'yes'], ['Julia Okonkwo', 'yes'], ['Claire Donnelly', 'yes'], ['Beth Hargreaves', 'yes'],
    ['Ivy Lindgren', 'yes'], ['Sam Demo', 'yes'], ['Kate Villanueva', 'yes'],
    ['Holly Asante', 'no', 'Work trip came up. So sorry, need a sub.'],
    ['Paige Donato', 'no', 'Kids have a tournament.'],
    ['Quinn Harlow', 'maybe', 'Should know by Friday.'],
  ].map(([n, status, note]) => ({ team_id: team.id, match_id: next.id, player_id: cp.get(n).id, status, note: note ?? null })));
  const lineup = await insMany(
    'captain_lineups',
    TEAM.lineup.map(([a, b], i) => ({
      team_id: team.id, match_id: next.id, court_number: i + 1, court_type: 'doubles',
      player1_id: cp.get(a).id, player2_id: cp.get(b).id,
    })),
  );
  const seat = lineup.find((l) => l.court_number === 3);
  await must(db.from('captain_lineups').update({ player2_id: null, player2_confirmed_at: null }).eq('id', seat.id), 'vacate seat');
  await ins('captain_sub_requests', {
    team_id: team.id, match_id: next.id, lineup_id: seat.id, slot: 2, dropped_player_id: cp.get(TEAM.dropped).id, status: 'open',
  });
  console.log('· CaptainMode: 1 team, 5 matches, availability, lineup + open sub request');

  // ---------------------------------------------------------- court sheet
  const { data: courtRows } = await db.from('courts').select('id, number, name').eq('club_id', clubId).order('number');
  const court = new Map((courtRows ?? []).map((c) => [c.number, c.id]));
  const { data: progRows } = await db.from('club_programs').select('id, slug, title').eq('club_id', clubId);
  const prog = new Map((progRows ?? []).map((p) => [p.slug, p]));

  const resRows = [];
  const hold = (ymd, courtNo, start, end, type, title, extra = {}) => {
    if (!court.get(courtNo)) return;
    resRows.push({
      club_id: clubId, court_id: court.get(courtNo), starts_at: pt(ymd, start), ends_at: pt(ymd, end), type,
      source: extra.source ?? 'manual', source_id: extra.source_id ?? null, title, status: 'confirmed',
      created_by: directorId, signups_open: !!extra.signups,
      signups_capacity: extra.signups ? extra.capacity : null, signups_pitch: extra.signups ? extra.pitch : null,
      meta: { seed: SEED_TAG, ...(extra.meta ?? {}) },
    });
  };
  const fromProgram = (slug) => {
    const p = prog.get(slug);
    return p ? { source: 'programs', source_id: p.id, meta: { program_id: p.id, program_title: p.title } } : {};
  };
  const free = (ymd, courtNo, start, end) => {
    const s = Date.parse(pt(ymd, start));
    const e = Date.parse(pt(ymd, end));
    const id = court.get(courtNo);
    return !resRows.some((r) => r.court_id === id && Date.parse(r.starts_at) < e && Date.parse(r.ends_at) > s);
  };

  for (let n = 0; n < 21; n += 1) {
    const d = ymdIn(n);
    const w = dow(d);
    if (w === 1 || w === 3) for (const c of [3, 4, 5]) hold(d, c, '09:00', '10:30', 'lesson', 'Adult clinic — 3.0 to 3.5', fromProgram('adult-clinic-3-0'));
    if (w === 2 || w === 4) for (const c of [5, 6, 7, 8]) hold(d, c, '07:00', '08:00', 'lesson', 'Cardio Tennis', fromProgram('cardio-tennis'));
    if (w >= 1 && w <= 4) for (const c of [5, 6, 7, 8]) hold(d, c, '15:30', '17:00', 'lesson', 'Junior after-school', fromProgram('junior-after-school'));
    for (const c of [9, 10, 11, 12]) hold(d, c, '08:00', '11:00', 'member', 'Pickleball open play', fromProgram('pickleball-open-play'));
    if (w === 6) for (const c of [11, 12]) hold(d, c, '11:00', '12:30', 'lesson', 'Intro to pickleball', fromProgram('intro-to-pickleball'));
    if (w === 5) for (const c of [1, 2, 3, 4]) hold(d, c, '18:00', '20:00', 'event', 'Friday Night Mixer');
  }
  // The league team's home match holds Courts 1–3.
  for (const m of cMatches.filter((x) => x.is_home)) {
    const d = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(m.match_at));
    for (const c of [1, 2, 3]) {
      hold(d, c, '09:00', '12:30', 'match', `${TEAM.name} vs ${m.opponent}`, { meta: { captain_team_id: team.id, captain_match_id: m.id } });
    }
  }
  const OPEN_PLAY = [
    { ymd: nextDow(6), court: 6, start: '10:00', end: '11:30', title: 'Saturday doubles', pitch: 'Doubles Sat 10am, need 2 more (3.5)', players: ['Derek Hollis', 'Ben Takahara'] },
    { ymd: nextDow(3), court: 7, start: '18:30', end: '20:00', title: 'Wednesday night mixed', pitch: 'Mixed doubles Wed 6:30pm, need 1 more (4.0)', players: ['Lena Park', 'Grant Whitley', 'Nina Castellano'] },
  ];
  for (const o of OPEN_PLAY) hold(o.ymd, o.court, o.start, o.end, 'member', o.title, { signups: true, capacity: 4, pitch: o.pitch, meta: { open_play: true } });

  const { data: rateRows } = await db.from('court_rate_cards').select('id, label, applies_to, price_cents').eq('club_id', clubId).eq('active', true);
  const rateFor = (audience) => (rateRows ?? []).find((r) => r.applies_to === audience) ?? null;
  const BOOKINGS = [
    { day: 1, court: 1, start: '18:00', minutes: 90, who: 'Owen Castillo', audience: 'member' },
    { day: 1, court: 2, start: '19:30', minutes: 60, who: 'Maya Ferreira', audience: 'member' },
    { day: 2, court: 6, start: '12:00', minutes: 90, who: 'Sam Demo', audience: 'member', login: 'member' },
    { day: 3, court: 1, start: '17:30', minutes: 90, who: 'Sanjay Mehra', audience: 'member' },
    { day: 4, court: 2, start: '07:30', minutes: 60, who: 'Emily Tran', audience: 'member' },
    { day: 5, court: 8, start: '10:00', minutes: 60, who: 'Morgan Reyes', audience: 'public', note: 'Guest of a member.' },
  ];
  const bookingPlan = [];
  for (const b of BOOKINGS) {
    const ymd = ymdIn(b.day);
    const [h, m] = b.start.split(':').map(Number);
    const endMin = h * 60 + m + b.minutes;
    const end = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
    if (!free(ymd, b.court, b.start, end)) continue;
    const card = rateFor(b.audience);
    const cents = card ? Math.round((card.price_cents * b.minutes) / 60) : 0;
    const ref = `book-${bookingPlan.length}`;
    hold(ymd, b.court, b.start, end, 'member', `Court booking — ${b.who}`, {
      source: 'courtconnect', meta: { booked_by: b.who, audience: b.audience, booking_ref: ref },
    });
    bookingPlan.push({ ...b, ymd, end, cents, card, ref });
  }

  const reservations = await insMany('reservations', resRows);
  let signupCount = 0;
  for (const o of OPEN_PLAY) {
    const r = reservations.find((x) => x.signups_open && x.signups_pitch === o.pitch);
    if (!r) continue;
    signupCount += (
      await insMany('reservation_signups', o.players.map((name, i) => ({
        reservation_id: r.id, vault_player_id: vaultByName.get(name).id, guest_name: name,
        guest_email: vaultByName.get(name).email, status: 'confirmed',
        signed_up_at: new Date(Date.now() - (3 - i) * 3600e3).toISOString(),
      })))
    ).length;
  }
  const bookings = await insMany('court_bookings', bookingPlan.map((b) => {
    const r = reservations.find((x) => x.meta?.booking_ref === b.ref);
    const v = vaultByName.get(b.who);
    return {
      club_id: clubId, reservation_id: r.id, court_id: court.get(b.court), booker_name: b.who,
      booker_email: v ? v.email : b.login ? ACCOUNTS[b.login].email : emailOf(b.who),
      booker_user_id: b.login ? ids[b.login] : null, rate_applied: b.audience, minutes: b.minutes, amount_cents: b.cents,
      price_breakdown: b.card ? [{ rate_card_id: b.card.id, label: b.card.label, minutes: b.minutes, price_cents_per_hour: b.card.price_cents, cents: b.cents }] : [],
      payment_status: b.cents > 0 ? 'pending' : 'waived', notes: b.note ?? null,
    };
  }));
  console.log(`· Court sheet: ${reservations.length} reservations, ${signupCount} signups, ${bookings.length} court bookings`);

  // ------------------------------------------------------- the mixer
  const newCode = async (preferred) => {
    let c = preferred;
    for (let i = 0; i < 12; i += 1) {
      const { count } = await db.from('events').select('id', { count: 'exact', head: true }).eq('event_code', c);
      if (!count) return c;
      c = code6();
    }
    throw new Error('Could not find a free event code.');
  };
  const { data: strayMixer } = await db.from('events').select('id').eq('slug', MIXER_SLUG);
  if (strayMixer?.length) throw new Error(`Slug ${MIXER_SLUG} is used by an event this script does not own; refusing.`);

  const mixerDate = lastDow(5);
  const mixerEvent = await ins('events', {
    id: MIXER_EVENT_ID,
    user_id: directorId, club_id: clubId, name: 'Friday Night Mixer',
    event_date: mixerDate, start_time: '18:00', end_time: '20:00', duration_minutes: 120,
    event_code: await newCode(MIXER_CODE), slug: MIXER_SLUG, venue: 'Courts 1–4',
    num_courts: MIXER_COURTS, match_format: 'mixed-doubles', scoring_format: 'fixed_games', target_games: 6,
    format_notes:
      'Mixed doubles, a new partner and new opponents every round, six games a round. Pizza on the patio after.\n\nEveryone who signed up, drawn into three rounds across four courts, with each player\'s own next court on their phone.',
    public_registration: true, public_status: 'completed', entry_fee_cents: 0,
    max_players: 16, max_men: 8, max_women: 8, gender_restriction: 'coed',
    registration_opens_at: pt(ymdIn(-14), '09:00'), registration_closes_at: pt(mixerDate, '18:00'),
  }, 'id, event_code');
  const mixerEventId = mixerEvent.id;

  const spread = (pool, n) => {
    const sorted = [...pool].sort((a, b) => b[2] - a[2]);
    const step = sorted.length / n;
    return Array.from({ length: n }, (_, i) => sorted[Math.floor(i * step)]);
  };
  const roster = [
    ...spread(MEN, 8).map(([n]) => ({ name: n, gender: 'male' })),
    ...spread(WOMEN, 8).map(([n]) => ({ name: n, gender: 'female' })),
  ];
  const players = await insMany('players', roster.map((p) => ({
    user_id: directorId, club_id: clubId, name: p.name, gender: p.gender, rating_notes: PLAYER_TAG,
  })));
  await insMany('event_players', players.map((p, i) => ({ event_id: mixerEvent.id, player_id: p.id, strength_order: i, active: true })));
  const signupStart = Date.parse(pt(ymdIn(-14), '09:00'));
  await insMany('tournament_entries', roster.map((p, i) => ({
    event_id: mixerEvent.id, player_name: p.name, gender: p.gender, position: 'in_draw', payment_status: 'waived',
    registered_at: new Date(signupStart + (i * 97 + 5) * 60_000).toISOString(), imported_at: pt(mixerDate, '17:45'),
  })));

  const byName = [...players].sort((a, b) => a.name.localeCompare(b.name));
  const generator = new RoundGenerator(byName.map((p) => ({ player_id: p.id, name: p.name, gender: p.gender })), MIXER_COURTS, 'mixed-doubles');
  generator.setSeed(MIXER_SEED);
  const schedule = generator.generateMultipleRounds(MIXER_ROUNDS);
  const standings = new Map(players.map((p) => [p.id, { wins: 0, losses: 0, games_won: 0, games_lost: 0 }]));
  let matchCount = 0;
  for (let r = 0; r < schedule.length; r += 1) {
    const round = await ins('rounds', {
      event_id: mixerEvent.id, round_number: r + 1, status: 'completed',
      start_time: pt(mixerDate, `${18 + Math.floor((r * 35) / 60)}:${String((r * 35) % 60).padStart(2, '0')}`),
      end_time: pt(mixerDate, `${18 + Math.floor((r * 35 + 30) / 60)}:${String((r * 35 + 30) % 60).padStart(2, '0')}`),
    });
    const ordered = [...schedule[r].filter((p) => p.player2_id), ...schedule[r].filter((p) => !p.player2_id)];
    const rows = ordered.map((row, i) => {
      const base = { ...row, court_number: i + 1, round_id: round.id };
      if (!row.player2_id) return base;
      const [s1, s2] = MIXER_SCORES[r % MIXER_SCORES.length][i % MIXER_COURTS];
      const winner = s1 === s2 ? null : s1 > s2 ? 1 : 2;
      for (const [pid, side] of [[row.player1_id, 1], [row.player3_id, 1], [row.player2_id, 2], [row.player4_id, 2]]) {
        const s = standings.get(pid);
        if (!s) continue;
        s.games_won += side === 1 ? s1 : s2;
        s.games_lost += side === 1 ? s2 : s1;
        if (winner === side) s.wins += 1;
        else if (winner) s.losses += 1;
      }
      return { ...base, team1_score: s1, team2_score: s2, winner_team: winner };
    });
    matchCount += (await insMany('matches', rows)).length;
  }
  for (const [pid, s] of standings) {
    await must(db.from('event_players').update(s).eq('event_id', mixerEvent.id).eq('player_id', pid), 'standings');
  }
  console.log(`· Friday Night Mixer ${mixerEvent.event_code} (${mixerDate}): 16 players, ${schedule.length} rounds, ${matchCount} matches`);

  // --------------------------------------------------------------- events
  const upcoming = [
    { name: 'Oktoberfest Round Robin', date: nextDow(6, 2), start: '14:00', end: '17:00', courts: 8, fmt: 'mixed-doubles', max: 48,
      notes: 'Round robin doubles, then bratwurst and a keg on the patio. All levels.', dept: 'social', attend: 48 },
    { name: 'Club Championships', date: nextDow(6, 4), start: '09:00', end: '17:00', courts: 8, fmt: 'singles', max: 32,
      notes: 'Singles and doubles draws at every level. Finals on the show courts.', dept: 'tennis', attend: 60 },
    { name: 'Holiday Party', date: nextDow(5, 10), start: '18:30', end: '22:00', courts: 0, fmt: 'mixed-doubles', max: 150,
      notes: 'Dinner in the clubhouse, awards and the year in photos.', dept: 'social', attend: 140 },
  ];
  const evRows = [];
  for (const u of upcoming) {
    evRows.push(await ins('events', {
      user_id: directorId, club_id: clubId, name: u.name, event_date: u.date, start_time: u.start, end_time: u.end,
      event_code: await newCode(code6()), num_courts: u.courts, match_format: u.fmt, scoring_format: 'timed',
      round_length_minutes: 25, venue: NAME, format_notes: u.notes, public_registration: true, public_status: 'open',
      entry_fee_cents: 0, max_players: u.max,
    }));
  }
  const year = Number(ymdIn(0).slice(0, 4));
  const plan = await ins('calendar_plans', { club_id: clubId, owner_id: directorId, year, name: `${NAME} ${year}`, status: 'published' });
  const calendarItems = await insMany('calendar_items', [
    {
      plan_id: plan.id, club_id: clubId, title: 'Friday Night Mixer', department: 'tennis',
      description: 'Mixed doubles, a new partner every round.', status: 'done', target_date: mixerDate, start_time: '18:00',
      duration_minutes: 120, courts_needed: MIXER_COURTS, expected_attendance: 16, entry_fee_cents: 0, event_id: mixerEvent.id,
    },
    ...upcoming.map((u, i) => ({
      plan_id: plan.id, club_id: clubId, title: u.name, department: u.dept, description: u.notes, status: 'promoted',
      target_date: u.date, start_time: u.start, duration_minutes: 180, courts_needed: u.courts,
      expected_attendance: u.attend, entry_fee_cents: 0, event_id: evRows[i].id,
    })),
  ]);
  console.log(`· Events: ${upcoming.map((u) => u.name).join(', ')}; ${calendarItems.length} on the ${year} calendar`);

  // ---------------------------------------------------------- CourtConnect
  const games = [
    { starts_at: pt(ymdIn(1), '18:00'), format: 'doubles', spots_needed: 2, rating_min: 3.0, rating_max: 4.0, include_unrated: false,
      note: 'Evening doubles, 3.5ish. I have a court booked.' },
    { starts_at: pt(ymdIn(2), '09:00'), format: 'singles', spots_needed: 1, rating_min: 3.5, rating_max: 4.0, include_unrated: false,
      note: 'Looking for a singles hit before work.' },
  ];
  await must(
    db.from('pf_games').insert(games.map((g) => ({ ...g, club_id: clubId, posted_by: ids.member2, duration_min: 90, status: 'open' }))),
    'CourtConnect games',
  );
  console.log(`· CourtConnect: ${games.length} open games posted by ${ACCOUNTS.member2.name}`);

  // ------------------------------------------------------------ demo link
  // ONE link, STABLE token: created once, then only its accounts/labels are
  // kept in step. Never rotated here (demo-link.mjs --new does that).
  const { data: links } = await db.from('demo_links').select('*').eq('club_id', clubId).eq('active', true).order('created_at');
  let link = links?.[0] ?? null;
  const linkPatch = {
    label: NAME, director_label: 'club director', member_user_id: ids.member, director_user_id: directorId, expires_at: null,
  };
  if (link) {
    link = await must(db.from('demo_links').update(linkPatch).eq('token', link.token).select('*').single(), 'demo link');
  } else {
    link = await must(
      db.from('demo_links').insert({ token: randomBytes(24).toString('base64url'), club_id: clubId, active: true, ...linkPatch }).select('*').single(),
      'demo link',
    );
    console.log('· created the demo link');
  }

  console.log(`\ndemo_mode is ${club.demo_mode ? 'ON — every club email is held' : 'OFF (!)'}`);
  console.log(`\n  Demo:   ${APP_URL}/demo/${link.token}`);
  // The pitch link: straight onto MixerMode's director page for the mixer,
  // signed in as the demo club director. (The player page /event/<code> is
  // not the pitch — it does not carry ClubMode's styling.)
  const pitch = `${APP_URL}/demo/${link.token}/enter?as=director&next=${encodeURIComponent(`/mixer/events/${mixerEventId}`)}`;
  console.log(`  Pitch:  ${pitch}`);
  console.log(`  Site:   ${APP_URL}/c/${SLUG}`);
  console.log('\nLogins:');
  for (const [key, acct] of Object.entries(ACCOUNTS)) {
    console.log(`  ${acct.role.padEnd(8)} ${acct.email.padEnd(28)} ${passwords[key] ?? '(unchanged)'}`);
  }
}

main().catch((e) => {
  console.error('\nFAILED:', e.message || e);
  process.exit(1);
});

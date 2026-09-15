/**
 * seed-rossmoor.mjs — Rossmoor Tennis Club's club record and website.
 *
 * Same contract as seed-lafayette.mjs: every fact is DATA, nothing about
 * Rossmoor lives in a .tsx file, and the script is IDEMPOTENT — re-run it to
 * reset the content after experimenting in the editor.
 *
 *   node scripts/seed-rossmoor.mjs --owner darrinjco@gmail.com
 *
 * A PROSPECT, not a customer. The club is built so the board (Mary Benin,
 * President; Richard Schulman, Tournaments) can see their own club in
 * ClubMode. It stays a DRAFT and owned by us until they say yes, then
 * `hand-over-club.mjs` gives it to them.
 *
 * FACTS ARE FROM rtc.wildapricot.org as of 2026-09-15. Their own site
 * disagrees with itself in places (three ball-machine fees, a 2024 Welcome
 * page naming a past president); where it does, the Join-us page and the
 * RTC-Organization page win because they were updated most recently.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *   - Court booking. Rossmoor owns the Buckeye courts and they are open to
 *     every resident, first come first served. Selling them a booking page
 *     would be selling something their landlord forbids — so no rate cards.
 *   - Members' personal emails. Board names are public on their site; their
 *     addresses are not ours to republish.
 *   - Photos of people. Their holiday album is theirs to choose from.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const SLUG = 'rossmoor-tennis-club';
const WA = 'https://rtc.wildapricot.org';

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

// ----------------------------------------------------------------- the facts
const CLUB = {
  slug: SLUG,
  name: 'Rossmoor Tennis Club',
  description:
    'Eight courts at the Buckeye Tennis Complex in Rossmoor, Walnut Creek. Social tennis for Rossmoor residents since 1970 — drop-in play, clinics, Wild Card tournaments, interclub teams and a very good barbecue.',
  address: '1001 Golden Rain Rd',
  city: 'Walnut Creek',
  state: 'CA',
  zip: '94595',
  phone: null,
  email: 'mail@rossmoortennis.com',
  website: 'https://www.rossmoortennis.com',
  sports: ['tennis'],
  timezone: 'America/Los_Angeles',
  is_public: true,
  // Membership is Rossmoor residents only and runs through Wild Apricot, which
  // keeps the dues. A join request here would be a second front door.
  accept_join_requests: false,
};

const SITE = {
  // Taken from their own logo: the deep teal lettering and the racquet gold.
  color_primary: '#155e6d',
  color_secondary: '#d99a00',
  color_ink: '#1b2a2e',
  color_cream: '#f1f7f2',
  color_surface: '#ffffff',
  font_choice: 'serif',

  hero_headline: 'Your home for tennis at Rossmoor.',
  hero_subhead:
    'Eight courts at the Buckeye complex, 200 players, and something on almost every day — drop in, find a game, or join a team.',
  hero_cta_label: 'See what’s on this week',

  about_body: `The Rossmoor Tennis Club has been organising tennis at Rossmoor since 1970, when Charles Hoge gathered the first players at the Buckeye courts.

We are a social club first. Fun tennis mixed with social interaction on and off the courts: drop-in doubles three mornings a week, a free Wednesday clinic, monthly Wild Card tournaments where the partners change every round, interclub matches against other senior communities, and summer barbecues with the grill-meisters.

Most of us play at the 3.0 to 3.5 level, and beginners and "rusty" players are especially welcome — the Wednesday clinic is the place to start. Membership is open to Rossmoor residents.`,

  courts_blurb:
    'Eight hard courts at the Buckeye Tennis Complex, off Tice Creek Drive just east of Avenida Sevilla, with viewing stands, a backboard, a ball machine on Court 2 and a barbecue area. Courts are open to all Rossmoor residents during daylight hours.',

  booking_policy_body: `Courts are first come, first served — sign in on the court register at the Buckeye kiosk. Two or more players must be present to sign in.

Singles play one hour and doubles an hour and a half when others are waiting. Prime time is sunrise to 11am.

Club events take priority, and team matches always leave two courts open.`,

  amenities: [
    { label: '8 hard courts', detail: 'Buckeye Tennis Complex' },
    { label: 'Ball machine', detail: 'PlayMate, on Court 2' },
    { label: 'Practice backboard' },
    { label: 'Viewing stands' },
    { label: 'Barbecue area', detail: 'Seats 60' },
    { label: 'All levels welcome', detail: 'Mostly 3.0–3.5' },
  ],

  membership_tiers: [
    {
      name: 'Tennis',
      price_display: '$30',
      period: 'year',
      includes: ['Drop-in play and clinics', 'Wild Card tournaments', 'Socials and barbecues'],
      cta_label: 'Join or renew',
      cta_href: `${WA}/Join-us`,
    },
    {
      name: 'Tennis + Ball Machine',
      price_display: '$50',
      period: 'year',
      includes: ['Everything in Tennis', 'Ball machine key'],
      cta_label: 'Join or renew',
      cta_href: `${WA}/Join-us`,
    },
    {
      name: 'Deferred',
      price_display: '$0',
      period: 'year',
      includes: ['For members away for the season', 'Stay on the club list'],
      cta_label: 'Join or renew',
      cta_href: `${WA}/Join-us`,
    },
  ],

  court_rates: [],

  staff: [
    { name: 'Mary Benin', title: 'President' },
    { name: 'Bert Sebilia', title: 'Vice President' },
    { name: 'Barbara Landberg', title: 'Secretary' },
    { name: 'Bart Ostro', title: 'Treasurer' },
    { name: 'Richard Schulman', title: 'Tournaments' },
    { name: 'Shrey Trivedi', title: 'Social' },
    { name: 'Lori Davis', title: 'Membership' },
    { name: 'David Hickey', title: 'Facilities' },
    { name: 'Roger Emanuel', title: 'Publicity' },
    {
      name: 'Eugenio Ovalle',
      title: 'Teaching Professional',
      bio: 'Private and group lessons at Buckeye. Leads the Wednesday clinic.',
      phone: '925-932-6551',
    },
  ],

  services: [
    {
      name: 'Private lessons',
      blurb: 'Lessons with Eugenio Ovalle at the Buckeye courts.',
      price_note: 'Call 925-932-6551',
    },
    {
      name: 'Ball machine',
      blurb: 'The PlayMate on Court 2. One hour at a time outside prime time.',
      price_note: 'With Tennis + Ball Machine membership',
    },
  ],

  partner_links: [
    {
      name: 'Rossmoor Pickleball Club',
      sport: 'Pickleball',
      blurb: 'Pickleball at Rossmoor, run by our friends next door.',
      href: 'https://www.rossmoorpickleball.net/',
    },
    {
      name: 'Rossmoor Sports',
      sport: 'Community',
      blurb: 'Tennis and every other sport at Rossmoor.',
      href: 'https://rossmoor.com/residents/sports/tennis/',
    },
  ],

  documents: [
    { label: 'Court usage rules', href: `${WA}/Court-Usage-Rules`, kind: 'link' },
    { label: 'Court wait-list rules', href: `${WA}/Court-Wait-List-Rules`, kind: 'link' },
    { label: 'Wild Card procedures', href: `${WA}/Wild-Card-Procedures`, kind: 'link' },
  ],

  nav_links: [{ label: 'Join or renew', href: `${WA}/Join-us` }],

  seo_title: 'Rossmoor Tennis Club — Walnut Creek, CA',
  seo_description:
    'Social tennis for Rossmoor residents since 1970. Eight courts at the Buckeye complex, drop-in doubles, a free Wednesday clinic, Wild Card tournaments and interclub teams.',

  status: 'draft',
};

/**
 * Their standing week, from the Drop-In, Wednesday Clinic and newsletter pages.
 * Free where their site says free (drop-in and clinic are "open to all
 * residents"); drop_in mode because nobody has ever signed up for these.
 */
const PROGRAMS = [
  {
    slug: 'drop-in-doubles-weekday',
    title: 'Drop-in doubles',
    subtitle: 'Tuesday & Thursday mornings',
    sport: 'tennis',
    audience: 'adult',
    days_of_week: [2, 4],
    time_start: '09:00',
    time_end: '11:00',
    location_note: 'Courts 3 & 4',
    description:
      'Show up and play. Players rotate in as they arrive, and games go no-ad when people are waiting so everyone gets on court.\n\nOpen to all Rossmoor residents, every level.',
    price_cents: 0,
    capacity: null,
    registration_mode: 'drop_in',
    display_order: 10,
  },
  {
    slug: 'drop-in-doubles-sunday',
    title: 'Sunday drop-in',
    subtitle: 'Sunday mornings',
    sport: 'tennis',
    audience: 'adult',
    days_of_week: [0],
    time_start: '08:30',
    time_end: '10:30',
    location_note: 'Courts 3 & 4',
    description:
      'The weekend version of drop-in doubles. Come as you are, rotate in, meet the club.',
    price_cents: 0,
    capacity: null,
    registration_mode: 'drop_in',
    display_order: 20,
  },
  {
    slug: 'wednesday-clinic',
    title: 'Stroke & strategy clinic',
    subtitle: 'Wednesday mornings, free',
    sport: 'tennis',
    audience: 'adult',
    days_of_week: [3],
    time_start: '10:00',
    time_end: '11:30',
    location_note: 'Courts 1 & 2',
    coach_name: 'Eugenio Ovalle',
    level_note: 'Beginners and "rusty" players especially welcome',
    description:
      'A free weekly clinic on strokes and doubles strategy. The best way to start playing at Rossmoor, or to come back to the game.\n\nNo need to sign up.',
    price_cents: 0,
    capacity: null,
    registration_mode: 'drop_in',
    display_order: 30,
  },
  {
    slug: 'ball-machine-drill',
    title: 'Ball machine drill clinic',
    subtitle: 'Friday mornings',
    sport: 'tennis',
    audience: 'adult',
    days_of_week: [5],
    time_start: '10:00',
    time_end: '11:00',
    location_note: 'Court 2',
    description:
      'A volunteer-led drill session on the PlayMate ball machine. Groove your strokes with a few friends.',
    price_cents: null,
    capacity: 6,
    registration_mode: 'online',
    display_order: 40,
  },
];

// Their calendar runs all year; seed through the end of the year.
function season() {
  const ymd = (d) => d.toISOString().slice(0, 10);
  const start = new Date();
  return { range_start: ymd(start), range_end: `${start.getFullYear()}-12-31` };
}

async function rehost(clubId, url, name) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 ClubMode-seed' } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  const type = res.headers.get('content-type') || 'image/png';
  const buf = Buffer.from(await res.arrayBuffer());
  const path = `${clubId}/${name}`;
  const { error } = await db.storage.from('club-site').upload(path, buf, { contentType: type, upsert: true });
  if (error) throw error;
  return db.storage.from('club-site').getPublicUrl(path).data.publicUrl;
}

async function main() {
  const ownerEmailArg = process.argv.indexOf('--owner');
  const ownerEmail = ownerEmailArg > -1 ? process.argv[ownerEmailArg + 1] : null;

  let ownerId = null;
  if (ownerEmail) {
    const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const found = (list?.users ?? []).find((u) => (u.email || '').toLowerCase() === ownerEmail.toLowerCase());
    if (!found) {
      console.error(`No account for ${ownerEmail}.`);
      process.exit(1);
    }
    ownerId = found.id;
  }

  // ------------------------------------------------------------------- club
  const { data: existing } = await db.from('cc_clubs').select('id').eq('slug', SLUG).maybeSingle();
  let clubId = existing?.id ?? null;

  if (clubId) {
    const patch = { ...CLUB };
    if (ownerId) patch.owner_id = ownerId;
    const { error } = await db.from('cc_clubs').update(patch).eq('id', clubId);
    if (error) throw error;
    console.log(`Updated club ${clubId}`);
  } else {
    if (!ownerId) {
      console.error('No club yet: pass --owner <email> (cc_clubs.owner_id is NOT NULL).');
      process.exit(1);
    }
    const { data: created, error } = await db
      .from('cc_clubs')
      .insert({ ...CLUB, owner_id: ownerId })
      .select('id')
      .single();
    if (error) throw error;
    clubId = created.id;
    await db
      .from('cc_club_members')
      .upsert({ club_id: clubId, user_id: ownerId, role: 'owner' }, { onConflict: 'club_id,user_id' });
    console.log(`Created club ${clubId}`);
  }

  // ------------------------------------------------------------------- logo
  try {
    const logo = await rehost(clubId, `${WA}/resources/Pictures/RTC_Logo_70_KB.png`, 'logo-rtc.png');
    await db.from('cc_clubs').update({ logo_url: logo }).eq('id', clubId);
    console.log('Logo re-hosted');
  } catch (e) {
    console.warn(`Logo not re-hosted: ${e.message}`);
  }

  // ------------------------------------------------------------------- site
  const { error: siteErr } = await db.from('club_site').upsert({ club_id: clubId, ...SITE }, { onConflict: 'club_id' });
  if (siteErr) throw siteErr;
  console.log('Seeded site content (draft)');

  // --------------------------------------------------------------- programs
  const dates = season();
  for (const p of PROGRAMS) {
    const row = { ...p, ...dates, club_id: clubId, status: 'published', exclusions: [] };
    const { data: found } = await db
      .from('club_programs')
      .select('id')
      .eq('club_id', clubId)
      .eq('slug', p.slug)
      .maybeSingle();
    const { error } = found
      ? await db.from('club_programs').update(row).eq('id', found.id)
      : await db.from('club_programs').insert(row);
    if (error) throw error;
  }
  console.log(`Seeded ${PROGRAMS.length} weekly programs`);

  // ------------------------------------------------------------------ hours
  // Unlit courts: daylight only. Summer-ish window; the club edits it.
  const week = {};
  for (let dow = 0; dow < 7; dow += 1) week[String(dow)] = [{ open: '07:00', close: '19:00' }];
  await db.from('cc_clubs').update({ operating_hours: week }).eq('id', clubId);

  // ----------------------------------------------------------------- courts
  const { count: courtCount } = await db
    .from('courts')
    .select('id', { count: 'exact', head: true })
    .eq('club_id', clubId);
  if ((courtCount ?? 0) === 0) {
    const courts = Array.from({ length: 8 }, (_, i) => ({
      club_id: clubId,
      number: i + 1,
      name: `Court ${i + 1}`,
      display_order: i + 1,
      status: 'active',
      surface: 'hard',
      sports: ['tennis'],
    }));
    const { error } = await db.from('courts').insert(courts);
    if (error) console.warn(`Courts not seeded: ${error.message}`);
    else console.log('Seeded 8 courts');
  } else {
    console.log(`Courts already present (${courtCount})`);
  }

  console.log(`\nDone. Preview: /c/${SLUG}   (draft — link-only, hidden from Google)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

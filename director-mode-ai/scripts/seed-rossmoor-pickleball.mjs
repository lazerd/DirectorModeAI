/**
 * seed-rossmoor-pickleball.mjs — the Rossmoor Pickleball Club's club record,
 * website, courts, rate cards and weekly programs.
 *
 * Same contract as seed-rossmoor.mjs and seed-lafayette.mjs: every fact is
 * DATA, nothing about the club lives in a .tsx file, and the script is
 * IDEMPOTENT — re-run it to reset the content after experimenting in the
 * editor.
 *
 *   node scripts/seed-rossmoor-pickleball.mjs --owner darrinjco@gmail.com
 *
 * A PROSPECT, not a customer. The club is built so the 2026 board can see
 * their own club in ClubMode. It stays a DRAFT and owned by us until they say
 * yes, then `hand-over-club.mjs` gives it to them.
 *
 * FACTS ARE FROM rossmoorpickleball.net, rossmoor.com and the Rossmoor News
 * as of 2026-09-16. Where their own pages disagree, the Court Guidelines and
 * the 2026 board page win because they are the ones they keep current.
 *
 * WHAT IS DIFFERENT FROM THE TENNIS CLUB NEXT DOOR
 *   - Court booking IS the pitch here. Rossmoor Tennis plays on courts their
 *     landlord keeps first-come-first-served, so that club got no rate cards.
 *     This club is about to move into a GRF-built SIX-COURT INDOOR CENTRE with
 *     bleachers, and six indoor courts with 600 members and no booking system
 *     is a queue. Two rate cards below switch booking on.
 *   - Their levels are their OWN four tiers (Novice / Intermediate / Advanced
 *     Intermediate / Advanced), not DUPR and not NTRP. The level names are
 *     carried as text; the numbers only exist so matching has something to
 *     sort on (see seed-rossmoor-pickleball-demo.mjs).
 *
 * WHAT IS DELIBERATELY NOT HERE
 *   - Board members' personal email addresses. Their names and roles are
 *     published on their own site; their Gmail addresses are not ours to
 *     republish. Only Hal Kushins' phone number appears, because the club
 *     publishes it as the club's contact number.
 *   - Dues collection. $25/year runs through their Wix membership page and
 *     keeps running there; ClubMode links out to it rather than becoming a
 *     second front door (accept_join_requests is off).
 *   - Member names. Every person in the demo is invented — see the demo seed.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const SLUG = 'rossmoor-pickleball-club';
const WIX = 'https://www.rossmoorpickleball.net';

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
  name: 'Rossmoor Pickleball Club',
  description:
    'Pickleball at Rossmoor, Walnut Creek since 2009. Six hundred members, Club Play and Open Play by level every day, free clinics for new residents, and a new six-court indoor centre on Stanley Dollar Drive.',
  // The new indoor centre, behind the Rossmoor Event Center. The Creekside
  // outdoor courts close about two weeks after it opens.
  address: '1021 Stanley Dollar Dr',
  city: 'Walnut Creek',
  state: 'CA',
  zip: '94595',
  // The club publishes the president's number as its contact number.
  phone: '925-818-5941',
  email: null,
  website: `${WIX}/`,
  sports: ['pickleball'],
  timezone: 'America/Los_Angeles',
  is_public: true,
  // Dues are $25/year flat and run through their Wix membership page, which
  // keeps them. A join request here would be a second front door.
  accept_join_requests: false,
  // A sales demo full of invented members: the site says "Demo Environment"
  // and every email the club would send is held (src/lib/demo/emailGuard.ts).
  // hand-over-club.mjs switches this off.
  demo_mode: true,
};

const SITE = {
  /*
   * Their logo is a black-and-white wordmark with a halftone wiffle ball, so
   * there is no brand colour to copy — only a colour that has to sit under it
   * without fighting it. Deep indigo does that, and the accent is the red of
   * the pickleball they use elsewhere on their own site, darkened until white
   * text on it passes contrast. Deliberately nothing like Rossmoor Tennis's
   * teal and gold: these are two different clubs and the demo should not look
   * like one club with two pages.
   */
  color_primary: '#2e2a6b',
  color_secondary: '#c2352f',
  color_ink: '#1a1a24',
  color_cream: '#f5f4f9',
  color_surface: '#ffffff',
  font_choice: 'sans',
  // Rossmoor is a 55+ community and this club's members run to 88. The larger
  // root size is the whole point of the setting.
  text_size: 'large',

  hero_headline: 'Where friends are made while games are played.',
  hero_subhead:
    'Six hundred Rossmoor residents, play at your own level every day of the week, and a brand new six-court indoor centre on Stanley Dollar Drive.',
  hero_cta_label: 'Book a court',
  hero_cta_href: `/c/${SLUG}/courts`,

  about_body: `The Rossmoor Pickleball Club started in 2009 with six players and a borrowed net. Today it is more than 600 members — one of the largest clubs of any kind at Rossmoor — and membership has been open to Rossmoor residents since 2014.

Dues are $25 a year, flat. That buys you Club Play at your level on every court block on the schedule, free clinics, the mentor programme, and every social the club runs: Hit and Giggle afternoons, the Summer Picnic, Grill & Chill, and the Annual Gala.

We are a club that teaches. Free orientation clinics for new residents have put 496 people on a court since 2015, twelve mentors play with new members in the novice sessions, and the Training Committee moves players up a level when they are ready. Off the court, members sort at the food bank, build with Habitat for Humanity, work with Youth Homes, and run a six-week pickleball course at two Title 1 middle schools.`,

  courts_blurb:
    'Six indoor courts at the new pickleball centre on Stanley Dollar Drive, behind the Rossmoor Event Center — 12,793 square feet, spectator bleachers, and no more waiting out a wind day. Until it opens, three outdoor asphalt courts at the Creekside Complex on Tice Creek Drive and two shared courts inside the Tice Creek Fitness Center gym.',

  booking_policy_body: `MANDATORY: SIGN IN BEFORE YOU PLAY.

At the Fitness Center, take a number at the front desk. Outdoors at Creekside, write your name on the whiteboard when your block starts.

Games are to 11, win by 2. How the rotation works depends on how many people are waiting: with four or fewer waiting, winners stay and split; with five to eight, it is four on and four off; with nine or more, games go to 15 points, rally scoring. Leave after three games in a row if others are waiting, and keep drilling to fifteen minutes when people are waiting for a court.

Club Play blocks are for club members. Open Play blocks are open to all Rossmoor residents and their guests.

Choose your level and play at those times only. No double dipping.`,

  amenities: [
    { label: '6 indoor courts', detail: '1021 Stanley Dollar Drive, opening 2026' },
    { label: 'Spectator bleachers', detail: 'For club socials and tournaments' },
    { label: '3 outdoor courts', detail: 'Creekside Complex, 2956 Tice Creek Dr' },
    { label: '2 gym courts', detail: 'Shared, inside the Tice Creek Fitness Center' },
    { label: 'Play at your level', detail: 'Four levels, Novice through Advanced' },
    { label: '600+ members', detail: 'Rossmoor residents, since 2009' },
  ],

  membership_tiers: [
    {
      name: 'Club membership',
      price_display: '$25',
      period: 'year',
      includes: [
        'Club Play blocks at your level',
        'Free clinics and the mentor programme',
        'Socials, Hit and Giggle and the Annual Gala',
        'Open to Rossmoor residents',
      ],
      cta_label: 'Join or renew',
      cta_href: `${WIX}/membershiprenewal`,
    },
  ],

  /*
   * What the booking page will charge, in the club's own words. These mirror
   * the two court_rate_cards rows below — see the comment there: the club has
   * never had a booking system, so it has never had to write these rules down.
   * These are a starting point the board edits in the site editor, not
   * something they told us.
   */
  court_rates: [
    {
      label: 'Members',
      window: 'Any time the centre is open, booked up to 7 days ahead',
      member_cents: 0,
      public_cents: null,
      note: 'Free with your $25 membership',
    },
    {
      label: 'Residents & guests',
      window: 'Booked up to 2 days ahead',
      member_cents: 0,
      public_cents: 500,
      note: 'Per hour',
    },
  ],

  // The 2026 board and the club's trainers, ROLES ONLY. The one phone number
  // is the one the club publishes as its own.
  staff: [
    { name: 'Hal Kushins', title: 'President', phone: '925-818-5941' },
    {
      name: 'Danny Wong',
      title: 'Vice President',
      bio: 'Also one of the club’s two trainers.',
    },
    { name: 'Diane Dauner', title: 'Treasurer' },
    { name: 'Joyce Decker', title: 'Secretary' },
    { name: 'Laurie Greenberg', title: 'Membership' },
    { name: 'Cynthia Davis', title: 'Communications' },
    { name: 'Andrew Moran', title: 'Facilities' },
    { name: 'Natalee Fairbanks', title: 'Director at Large' },
    { name: 'Bob Semar', title: 'Parliamentarian' },
    { name: 'Patty Andrews', title: 'Trainer' },
  ],

  services: [
    {
      name: 'Lessons',
      blurb: 'Lessons with the club’s trainers, Danny Wong and Patty Andrews.',
      price_note: 'Ask a trainer',
    },
    {
      name: 'Mentor programme',
      blurb:
        'Twelve club mentors play with new members in the novice sessions marked on the schedule.',
      price_note: 'Free to members',
    },
    {
      name: 'Moving up a level',
      blurb:
        'Ask a trainer, work the skills sheet, drill, then an evaluation by the Training Committee.',
      price_note: 'Free to members',
    },
  ],

  partner_links: [
    {
      name: 'Rossmoor Tennis Club',
      sport: 'Tennis',
      blurb: 'Tennis at Rossmoor, run by our friends at the Buckeye courts.',
      href: 'https://www.rossmoortennis.com',
    },
    {
      name: 'Rossmoor Sports',
      sport: 'Community',
      blurb: 'Pickleball and every other sport at Rossmoor.',
      href: 'https://rossmoor.com/residents/sports/',
    },
  ],

  documents: [
    { label: 'Court guidelines', href: `${WIX}/court-guidelines`, kind: 'link' },
    { label: 'Club player levels', href: `${WIX}/club-player-levels`, kind: 'link' },
    {
      label: 'New indoor facility — progress',
      href: `${WIX}/pickleball-facility-progress`,
      kind: 'link',
    },
  ],

  // The tools the site should lead to, as data. Relative paths are the same
  // site; the join link stays on Wix, where the dues are.
  nav_links: [
    { label: 'Book a court', href: `/c/${SLUG}/courts` },
    { label: 'Courts right now', href: `/checkin/${SLUG}/board` },
    { label: 'Join or renew', href: `${WIX}/membershiprenewal` },
  ],

  seo_title: 'Rossmoor Pickleball Club — Walnut Creek, CA',
  seo_description:
    'Pickleball for Rossmoor residents since 2009. 600+ members, Club Play and Open Play by level, free clinics for new residents, and a new six-court indoor centre on Stanley Dollar Drive.',

  status: 'draft',
};

/**
 * Their standing week, from the Creekside and Fitness Center schedules, the
 * programmes page and the Rossmoor News.
 *
 * price_cents is 0 only where the club SAYS free (the orientation clinic and
 * the intermediate clinic both are), and NULL with a note where the honest
 * answer is "it comes with your $25". A programme seeded at 0 advertises
 * "Free" on the club's own website, which is not the same thing.
 *
 * The orientation clinic is the one with online registration and a capacity,
 * so there is something on the demo a visitor can actually sign up for.
 */
const PROGRAMS = [
  {
    slug: 'morning-drill-and-thrill',
    title: 'Morning Drill & Thrill',
    subtitle: 'Monday, Tuesday & Wednesday, 8–9am',
    sport: 'pickleball',
    audience: 'adult',
    days_of_week: [1, 2, 3],
    time_start: '08:00',
    time_end: '09:00',
    location_note: 'Creekside courts',
    level_note: 'Split by level — novice on one court, intermediate and up on the others',
    description:
      'An hour of drills before Club Play starts. Dinks, third shots, resets and serve returns, split by level so you are drilling with people who hit the ball like you do.\n\nNo sign-up — just be there at eight.',
    price_cents: null,
    price_note: 'Included with club membership ($25 a year)',
    capacity: null,
    registration_mode: 'drop_in',
    display_order: 10,
  },
  {
    slug: 'club-play-novice-intermediate',
    title: 'Club Play — Novice & Intermediate',
    subtitle: 'Monday, Wednesday & Friday mornings',
    sport: 'pickleball',
    audience: 'adult',
    days_of_week: [1, 3, 5],
    time_start: '09:00',
    time_end: '11:00',
    level_note: 'Novice (1.0–2.0) and Intermediate (2.5–3.0)',
    description:
      'Members-only rotation at your level. Sign in before you play, games to 11 win by 2, and the rotation scales with the queue.\n\nChoose your level and play at those times only. No double dipping.',
    price_cents: null,
    price_note: 'Members only — included with your $25 dues',
    capacity: null,
    registration_mode: 'drop_in',
    display_order: 20,
  },
  {
    slug: 'club-play-advanced',
    title: 'Club Play — Advanced Intermediate & Advanced',
    subtitle: 'Tuesday & Thursday mornings',
    sport: 'pickleball',
    audience: 'adult',
    days_of_week: [2, 4],
    time_start: '09:00',
    time_end: '11:00',
    level_note: 'Advanced Intermediate and Advanced (3.0–4.0+)',
    description:
      'Members-only rotation for the top two levels. Sign in before you play, games to 11 win by 2.\n\nChoose your level and play at those times only. No double dipping.',
    price_cents: null,
    price_note: 'Members only — included with your $25 dues',
    capacity: null,
    registration_mode: 'drop_in',
    display_order: 30,
  },
  {
    slug: 'open-play',
    title: 'Open Play',
    subtitle: 'Saturday mornings — residents and guests',
    sport: 'pickleball',
    audience: 'all',
    days_of_week: [6],
    time_start: '09:00',
    time_end: '11:30',
    level_note: 'All levels',
    description:
      'Open to all Rossmoor residents and their guests, whether or not you are a club member. Paddles up, sign in, and someone will put you in a game.',
    price_cents: 0,
    capacity: null,
    registration_mode: 'drop_in',
    display_order: 40,
  },
  {
    slug: 'orientation-clinic',
    title: 'Orientation clinic for new residents',
    subtitle: 'Saturday — free, first time on a court',
    sport: 'pickleball',
    audience: 'all',
    days_of_week: [6],
    time_start: '12:00',
    time_end: '13:30',
    coach_name: 'Club trainers',
    level_note: 'Never played before — paddles provided',
    description:
      'The free clinic that has put 496 Rossmoor residents on a pickleball court since 2015. The rules, the kitchen, the serve, and a game by the end of it.\n\nFree to any Rossmoor resident. Paddles and balls are provided — wear shoes you can move in.',
    price_cents: 0,
    capacity: 12,
    registration_mode: 'online',
    display_order: 50,
  },
  {
    slug: 'intermediate-clinic',
    title: 'Intermediate clinic',
    subtitle: 'Thursday afternoons — free',
    sport: 'pickleball',
    audience: 'adult',
    days_of_week: [4],
    time_start: '15:30',
    time_end: '17:00',
    coach_name: 'Club trainers',
    level_note: 'Intermediate (2.5–3.0) working toward Advanced Intermediate',
    description:
      'A free clinic for intermediate members: third-shot drops, transition-zone resets, stacking and when not to bother.\n\nThe drilling the Training Committee wants to see before a level evaluation.',
    price_cents: 0,
    capacity: null,
    registration_mode: 'drop_in',
    display_order: 60,
  },
  {
    slug: 'mentor-novice-session',
    title: 'Mentor session — new players',
    subtitle: 'Friday late morning',
    sport: 'pickleball',
    audience: 'adult',
    days_of_week: [5],
    time_start: '11:00',
    time_end: '12:00',
    level_note: 'Novice (1.0–2.0)',
    description:
      'One of the club’s twelve mentors plays with new members: real games, called scores, and someone to tell you where to stand.\n\nThe next step after the orientation clinic.',
    price_cents: null,
    price_note: 'Members only — included with your $25 dues',
    capacity: null,
    registration_mode: 'drop_in',
    display_order: 70,
  },
];

/**
 * Court booking rules.
 *
 * THESE ARE OURS, NOT THEIRS. The club has never had a booking system, so it
 * has never had to decide how far ahead a member may book or what a guest
 * pays; nothing on their site answers either question. What is real is the
 * shape: Club Play blocks are members-only and Open Play blocks are open to
 * all residents and guests, so "members free with a longer window, residents
 * and guests a few dollars with a shorter one" is their own rule expressed as
 * a price list. Both numbers are editable from the site editor and the first
 * thing to ask the board about.
 *
 * Two rows is also what switches online court booking ON for a club
 * (bookingEnabled in src/lib/courts/pricing.ts).
 */
const RATES = [
  {
    label: 'Members',
    applies_to: 'member',
    price_cents: 0,
    advance_days: 7,
    time_start: '07:00',
    time_end: '21:00',
    min_minutes: 60,
    max_minutes: 120,
    display_order: 0,
    note: 'Free with your $25 membership. Book up to a week ahead.',
  },
  {
    label: 'Residents & guests',
    applies_to: 'public',
    price_cents: 500,
    advance_days: 2,
    time_start: '07:00',
    time_end: '21:00',
    min_minutes: 60,
    max_minutes: 90,
    display_order: 1,
    note: 'Per hour, for Rossmoor residents and their guests.',
  },
];

/**
 * The club's four levels, as the club publishes them.
 *
 * These ARE the level names members read everywhere in ClubMode — the
 * CourtConnect board, the picker, the club site, PlayerVault. Nothing shows
 * them a decimal. lib/levels.ts renders them; cc_club_level_tiers stores them;
 * this is where the facts live.
 *
 *   rating  the number stored when a member picks the tier. CourtConnect
 *           matches on numbers, so every tier needs one — these are the same
 *           four the demo members and demo games already carry (see
 *           seed-rossmoor-pickleball-demo.mjs). ONE DECIMAL PLACE: every
 *           rating column in ClubMode is numeric(2,1), so a 2.75 here would be
 *           stored as 2.8 and no longer match the tier a member picked.
 *   min     the lowest number that READS as this tier. The next tier's min is
 *           this one's ceiling, so no rating can fall between two names.
 *   max     the top of the band the CLUB publishes, shown as quiet grey text
 *           beside the name. Null on Advanced, which reads "4.0+".
 *
 * Moving up is not a number changing: a member asks a trainer, works a skills
 * sheet, drills, and is evaluated by the Training Committee.
 */
const LEVEL_TIERS = [
  { name: 'Novice', rating: 2.0, min_rating: 1.0, max_rating: 2.0 },
  { name: 'Intermediate', rating: 2.8, min_rating: 2.5, max_rating: 3.0 },
  { name: 'Advanced Intermediate', rating: 3.3, min_rating: 3.0, max_rating: 3.5 },
  { name: 'Advanced', rating: 4.0, min_rating: 4.0, max_rating: null },
];

/**
 * The courts.
 *
 * The six INDOOR courts are the club's future and are numbered 1–6, so the
 * booking page, the court sheet and the QR check-in signs are all about the
 * new centre. The three Creekside courts are carried too, named so nobody can
 * mistake which is which, because they are still where everyone plays this
 * morning — and they close permanently about two weeks after the indoor
 * centre opens.
 */
const COURTS = [
  ...Array.from({ length: 6 }, (_, i) => ({
    number: i + 1,
    name: `Court ${i + 1}`,
    surface: 'indoor',
    indoor: true,
    display_order: i + 1,
  })),
  ...Array.from({ length: 3 }, (_, i) => ({
    number: 7 + i,
    name: `Creekside ${i + 1} (outdoor)`,
    surface: 'asphalt',
    indoor: false,
    display_order: 10 + i,
  })),
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
  const { error } = await db.storage
    .from('club-site')
    .upload(path, buf, { contentType: type, upsert: true });
  if (error) throw error;
  return db.storage.from('club-site').getPublicUrl(path).data.publicUrl;
}

async function main() {
  const ownerEmailArg = process.argv.indexOf('--owner');
  const ownerEmail = ownerEmailArg > -1 ? process.argv[ownerEmailArg + 1] : null;

  let ownerId = null;
  if (ownerEmail) {
    const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const found = (list?.users ?? []).find(
      (u) => (u.email || '').toLowerCase() === ownerEmail.toLowerCase(),
    );
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
  // Their own wordmark, re-hosted so the demo never hotlinks their Wix CDN.
  try {
    const logo = await rehost(
      clubId,
      'https://static.wixstatic.com/media/47a7d1_a57c1a2e619749258d631a307a0459b8~mv2.png',
      'logo-rpc.png',
    );
    await db.from('cc_clubs').update({ logo_url: logo }).eq('id', clubId);
    console.log('Logo re-hosted');
  } catch (e) {
    console.warn(`Logo not re-hosted: ${e.message}`);
  }

  // ------------------------------------------------------------------- site
  const { error: siteErr } = await db
    .from('club_site')
    .upsert({ club_id: clubId, ...SITE }, { onConflict: 'club_id' });
  if (siteErr) throw siteErr;
  console.log('Seeded site content (draft, large text)');

  // ----------------------------------------------------------------- levels
  // Upsert by position so a re-run renames a tier instead of adding a fifth;
  // cc_club_level_tiers is UNIQUE (club_id, sport, position).
  {
    const { error } = await db.from('cc_club_level_tiers').upsert(
      LEVEL_TIERS.map((t, i) => ({
        ...t,
        club_id: clubId,
        sport: 'pickleball',
        position: i,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: 'club_id,sport,position' },
    );
    if (error) throw error;
    console.log(`Seeded ${LEVEL_TIERS.length} level tiers (${LEVEL_TIERS.map((t) => t.name).join(', ')})`);
  }

  // ----------------------------------------------------------------- courts
  // Upsert by number so a re-run corrects a name or a surface instead of
  // duplicating; courts are UNIQUE (club_id, number).
  {
    const { error } = await db
      .from('courts')
      .upsert(
        COURTS.map((c) => ({ ...c, club_id: clubId, status: 'active', sports: ['pickleball'] })),
        { onConflict: 'club_id,number' },
      );
    if (error) throw error;
    console.log(`Seeded ${COURTS.length} courts (6 indoor + 3 Creekside outdoor)`);
  }

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

  // ------------------------------------------------------------ rate cards
  for (const r of RATES) {
    const { data: found } = await db
      .from('court_rate_cards')
      .select('id')
      .eq('club_id', clubId)
      .eq('label', r.label)
      .eq('applies_to', r.applies_to)
      .maybeSingle();
    const { error } = found
      ? await db.from('court_rate_cards').update(r).eq('id', found.id)
      : await db.from('court_rate_cards').insert({ ...r, club_id: clubId });
    if (error) throw error;
  }
  console.log('Seeded 2 court rate cards (members free / residents & guests $5 an hour)');

  // ------------------------------------------------------------------ hours
  // Indoors, with lights and a roof: a real evening, not the tennis club's
  // daylight-only window.
  const week = {};
  for (let dow = 0; dow < 7; dow += 1) week[String(dow)] = [{ open: '07:00', close: '21:00' }];
  await db.from('cc_clubs').update({ operating_hours: week }).eq('id', clubId);
  console.log('Seeded opening hours (7am–9pm, every day)');

  console.log(`\nDone. Preview: /c/${SLUG}   (draft — link-only, hidden from Google)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * seed-lafayette.mjs — Lafayette Tennis Club's real club record and website.
 *
 * A SCRIPT, and every fact in it is DATA. Nothing about Lafayette is allowed
 * to live in a .tsx file: the test of the club-site feature is that a second
 * club can be produced by inserting rows, and the moment one club's phone
 * number is hardcoded into a page that stops being true.
 *
 * IDEMPOTENT. Run it as often as you like — it upserts by slug and never
 * touches another club. Re-run it to reset Lafayette's content after
 * experimenting in the editor.
 *
 *   node scripts/seed-lafayette.mjs
 *
 * NOT a demo club. This is Hunter Gallaway's real club, created so he can be
 * handed the keys: the owner is left null until he has an account, and
 * `--owner <email>` attaches it to him when he does.
 *
 * PRICES ARE FROM PUBLIC LISTINGS and may be out of date. They live in editable
 * columns precisely so they can be corrected in the editor in seconds — check
 * them with Hunter before the page is shown to anyone.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const SLUG = 'lafayette-tennis-club';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);

const db = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// ----------------------------------------------------------------- the facts
const CLUB = {
  slug: SLUG,
  name: 'Lafayette Tennis Club',
  description:
    'Nine lighted hard courts in Lafayette, home of the Hunter Gallaway Academy — junior and adult tennis and pickleball, with a pool, gym and locker rooms.',
  address: '3125 Camino Diablo Rd',
  city: 'Lafayette',
  state: 'CA',
  zip: '94549',
  phone: '925-937-2582',
  email: 'hunterhg@comcast.net',
  website: 'https://lafayettetennis.com',
  sports: ['tennis', 'pickleball'],
  timezone: 'America/Los_Angeles',
  is_public: true,
  accept_join_requests: true,
};

const SITE = {
  // A deep court green with a warm gold — a club palette, not ClubMode's.
  color_primary: '#14532d',
  color_secondary: '#b8860b',
  color_ink: '#1c2321',
  color_cream: '#faf7f2',
  color_surface: '#ffffff',
  font_choice: 'condensed',

  hero_headline: 'Nine lighted courts. One tennis family.',
  hero_subhead:
    'Junior and adult tennis and pickleball in the heart of Lafayette — home of the Hunter Gallaway Academy, with a pool, gym and locker rooms.',
  hero_cta_label: 'See our classes',

  about_body: `Lafayette Tennis Club is a nine-court club on Camino Diablo, built around one idea: that a club should be the easiest place in town to get on a court and get better.

We are home to the Hunter Gallaway Academy. Hunter is a former world-ranked player, a Collegiate All-American and a USPTA certified professional, and was named Men's Open Player of the Year five times. He coaches here every week, from three-year-olds on the red ball through adults chasing a league title.

Members play for free and book a week ahead. The public is welcome too. Beyond tennis and pickleball there is a swimming pool, a personal-training gym, locker rooms and cardio equipment.`,

  courts_blurb:
    'Nine hard courts, all lighted, so play does not stop when the sun goes down. Courts are yours free as a member, and available to the public by the hour.',

  booking_policy_body: `Members book courts free, up to 7 days in advance.

The public books up to 3 days in advance at $24 per hour.

Book online below, or call the club. Pay at the desk when you arrive.`,

  amenities: [
    { label: '9 lighted hard courts', detail: 'Play does not stop at sunset' },
    { label: 'Swimming pool' },
    { label: 'Personal training gym', detail: 'With cardio equipment' },
    { label: 'Locker rooms', detail: 'Lockers available' },
    { label: 'Junior & adult tennis', detail: 'Red ball through 4.5' },
    { label: 'Pickleball', detail: 'Lessons and open play' },
  ],

  membership_tiers: [
    {
      name: 'Family',
      price_display: 'from $130',
      period: 'month',
      includes: ['Free court time', 'Book 7 days ahead', 'Pool, gym & locker rooms'],
    },
    {
      name: 'Single',
      price_display: '$115',
      period: 'month',
      includes: ['Free court time', 'Book 7 days ahead', 'Pool, gym & locker rooms'],
    },
    {
      name: 'Public play',
      price_display: '$24',
      period: 'hour',
      includes: ['Book 3 days ahead', 'No membership needed'],
    },
  ],

  court_rates: [
    { label: 'Members', window: 'Any time, booked up to 7 days ahead', member_cents: 0, public_cents: null },
    { label: 'Public', window: 'Booked up to 3 days ahead', member_cents: 0, public_cents: 2400, note: 'Per hour' },
  ],

  staff: [
    {
      name: 'Hunter Gallaway',
      title: 'Tennis Director & Owner',
      bio: "Former world-ranked player, Collegiate All-American and USPTA certified professional. Five-time Men's Open Player of the Year. Runs the Hunter Gallaway Academy and still coaches on court every week.",
      email: 'hunterhg@comcast.net',
      phone: '925-937-2582',
    },
  ],

  services: [
    {
      name: 'Racquet stringing',
      blurb: 'Drop your racquet at the desk and we string it in house.',
      price_note: 'Ask at the desk',
    },
    {
      name: 'Ball machine',
      blurb: 'Book the machine and drill on your own schedule.',
      price_note: 'Members only',
    },
  ],

  // Other pros who run their own programs on these courts. Links out on
  // purpose — their registration stays theirs. URLs left blank for Hunter to
  // fill, rather than guessed at.
  partner_links: [
    { name: 'Carmen — Pickleball', sport: 'Pickleball', blurb: 'Pickleball lessons and clinics at the club.' },
    { name: 'Harriet Plummer — Swim', sport: 'Swim', blurb: 'Swim lessons and programs in the club pool.' },
  ],

  documents: [{ label: 'Member packet', kind: 'pdf' }],

  // A visiting captain has to be able to find the hosting page from anywhere.
  nav_links: [{ label: 'Host your team', href: '/c/lafayette-tennis-club/host' }],

  seo_title: 'Lafayette Tennis Club — Lafayette, CA',
  seo_description:
    'Nine lighted hard courts in Lafayette, CA. Junior and adult tennis and pickleball, the Hunter Gallaway Academy, pool, gym and locker rooms. Memberships from $115/month.',

  // A DRAFT. Nobody's website goes live because a script ran — Hunter and
  // Darrin look at it first, and the Publish button is in the editor.
  status: 'draft',
};

/**
 * His actual programming, from the USTA page and the club's listings.
 *
 * Drafts, and priced at 0 where the real number is not known: a wrong price on
 * a page he is about to look at is worse than an obviously blank one, and
 * filling one in is a five-second demo of the whole product.
 */
const PROGRAMS = [
  {
    slug: 'pee-wee-tennis',
    title: 'Pee-Wee Tennis',
    subtitle: 'Ages 3–5, first time on a court',
    sport: 'tennis',
    audience: 'junior',
    age_min: 3,
    age_max: 5,
    days_of_week: [2],
    time_start: '15:00',
    time_end: '15:30',
    coach_name: 'Hunter Gallaway',
    description:
      'For new and younger players. Players learn fundamentals, and also play rally contests, mini matches, and learn strategy.',
    price_cents: 0,
    price_note: 'Ask about pricing',
    capacity: 10,
    registration_mode: 'online',
    display_order: 10,
  },
  {
    slug: 'after-school-juniors',
    title: 'After-School Juniors',
    subtitle: 'Tue & Thu after school',
    sport: 'tennis',
    audience: 'junior',
    age_min: 6,
    age_max: 14,
    days_of_week: [2, 4],
    time_start: '15:30',
    time_end: '17:00',
    coach_name: 'Hunter Gallaway',
    description:
      'The core junior program — stroke work, point play and match tactics, grouped by level. Come once a week or twice.',
    price_cents: 0,
    capacity: 16,
    registration_mode: 'online',
    display_order: 20,
  },
  {
    slug: 'adult-clinics',
    title: 'Adult Clinics',
    subtitle: 'Morning and evening drills',
    sport: 'tennis',
    audience: 'adult',
    days_of_week: [1, 3],
    time_start: '09:00',
    time_end: '10:30',
    coach_name: 'Hunter Gallaway',
    description: 'Live-ball drilling and point play for adults, grouped by level.',
    price_cents: 0,
    capacity: 12,
    registration_mode: 'online',
    display_order: 30,
  },
  {
    slug: 'adult-pickleball',
    title: 'Adult Pickleball',
    subtitle: 'Lessons and open play',
    sport: 'pickleball',
    audience: 'adult',
    days_of_week: [5],
    time_start: '09:00',
    time_end: '10:30',
    description: 'Pickleball instruction and organised play for adults of every level.',
    price_cents: 0,
    capacity: 16,
    registration_mode: 'online',
    display_order: 40,
  },
  {
    slug: 'junior-summer-camp',
    title: 'Junior Summer Camp',
    subtitle: 'Morning and afternoon sessions',
    sport: 'tennis',
    audience: 'junior',
    age_min: 5,
    age_max: 16,
    days_of_week: [1, 2, 3, 4, 5],
    time_start: '09:00',
    time_end: '12:00',
    coach_name: 'Hunter Gallaway',
    description:
      'Full-week summer camps, morning or afternoon, for juniors from first racquet through tournament play.',
    price_cents: 0,
    capacity: 24,
    registration_mode: 'online',
    display_order: 50,
  },
];

/** A sensible current season for the seeded classes: the next ten weeks. */
function season() {
  const start = new Date();
  // Next Monday, so every day-of-week in the set has a chance to land.
  start.setDate(start.getDate() + ((8 - start.getDay()) % 7 || 7));
  const end = new Date(start);
  end.setDate(end.getDate() + 69);
  const ymd = (d) => d.toISOString().slice(0, 10);
  return { range_start: ymd(start), range_end: ymd(end) };
}

async function main() {
  const ownerEmailArg = process.argv.indexOf('--owner');
  const ownerEmail = ownerEmailArg > -1 ? process.argv[ownerEmailArg + 1] : null;

  // ------------------------------------------------------------------ owner
  let ownerId = null;
  if (ownerEmail) {
    const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const found = (list?.users ?? []).find(
      (u) => (u.email || '').toLowerCase() === ownerEmail.toLowerCase(),
    );
    if (!found) {
      console.error(
        `No account for ${ownerEmail}. Have them sign up first, then re-run with --owner.`,
      );
      process.exit(1);
    }
    ownerId = found.id;
    console.log(`Owner: ${ownerEmail}`);
  }

  // ------------------------------------------------------------------- club
  const { data: existing } = await db
    .from('cc_clubs')
    .select('id, owner_id')
    .eq('slug', SLUG)
    .maybeSingle();

  let clubId = existing?.id ?? null;

  if (clubId) {
    // Never clobber a real owner with null on a re-run.
    const patch = { ...CLUB };
    if (ownerId) patch.owner_id = ownerId;
    const { error } = await db.from('cc_clubs').update(patch).eq('id', clubId);
    if (error) throw error;
    console.log(`Updated club ${clubId}`);
  } else {
    if (!ownerId) {
      // cc_clubs.owner_id is NOT NULL, so the club cannot exist before someone
      // owns it. Say what to do rather than failing on a constraint.
      console.error(
        'No club yet and no --owner given. cc_clubs requires an owner, so:\n' +
          '  1. Have Hunter sign up at clubmode.ai/register\n' +
          '  2. node scripts/seed-lafayette.mjs --owner hunterhg@comcast.net\n' +
          '\nTo preview it under your own account first, pass --owner with your email.',
      );
      process.exit(1);
    }
    const { data: created, error } = await db
      .from('cc_clubs')
      .insert({ ...CLUB, owner_id: ownerId })
      .select('id')
      .single();
    if (error) throw error;
    clubId = created.id;
    console.log(`Created club ${clubId}`);

    await db
      .from('cc_club_members')
      .upsert({ club_id: clubId, user_id: ownerId, role: 'owner' }, { onConflict: 'club_id,user_id' });
  }

  // ------------------------------------------------------------------- site
  const { error: siteErr } = await db
    .from('club_site')
    .upsert({ club_id: clubId, ...SITE }, { onConflict: 'club_id' });
  if (siteErr) throw siteErr;
  console.log('Seeded site content (draft)');

  // --------------------------------------------------------------- programs
  const dates = season();
  for (const p of PROGRAMS) {
    const row = { ...p, ...dates, club_id: clubId, status: 'draft', exclusions: [] };
    const { data: found } = await db
      .from('club_programs')
      .select('id')
      .eq('club_id', clubId)
      .eq('slug', p.slug)
      .maybeSingle();
    if (found) {
      const { error } = await db.from('club_programs').update(row).eq('id', found.id);
      if (error) throw error;
    } else {
      const { error } = await db.from('club_programs').insert(row);
      if (error) throw error;
    }
  }
  console.log(`Seeded ${PROGRAMS.length} classes (drafts)`);

  // -------------------------------------------------------------- rates
  /*
   * His real rule, as two rate cards: free to members booking a week out,
   * $24/hr to the public booking three days out. Two rows is what switches
   * online court booking on for the club.
   */
  const RATES = [
    {
      label: 'Members',
      applies_to: 'member',
      price_cents: 0,
      advance_days: 7,
      time_start: '06:00',
      time_end: '22:00',
      min_minutes: 60,
      max_minutes: 120,
      display_order: 0,
      note: 'Free court time for members',
    },
    {
      label: 'Public',
      applies_to: 'public',
      price_cents: 2400,
      advance_days: 3,
      time_start: '06:00',
      time_end: '22:00',
      min_minutes: 60,
      max_minutes: 120,
      display_order: 1,
      note: 'Per hour',
    },
  ];
  for (const r of RATES) {
    const { data: found } = await db
      .from('court_rate_cards')
      .select('id')
      .eq('club_id', clubId)
      .eq('label', r.label)
      .eq('applies_to', r.applies_to)
      .maybeSingle();
    if (found) {
      const { error } = await db.from('court_rate_cards').update(r).eq('id', found.id);
      if (error) throw error;
    } else {
      const { error } = await db.from('court_rate_cards').insert({ ...r, club_id: clubId });
      if (error) throw error;
    }
  }
  console.log('Seeded 2 court rates (members free / public $24)');

  /*
   * Opening hours, so the booking page has a day to lay out. Without these
   * availableSlots falls back to 7am-10pm and says nothing about the club.
   */
  const { data: clubHours } = await db
    .from('cc_clubs')
    .select('operating_hours')
    .eq('id', clubId)
    .maybeSingle();
  if (!clubHours?.operating_hours || Object.keys(clubHours.operating_hours).length === 0) {
    const week = {};
    for (let dow = 0; dow < 7; dow += 1) {
      // Weekends open an hour later; lights mean everyone closes at 10.
      week[String(dow)] = [{ open: dow === 0 || dow === 6 ? '07:00' : '06:00', close: '22:00' }];
    }
    const { error } = await db.from('cc_clubs').update({ operating_hours: week }).eq('id', clubId);
    if (error) console.warn(`Hours not seeded: ${error.message}`);
    else console.log('Seeded opening hours (6am-10pm, 7am weekends)');
  } else {
    console.log('Opening hours already set');
  }

  // ------------------------------------------------------- hosting packages
  /*
   * Season packages for a visiting USTA team with no home courts.
   *
   * HIS NUMBERS AS GIVEN, including the part I flagged: at 5 matches the
   * playoff rate lands at or below the season per-match rate ($100 vs $100 on
   * 3 courts; $135 vs $150 on 5), so a team pays no more — and on 5 courts
   * less — for a playoff than a regular match. He was shown the arithmetic and
   * chose to keep it, so it is seeded as stated and the editor flags it every
   * time he opens the screen.
   */
  const HOST_PACKAGES = [
    {
      label: '3 courts',
      courts: 3,
      matches_included: 5,
      price_cents: 50000,
      playoff_price_cents: 10000,
      blurb: 'For a 3-line league format. Your courts for every home match of the season.',
      includes: [
        'All 5 home matches',
        '3 courts held for your match time',
        'Lighted courts, so evening matches are fine',
        'Locker rooms and showers for your players',
      ],
      display_order: 0,
    },
    {
      label: '5 courts',
      courts: 5,
      matches_included: 5,
      price_cents: 75000,
      playoff_price_cents: 13500,
      blurb: 'For a full 5-line USTA format — three singles and two doubles, or two and three.',
      includes: [
        'All 5 home matches',
        '5 courts held for your match time',
        'Lighted courts, so evening matches are fine',
        'Locker rooms and showers for your players',
      ],
      display_order: 1,
    },
  ];
  for (const p of HOST_PACKAGES) {
    const { data: found } = await db
      .from('club_host_packages')
      .select('id')
      .eq('club_id', clubId)
      .eq('label', p.label)
      .maybeSingle();
    if (found) {
      const { error } = await db.from('club_host_packages').update(p).eq('id', found.id);
      if (error) throw error;
    } else {
      const { error } = await db.from('club_host_packages').insert({ ...p, club_id: clubId });
      if (error) throw error;
    }
  }
  console.log('Seeded 2 hosting packages ($500 / 3cts, $750 / 5cts)');

  // ------------------------------------------------------------------ courts
  // Nine courts, so /c/<slug>/courts counts them from CourtSheet rather than
  // from a number typed into the marketing copy.
  const { count: courtCount } = await db
    .from('courts')
    .select('id', { count: 'exact', head: true })
    .eq('club_id', clubId);
  if ((courtCount ?? 0) === 0) {
    const courts = Array.from({ length: 9 }, (_, i) => ({
      club_id: clubId,
      // `number` is what CourtSheet's AI resolves a spoken "court 3" against,
      // so it has to be set even though the column is nullable.
      number: i + 1,
      name: `Court ${i + 1}`,
      display_order: i + 1,
      status: 'active',
      surface: 'hard',
      sports: ['tennis', 'pickleball'],
    }));
    const { error } = await db.from('courts').insert(courts);
    if (error) console.warn(`Courts not seeded: ${error.message}`);
    else console.log('Seeded 9 courts');
  } else {
    console.log(`Courts already present (${courtCount})`);
  }

  console.log(`\nDone. Preview: /c/${SLUG}   Editor: /run/site`);
  console.log('It is a DRAFT — publish from the editor once the content is checked.');
  console.log('\nPrices came from public listings. Confirm them with Hunter before showing him.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * seed-crm.mjs — the three prospects that exist today, as data.
 *
 *   node scripts/seed-crm.mjs
 *
 * Idempotent: orgs and templates upsert on their slug, contacts on (org,
 * name), and the "what has happened so far" activity is written once per org
 * and then recognised by its own text. Run it twice and the counts do not
 * move.
 *
 * FACTS LIVE HERE, NOT IN .tsx. Everything below — who is on which board, what
 * a club runs on today, when they meet — was researched once and belongs in
 * one file that a rep can correct. None of it is hardcoded into a page.
 *
 * It does NOT invent people. Where a club publishes a title and no address the
 * email is left blank, which is a fact worth having: it tells a rep to go and
 * ask for it. Nobody appears here who is not on the club's own page.
 */

import pg from 'pg';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);

const DARRIN = 'darrinjco@gmail.com';
/** The day this pipeline was first written down. */
const TODAY = '2026-09-16';

// ---------------------------------------------------------------- the reps
const REPS = [
  { email: DARRIN, full_name: 'Darrin Cohen', initials: 'DC' },
  // Kevin Carey's address is not known yet. He is added with one command when
  // it is — see scripts/crm-user.mjs. Nothing here guesses it.
];

// -------------------------------------------------------------- the clubs
const ORGS = [
  {
    slug: 'rossmoor-tennis-club',
    name: 'Rossmoor Tennis Club',
    club_slug: 'rossmoor-tennis-club',
    website: 'https://rtc.wildapricot.org/',
    city: 'Walnut Creek',
    state: 'CA',
    type: 'club',
    member_count: 200,
    stage: 'researching',
    owner_email: DARRIN,
    demo_url: 'https://clubmode.ai/demo/wkb9X2jt-QF_nB6XGxrkaqLpuST8ntd8',
    next_step: 'Warm intro to Mary Benin + Richard Schulman',
    next_step_at: '2026-09-21',
    notes: [
      'Runs on Wild Apricot (dues $0 / $30 / $50 a year).',
      'Court register is paper, at the Buckeye kiosk.',
      'Wild Card tournament pairings are done on an Excel sheet Richard Schulman owns.',
      'Board meets the 3rd Monday — Sep 21, Oct 19.',
      'NO COURT BOOKING TO SELL: the 8 courts are owned by Rossmoor and are first-come for all',
      'residents. The pitch here is the tournament/pairing side and the member communications,',
      'not reservations.',
    ].join('\n'),
    first_activity: 'Demo environment built and link ready. Researched the board from their RTC-Organization page.',
    contacts: [
      // Titles as published on their RTC-Organization page.
      { full_name: 'Mary Benin', title: 'President', email: 'mary.benin@gmail.com', is_primary: true, role: 'decision maker', notes: 'Also a past 65+ captain.' },
      { full_name: 'Bert Sebilia', title: 'Vice President', email: 'sebilia@comcast.net' },
      { full_name: 'Barbara Landberg', title: 'Secretary', email: 'barbaralandberg@gmail.com' },
      { full_name: 'Bart Ostro', title: 'Treasurer', email: 'bostro@pacbell.net', role: 'approves spend', notes: 'Also on the "Geek Squad".' },
      { full_name: 'Richard Schulman', title: 'Tournaments Director', email: 'richard.schulman@gmail.com', role: 'champion', notes: 'Owns the Excel pairing sheet. Geek Squad.' },
      { full_name: 'Shrey Trivedi', title: 'Social', email: 'shrey.kiet@gmail.com' },
      { full_name: 'Lori Davis', title: 'Membership', email: 'lori-davis11@hotmail.com' },
      { full_name: 'David Hickey', title: 'Facilities', email: 'davidhickey3@gmail.com' },
      { full_name: 'Bernie Wolf', title: "Captain, SMIL Men's 60+", email: 'docberniew@gmail.com' },
      { full_name: 'Becky Reiss', title: "Captain, Women's 65+ (East Bay Women's League)", email: 'rebeccareiss@yahoo.com' },
      // No address published.
      { full_name: 'Pat Baughman', title: "Captain, Women's 50+/55+", email: null },
      { full_name: 'Dave Blanchard', title: 'Geek Squad (tech volunteer)', email: 'davejaneplus@gmail.com' },
      { full_name: 'Chris Slee', title: 'Geek Squad; former Tournaments Director', email: 'slee.tennis@gmail.com' },
      { full_name: 'Eugenio Ovalle', title: 'Teaching Professional', email: 'eugenioovalle@gmail.com', phone: '925-932-6551' },
      { full_name: 'Roger Emanuel', title: 'Publicity (writes the newsletter and website)', email: null },
    ],
  },
  {
    slug: 'rossmoor-pickleball-club',
    name: 'Rossmoor Pickleball Club',
    club_slug: 'rossmoor-pickleball-club',
    website: 'https://www.rossmoorpickleball.net/',
    city: 'Walnut Creek',
    state: 'CA',
    type: 'club',
    member_count: 600,
    stage: 'researching',
    owner_email: DARRIN,
    demo_url: 'https://clubmode.ai/demo/tGR3mrj_1jRV9Wq1mBwtJFfDSV_qlzIz',
    next_step: 'Reach Andrew Moran (Facilities) before the new centre opens',
    next_step_at: '2026-09-23',
    notes: [
      'A GRF-owned $4.5M six-court INDOOR centre at 1021 Stanley Dollar Dr opens ~2026;',
      'the Creekside outdoor courts close two weeks later.',
      'No booking system today — a whiteboard, and a number from the front desk.',
      'Schedules are published as PNG images.',
      'Dues $25/year, on Wix.',
      'Four club levels (Novice / Intermediate / Advanced Intermediate / Advanced), NOT DUPR.',
      'ANNUAL MEETING: Oct 28 2026, 1:00–2:30pm, Club Room at Creekside.',
      'The building is owned by the Golden Rain Foundation, so the decision may sit with Rossmoor',
      'management rather than with the club board.',
    ].join('\n'),
    first_activity:
      'Demo environment built and link ready. Board researched from their own board page — no personal addresses are published.',
    contacts: [
      // Titles from their board page. No personal emails are published, so
      // these stay blank on purpose rather than being guessed.
      { full_name: 'Hal Kushins', title: 'President', email: null, phone: '925-818-5941', is_primary: true },
      { full_name: 'Danny Wong', title: 'Vice President; trainer', email: 'dwonga.wong@gmail.com' },
      { full_name: 'Diane Dauner', title: 'Treasurer', email: null },
      { full_name: 'Joyce Decker', title: 'Secretary', email: null },
      { full_name: 'Laurie Greenberg', title: 'Membership', email: null },
      { full_name: 'Cynthia Davis', title: 'Communications', email: null },
      { full_name: 'Andrew Moran', title: 'Facilities', email: null, role: 'champion for the new building' },
      { full_name: 'Natalee Fairbanks', title: 'Director at Large', email: null },
      { full_name: 'Bob Semar', title: 'Parliamentarian', email: null },
      { full_name: 'Patty Andrews', title: 'Trainer', email: 'timpatandrews@gmail.com' },
    ],
  },
  {
    slug: 'lafayette-tennis-club',
    name: 'Lafayette Tennis Club',
    club_slug: 'lafayette-tennis-club',
    website: 'https://lafayettetennis.com',
    city: 'Lafayette',
    state: 'CA',
    type: 'club',
    member_count: null,
    stage: 'pilot',
    owner_email: DARRIN,
    demo_url: 'https://clubmode.ai/demo/P52zZ9Nd5LPnzevxedzFYGczE9jEaGFu',
    next_step: "Check in on Hunter's use of the class editor",
    next_step_at: '2026-09-22',
    notes: [
      'Owner/director Hunter Gallaway is evaluating.',
      'His club site is PUBLISHED and public court booking is LIVE — this is a live pilot,',
      'not a demo.',
      'He was fed up paying someone to change skip dates and prices. That is the pitch.',
    ].join('\n'),
    first_activity:
      'Club site published and public court booking live. Hunter is using the class editor himself.',
    contacts: [
      {
        full_name: 'Hunter Gallaway',
        title: 'Owner & Tennis Director',
        email: 'hunterhg@comcast.net',
        phone: '925-937-2582',
        is_primary: true,
        role: 'decision maker',
      },
    ],
  },
];

// ----------------------------------------------------------- the templates
//
// Four, matching how these deals actually go: a warm intro, a chase, the demo
// link on its own, and the one that gets a board meeting on the calendar.
// Editable in the database afterwards — these are a starting point, not a
// constant.
const TEMPLATES = [
  {
    slug: 'intro-warm',
    name: 'Intro (warm)',
    sort_order: 1,
    subject: 'A question about {{club}}',
    body: [
      'Hi {{first_name}},',
      '',
      "I'm {{rep_name}} — I run tennis at a club not far from you, and I built a piece of software",
      'for the jobs that eat a volunteer board alive: the sign-up sheet, the pairings, the emails',
      'nobody wants to send twice.',
      '',
      'I put together a version of it with {{club}} in it so you can click around rather than sit',
      'through a pitch. No login, nothing to install:',
      '',
      '{{demo_url}}',
      '',
      'If it looks useful I would love fifteen minutes. If it does not, tell me and I will leave you',
      'alone.',
      '',
      'Thanks,',
      '{{rep_name}}',
    ].join('\n'),
  },
  {
    slug: 'follow-up-no-reply',
    name: 'Follow-up (no reply)',
    sort_order: 2,
    subject: 'Following up — {{club}}',
    body: [
      'Hi {{first_name}},',
      '',
      'I wrote a little while back about {{club}} and never heard anything, which usually means',
      'either the timing is wrong or I picked the wrong person. Both are fine — I would just rather',
      'know which.',
      '',
      'The link is still live if you want a look:',
      '',
      '{{demo_url}}',
      '',
      'Thanks,',
      '{{rep_name}}',
    ].join('\n'),
  },
  {
    slug: 'send-the-demo',
    name: 'Send the demo link',
    sort_order: 3,
    subject: 'The {{club}} demo',
    body: [
      'Hi {{first_name}},',
      '',
      'Here is the link I mentioned. It is {{club}} with real-looking data in it, so you can click',
      'anything without breaking anything:',
      '',
      '{{demo_url}}',
      '',
      'It opens on a phone as well as a laptop. Happy to walk you through it if that is easier.',
      '',
      '{{rep_name}}',
    ].join('\n'),
  },
  {
    slug: 'before-the-board',
    name: 'Ask for time before the board meeting',
    sort_order: 4,
    subject: 'Fifteen minutes before your next board meeting?',
    body: [
      'Hi {{first_name}},',
      '',
      'I know the board has a full agenda, so rather than ask for a slot on it, could I have fifteen',
      'minutes with you beforehand? If you think it is worth the board hearing about, you can put it',
      'in front of them yourself — and if not, you have saved everyone the meeting.',
      '',
      'Here is what I would be showing you:',
      '',
      '{{demo_url}}',
      '',
      'Thanks,',
      '{{rep_name}}',
    ].join('\n'),
  },
];

// =====================================================================
const u = new URL(env.DATABASE_URL);
const client = new pg.Client({
  host: u.hostname,
  port: u.port || 5432,
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.slice(1) || 'postgres',
  ssl: { rejectUnauthorized: false },
});
await client.connect();

try {
  // ------------------------------------------------------------ allowlist
  for (const rep of REPS) {
    const { rows } = await client.query('SELECT id FROM auth.users WHERE lower(email) = $1 LIMIT 1', [rep.email]);
    await client.query(
      `INSERT INTO crm_users (email, user_id, full_name, initials, active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (email) DO UPDATE SET
         user_id   = COALESCE(EXCLUDED.user_id, crm_users.user_id),
         full_name = COALESCE(EXCLUDED.full_name, crm_users.full_name),
         initials  = COALESCE(EXCLUDED.initials,  crm_users.initials),
         active    = true`,
      [rep.email, rows[0]?.id ?? null, rep.full_name, rep.initials],
    );
  }

  // ------------------------------------------------------------ templates
  for (const t of TEMPLATES) {
    await client.query(
      `INSERT INTO crm_templates (slug, name, subject, body, sort_order, archived)
       VALUES ($1, $2, $3, $4, $5, false)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name, subject = EXCLUDED.subject,
         body = EXCLUDED.body, sort_order = EXCLUDED.sort_order, archived = false`,
      [t.slug, t.name, t.subject, t.body, t.sort_order],
    );
  }

  // ----------------------------------------------------------------- orgs
  for (const o of ORGS) {
    // The ClubMode club we built them a demo in, when there is one. A pointer
    // out, not a tenant key — see the migration.
    const { rows: club } = await client.query('SELECT id FROM cc_clubs WHERE slug = $1', [o.club_slug]);
    const clubId = club[0]?.id ?? null;
    if (!clubId) console.warn(`  ! no cc_clubs row for ${o.club_slug} — club_id left null`);

    /*
     * Everything except stage and next_step is refreshed on a re-run: those
     * two are what a rep MOVES, and overwriting them would undo the work.
     * A brand-new row gets them from here.
     */
    const { rows: orgRows } = await client.query(
      `INSERT INTO crm_orgs
         (slug, name, club_id, website, city, state, type, member_count, stage,
          owner_email, demo_url, next_step, next_step_at, notes, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name, club_id = EXCLUDED.club_id, website = EXCLUDED.website,
         city = EXCLUDED.city, state = EXCLUDED.state, type = EXCLUDED.type,
         member_count = EXCLUDED.member_count, owner_email = EXCLUDED.owner_email,
         demo_url = EXCLUDED.demo_url, notes = EXCLUDED.notes
       RETURNING id`,
      [
        o.slug, o.name, clubId, o.website, o.city, o.state, o.type, o.member_count, o.stage,
        o.owner_email, o.demo_url, o.next_step, o.next_step_at, o.notes, 'researched',
      ],
    );
    const orgId = orgRows[0].id;

    // -------------------------------------------------------- contacts
    for (const c of o.contacts) {
      await client.query(
        `INSERT INTO crm_contacts (org_id, full_name, title, email, phone, role, is_primary, notes)
         SELECT $1,$2,$3,$4,$5,$6,$7,$8
         WHERE NOT EXISTS (
           SELECT 1 FROM crm_contacts
           WHERE org_id = $1 AND lower(btrim(full_name)) = lower(btrim($2))
         )`,
        [orgId, c.full_name, c.title ?? null, c.email ?? null, c.phone ?? null, c.role ?? null, c.is_primary === true, c.notes ?? null],
      );
    }

    // -------------------------------------------------------- activity
    // One row per org saying where we got to, recognised on a re-run by its
    // own text so it is written exactly once.
    await client.query(
      `INSERT INTO crm_activities (org_id, kind, body, occurred_at, created_by_email)
       SELECT $1, 'note', $2, $3::date + time '12:00' AT TIME ZONE 'America/Los_Angeles', $4
       WHERE NOT EXISTS (SELECT 1 FROM crm_activities WHERE org_id = $1 AND body = $2)`,
      [orgId, o.first_activity, TODAY, DARRIN],
    );
  }

  // ----------------------------------------------------------------- counts
  const { rows: counts } = await client.query(`
    SELECT
      (SELECT count(*) FROM crm_users      WHERE active)  AS reps,
      (SELECT count(*) FROM crm_orgs)                     AS orgs,
      (SELECT count(*) FROM crm_contacts)                 AS contacts,
      (SELECT count(*) FROM crm_contacts WHERE email IS NOT NULL) AS contacts_with_email,
      (SELECT count(*) FROM crm_activities)               AS activities,
      (SELECT count(*) FROM crm_templates WHERE NOT archived) AS templates
  `);
  console.table(counts);
  const { rows: byOrg } = await client.query(`
    SELECT o.name, o.stage, o.next_step_at, count(c.id) AS contacts,
           o.club_id IS NOT NULL AS demo_linked
    FROM crm_orgs o LEFT JOIN crm_contacts c ON c.org_id = o.id
    GROUP BY o.id ORDER BY o.name
  `);
  console.table(byOrg);
} catch (e) {
  console.error('FAILED:', e.message);
  process.exitCode = 1;
}

await client.end();

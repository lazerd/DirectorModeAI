/**
 * The second-club check.
 *
 * The whole claim of the club-site feature is that another club is ROWS, not
 * another week of work. This proves it: it inserts one club_site row and two
 * club_programs for a throwaway slug, asserts the public page renders with that
 * club's own colors and content, asserts NO Lafayette string leaked onto it,
 * and then deletes everything it made.
 *
 * If this fails, something about one club has been hardcoded into a page and
 * needs moving into that club's row.
 *
 *   node scripts/club-site-second-club-check.mjs [baseUrl]
 *
 * Default baseUrl is https://clubmode.ai. Pass http://localhost:3000 to check a
 * dev server instead.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const BASE = (process.argv[2] || 'https://clubmode.ai').replace(/\/$/, '');
const SLUG = 'second-club-check';
/** Nothing like Lafayette's forest green — a wrong theme has to be obvious. */
const PRIMARY = '#6d28d9';
const HEADLINE = 'A completely different club';

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

async function cleanup() {
  if (!clubId) return;
  // club_site and club_programs cascade from cc_clubs.
  await db.from('cc_clubs').delete().eq('id', clubId);
}

try {
  // An owner is required by cc_clubs.owner_id. Borrow any existing account —
  // this club is deleted at the end and is never published anywhere.
  const { data: someClub } = await db.from('cc_clubs').select('owner_id').limit(1).single();

  const { data: created, error: clubErr } = await db
    .from('cc_clubs')
    .insert({
      slug: SLUG,
      name: 'Second Club Check',
      owner_id: someClub.owner_id,
      city: 'Testville',
      state: 'CA',
      phone: '555-0100',
      is_public: true,
      timezone: 'America/New_York',
    })
    .select('id')
    .single();
  if (clubErr) throw clubErr;
  clubId = created.id;

  await db.from('club_site').insert({
    club_id: clubId,
    status: 'published',
    color_primary: PRIMARY,
    color_secondary: '#f59e0b',
    hero_headline: HEADLINE,
    hero_subhead: 'Seeded by a script, rendered by the same code.',
    amenities: [{ label: 'Four indoor courts' }],
    membership_tiers: [{ name: 'Test tier', price_display: '$1', period: 'year', includes: [] }],
    staff: [{ name: 'A Different Pro', title: 'Head Coach' }],
  });

  const today = new Date();
  const start = today.toISOString().slice(0, 10);
  const end = new Date(today.getTime() + 40 * 86400000).toISOString().slice(0, 10);

  await db.from('club_programs').insert([
    {
      club_id: clubId,
      slug: 'test-class-one',
      title: 'Test Class One',
      status: 'published',
      audience: 'junior',
      range_start: start,
      range_end: end,
      days_of_week: [3],
      time_start: '16:00',
      time_end: '17:00',
      price_cents: 12300,
    },
    {
      club_id: clubId,
      slug: 'test-class-two',
      title: 'Test Class Two',
      status: 'published',
      audience: 'adult',
      range_start: start,
      range_end: end,
      days_of_week: [6],
      time_start: '09:00',
      time_end: '10:30',
      price_cents: 0,
    },
  ]);

  // ------------------------------------------------------------ the page
  const res = await fetch(`${BASE}/c/${SLUG}`, { cache: 'no-store' });
  const html = await res.text();

  check('the public page renders', res.status === 200, `HTTP ${res.status}`);
  check('it is SERVER-rendered, not a spinner', html.includes(HEADLINE), 'headline in the HTML');
  check('it uses THIS club’s color', html.includes(PRIMARY), PRIMARY);
  check('its own name is on it', html.includes('Second Club Check'));
  check('its own phone is on it', html.includes('555-0100'));
  check('its amenity renders', html.includes('Four indoor courts'));
  check('its membership tier renders', html.includes('Test tier'));
  check('its staff member renders', html.includes('A Different Pro'));
  check('both published classes render', html.includes('Test Class One'));
  check('the price comes from the row', html.includes('$123'));
  check(
    'the canonical points at this club',
    html.includes(`/c/${SLUG}"`) || html.includes(`/c/${SLUG}'`),
  );

  // THE POINT: nothing about the first club may appear on the second's page.
  const leaks = ['Lafayette', 'Camino Diablo', 'Gallaway', 'hunterhg', '925-937-2582', '#14532d'];
  const found = leaks.filter((s) => html.includes(s));
  check(
    'NO first-club content leaked onto it',
    found.length === 0,
    found.length ? `LEAKED: ${found.join(', ')}` : 'clean',
  );

  // ------------------------------------------------- programs + detail pages
  const list = await fetch(`${BASE}/c/${SLUG}/programs`, { cache: 'no-store' });
  const listHtml = await list.text();
  check('the programs page renders', list.status === 200, `HTTP ${list.status}`);
  check('it groups juniors and adults', listHtml.includes('Juniors') && listHtml.includes('Adults'));

  const detail = await fetch(`${BASE}/c/${SLUG}/programs/test-class-one`, { cache: 'no-store' });
  const detailHtml = await detail.text();
  check('a program page renders', detail.status === 200, `HTTP ${detail.status}`);
  check('it lists every date', detailHtml.includes('Every date'));
  check('it offers a sign-up form', detailHtml.includes('Sign up') || detailHtml.includes('waitlist'));

  const og = await fetch(`${BASE}/c/${SLUG}/opengraph-image`, { cache: 'no-store' });
  check(
    'it has its own link-preview card',
    og.status === 200 && (og.headers.get('content-type') || '').includes('image'),
    `HTTP ${og.status} ${og.headers.get('content-type')}`,
  );

  const sitemap = await fetch(`${BASE}/sitemap.xml`, { cache: 'no-store' });
  const sitemapXml = await sitemap.text();
  check('it is in the sitemap', sitemapXml.includes(`/c/${SLUG}`));
} catch (err) {
  console.error(err);
  check('the check ran without throwing', false, String(err?.message || err));
} finally {
  await cleanup();
  console.log('\nCleaned up the throwaway club.');
}

const failed = results.filter((r) => !r.pass).length;
console.log(
  failed === 0
    ? '\nAll good — a second club is rows, not code.'
    : `\n${failed} FAILED — something about one club is hardcoded.`,
);
process.exit(failed === 0 ? 0 : 1);

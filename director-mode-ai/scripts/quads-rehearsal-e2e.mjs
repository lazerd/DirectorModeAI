/**
 * Full Quads event rehearsal, driven in a real browser against production.
 *
 *   node scripts/quads-rehearsal-e2e.mjs            run it (resets the rehearsal first)
 *   node scripts/quads-rehearsal-e2e.mjs reset      just put the rehearsal back to "entries only"
 *
 * Works ONLY on the event with slug `dunkin-quads-rehearsal` — 12 fake players
 * ("Test Ava 10U" …) with no email or phone, dated in the past so auto-schedule
 * can't put anything on a live court sheet day. It asserts all of that before
 * it clicks anything. Sign-in is a service-role magic link turned into the
 * @supabase/ssr cookie (same as deck-e2e.mjs) — no password anywhere.
 *
 * Three flights, three ways of scoring:
 *   10U  director enters every score in the Matches tab, the LAST singles
 *        decides the doubles pairing, then a correction re-pairs it.
 *   12U  every score comes in through the players' own scoring pages; the
 *        singles ladder has a three-way head-to-head circle.
 *   13O  director again; the doubles result swings the overall winner away
 *        from the singles winner.
 * About half the scores are typed winner-first ("4-1" for a side-B win), the
 * way Darrin typed them on 9/29 — that exposed games being credited to the
 * loser. Expected standings below were worked out by hand, not by the app.
 */
import pg from 'pg';
import { readFileSync, mkdirSync } from 'fs';
import { pathToFileURL } from 'url';

const PW = process.env.PLAYWRIGHT_DIR || 'C:/Users/darri/court-booker/node_modules/playwright';
const pwMod = await import(pathToFileURL(`${PW}/index.js`).href);
const chromium = pwMod.chromium ?? pwMod.default?.chromium;

const APP = process.env.APP || 'https://clubmode.ai';
const SLUG = 'dunkin-quads-rehearsal';
const SHOTS = process.env.SHOTS || './.quads-shots';
mkdirSync(SHOTS, { recursive: true });

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')])
);
const u = new URL(env.DATABASE_URL);
const db = new pg.Client({
  host: u.hostname,
  port: u.port || 5432,
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.slice(1) || 'postgres',
  ssl: { rejectUnauthorized: false },
});
await db.connect();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;

// ---------- safety + reset ----------
const [ev] = await q(`select id, event_date, user_id from events where slug = $1`, [SLUG]);
if (!ev) throw new Error(`No ${SLUG} event — create it first.`);
const ents = await q(`select * from quad_entries where event_id = $1`, [ev.id]);
if (ents.length !== 12) throw new Error(`Expected 12 rehearsal entries, found ${ents.length}`);
for (const e of ents) {
  if (!e.player_name.startsWith('Test ') || e.player_email || e.parent_email || e.player_phone || e.parent_phone) {
    throw new Error(`Refusing: ${e.player_name} is not a contactless fake player`);
  }
}
if (new Date(ev.event_date) >= new Date(new Date().toDateString())) {
  throw new Error('Refusing: rehearsal must be dated in the past (court sheet safety)');
}

// Take the rehearsal's matches back off the court sheet (dated in the past, but tidy).
const clearCourtSheet = () =>
  q(
    `delete from reservations where source = 'quads' and source_id::text in
       (select m.id::text from quad_matches m join quad_flights f on f.id = m.flight_id where f.event_id = $1)`,
    [ev.id]
  );

async function reset() {
  await clearCourtSheet();
  await q(`delete from quad_flights where event_id = $1`, [ev.id]);
  await q(`update quad_entries set flight_id = null, flight_seed = null, position = 'in_flight' where event_id = $1`, [ev.id]);
  await q(`update events set public_status = 'open' where id = $1`, [ev.id]);
}
await reset();
if (process.argv[2] === 'reset') {
  console.log('Rehearsal reset: 12 fake players, no flights.');
  await db.end();
  process.exit(0);
}

// ---------- session ----------
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const [owner] = await q(`select email from auth.users where id = $1`, [ev.user_id]);
const gen = await (
  await fetch(`${SB}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { apikey: KEY, authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: owner.email }),
  })
).json();
const s = await (
  await fetch(`${SB}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: gen.hashed_token }),
  })
).json();
if (!s.access_token) throw new Error('could not mint a session');
const ref = new URL(SB).hostname.split('.')[0];
const cookieValue =
  'base64-' +
  Buffer.from(
    JSON.stringify({
      access_token: s.access_token,
      token_type: 'bearer',
      expires_in: s.expires_in,
      expires_at: s.expires_at,
      refresh_token: s.refresh_token,
      user: s.user,
    })
  ).toString('base64');
// @supabase/ssr chunks cookies over ~3180 chars.
const CHUNK = 3180;
const host = new URL(APP).hostname;
const cookies =
  cookieValue.length <= CHUNK
    ? [{ name: `sb-${ref}-auth-token`, value: cookieValue }]
    : Array.from({ length: Math.ceil(cookieValue.length / CHUNK) }, (_, i) => ({
        name: `sb-${ref}-auth-token.${i}`,
        value: cookieValue.slice(i * CHUNK, (i + 1) * CHUNK),
      }));

// ---------- checks ----------
const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass });
  console.log(`${pass ? '  PASS' : '  FAIL'}  ${label}${detail ? `  - ${detail}` : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.addCookies(cookies.map((c) => ({ ...c, domain: host, path: '/', sameSite: 'Lax', secure: true })));
const page = await ctx.newPage();
const dialogs = [];
page.on('dialog', async (d) => {
  dialogs.push(`${d.type()}: ${d.message()}`);
  if (d.type() === 'alert') console.log(`    [alert] ${d.message()}`);
  await d.accept();
});
page.on('console', (m) => m.type() === 'error' && console.log('    [console]', m.text().slice(0, 160)));
let shot = 0;
const snap = async (name, p = page) => p.screenshot({ path: `${SHOTS}/${String(++shot).padStart(2, '0')}-${name}.png`, fullPage: true });

const N = (short, div) => `Test ${short} ${div}`;

try {
  console.log('\n-- Flights --');
  await page.goto(`${APP}/mixer/events/${ev.id}?tab=flights`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Generate flights/ }).click();
  await page.getByText('Flights are set').waitFor({ timeout: 30000 });
  await snap('flights');
  const flights = await q(
    `select f.id, f.name, f.sort_order, array_agg(e.player_name order by e.flight_seed) players
       from quad_flights f join quad_entries e on e.flight_id = f.id
      where f.event_id = $1 group by f.id order by f.sort_order`,
    [ev.id]
  );
  check('3 flights, one per division', flights.length === 3, flights.map((f) => f.name).join(' / '));
  check(
    'seeded by rating inside each division',
    JSON.stringify(flights.map((f) => f.players)) ===
      JSON.stringify([
        ['Ava', 'Ben', 'Cal', 'Dee'].map((x) => N(x, '10U')),
        ['Eli', 'Fay', 'Gus', 'Hal'].map((x) => N(x, '12U')),
        ['Ivy', 'Jon', 'Kit', 'Lou'].map((x) => N(x, '13O')),
      ])
  );

  console.log('\n-- Auto-schedule --');
  await page.getByRole('button', { name: 'View matches' }).click();
  await page.getByRole('button', { name: /Auto-schedule matches/ }).click();
  await page.waitForTimeout(4000);
  await page.waitForLoadState('networkidle');
  const sched = await q(
    `select f.sort_order, m.round, m.court, to_char(m.scheduled_at, 'HH24:MI') t
       from quad_matches m join quad_flights f on f.id = m.flight_id
      where f.event_id = $1 order by 1, 2, 3`,
    [ev.id]
  );
  const courtsOf = (fo) => [...new Set(sched.filter((r) => r.sort_order === fo).map((r) => r.court))].join(',');
  check('10U on courts 1+2, 12U on 3+4, 13&O on 5+6', courtsOf(0) === '1,2' && courtsOf(1) === '3,4' && courtsOf(2) === '5,6', `${courtsOf(0)} | ${courtsOf(1)} | ${courtsOf(2)}`);
  const times = [...new Set(sched.map((r) => `${r.round}@${r.t}`))].join(' ');
  check('rounds at 12:00 / 12:30 / 1:00, all flights together', times === '1@12:00 2@12:30 3@13:00', times);
  await snap('scheduled');

  // Director score entry through the Matches tab UI.
  async function directorScore(a, b, winnerName, score, { edit = false } = {}) {
    const row = page
      .locator('div.rounded-lg.p-2')
      .filter({ hasText: a })
      .filter({ hasText: b })
      .filter({ hasNotText: ' + ' });
    await row.getByRole('button', { name: edit ? /Edit/ : /Enter Score/ }).click();
    const form = page.locator('div.border-orange-200.bg-orange-50.p-3:visible').filter({ has: page.getByPlaceholder(/Score/) }).first();
    await form.getByRole('button', { name: `${winnerName} won` }).click();
    await form.getByPlaceholder(/Score/).fill(score);
    await form.getByRole('button', { name: 'Save' }).click();
    await form.waitFor({ state: 'detached', timeout: 20000 });
    await page.waitForLoadState('networkidle');
  }
  async function directorDoubles(winnerTeamText, score) {
    const row = page.locator('div.rounded-lg.p-2').filter({ hasText: winnerTeamText });
    await row.getByRole('button', { name: /Enter Score/ }).click();
    const form = page.locator('div.border-orange-200.bg-orange-50.p-3:visible').filter({ has: page.getByPlaceholder(/Score/) }).first();
    await form.getByRole('button', { name: winnerTeamText }).click();
    await form.getByPlaceholder(/Score/).fill(score);
    await form.getByRole('button', { name: 'Save' }).click();
    await form.waitFor({ state: 'detached', timeout: 20000 });
    await page.waitForLoadState('networkidle');
  }
  const doublesRow = async (flightOrder) =>
    (
      await q(
        `select m.*, to_char(m.scheduled_at,'HH24:MI') t,
                (select player_name from quad_entries where id = m.player1_id) a1,
                (select player_name from quad_entries where id = m.player2_id) a2,
                (select player_name from quad_entries where id = m.player3_id) b1,
                (select player_name from quad_entries where id = m.player4_id) b2
           from quad_matches m join quad_flights f on f.id = m.flight_id
          where f.event_id = $1 and f.sort_order = $2 and m.match_type = 'doubles'`,
        [ev.id, flightOrder]
      )
    );
  const teams = (d) => [[d.a1, d.a2].sort().join('+'), [d.b1, d.b2].sort().join('+')].sort().join(' vs ');
  const want = (x, y, z, w) => [[x, y].sort().join('+'), [z, w].sort().join('+')].sort().join(' vs ');

  console.log('\n-- 10U: director scoring --');
  const T = (x) => N(x, '10U');
  await directorScore(T('Ava'), T('Dee'), T('Ava'), '4-1');
  await directorScore(T('Ben'), T('Cal'), T('Ben'), '4-2');
  await directorScore(T('Ava'), T('Cal'), T('Ava'), '4-2');
  await directorScore(T('Ben'), T('Dee'), T('Ben'), '4-3');
  await directorScore(T('Ava'), T('Ben'), T('Ava'), '4-0');
  check('no doubles before the last singles', (await doublesRow(0)).length === 0);
  await directorScore(T('Cal'), T('Dee'), T('Dee'), '4-1'); // last singles: Dee wins
  let d10 = await doublesRow(0);
  check('doubles created by the director\'s last score', d10.length === 1);
  check('pairing counts that last score: Ava+Cal vs Ben+Dee', d10[0] && teams(d10[0]) === want(T('Ava'), T('Cal'), T('Ben'), T('Dee')), d10[0] && teams(d10[0]));
  check('doubles placed on court 1 at 1:30', d10[0]?.court === '1' && d10[0]?.t === '13:30', `${d10[0]?.court} @ ${d10[0]?.t}`);
  const onScreen = await page.locator('div.rounded-lg.p-2').filter({ hasText: ' + ' }).first().innerText().catch(() => '');
  check('doubles row shows on the Matches tab', onScreen.includes('Ava') && onScreen.includes('Dee'));
  await snap('10u-doubles-created');

  await directorScore(T('Cal'), T('Dee'), T('Cal'), '4-2', { edit: true }); // correction: Cal actually won
  d10 = await doublesRow(0);
  check('correction re-pairs the unplayed doubles: Ava+Dee vs Ben+Cal', d10.length === 1 && teams(d10[0]) === want(T('Ava'), T('Dee'), T('Ben'), T('Cal')), d10[0] && teams(d10[0]));
  check('re-pair kept its court + time', d10[0]?.court === '1' && d10[0]?.t === '13:30');
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await directorDoubles(`${T('Ben')} + ${T('Cal')}`, '4-3');
  const scrollAfter = await page.evaluate(() => window.scrollY);
  check('saving a score keeps your place on the page', scrollBefore > 200 && Math.abs(scrollAfter - scrollBefore) < 400, `${scrollBefore} -> ${scrollAfter}`);
  await snap('10u-final');

  console.log('\n-- 13&O: director scoring --');
  const O = (x) => N(x, '13O');
  await directorScore(O('Ivy'), O('Lou'), O('Ivy'), '4-0');
  await directorScore(O('Jon'), O('Kit'), O('Jon'), '4-2');
  await directorScore(O('Ivy'), O('Kit'), O('Ivy'), '4-1');
  await directorScore(O('Jon'), O('Lou'), O('Jon'), '4-1');
  await directorScore(O('Ivy'), O('Jon'), O('Jon'), '4-3');
  await directorScore(O('Kit'), O('Lou'), O('Kit'), '4-3');
  const d13 = await doublesRow(2);
  check('13&O pairing Jon+Lou vs Ivy+Kit, court 5 @ 1:30', d13.length === 1 && teams(d13[0]) === want(O('Jon'), O('Lou'), O('Ivy'), O('Kit')) && d13[0].court === '5' && d13[0].t === '13:30', d13[0] && `${teams(d13[0])} ${d13[0].court}@${d13[0].t}`);
  await directorDoubles(`${O('Ivy')} + ${O('Kit')}`, '4-1');

  console.log('\n-- 12U: players score from their own links --');
  const Y = (x) => N(x, '12U');
  const tok = Object.fromEntries(
    (await q(`select player_name, player_token from quad_entries where event_id = $1 and division = '12u'`, [ev.id])).map((r) => [r.player_name, r.player_token])
  );
  const pp = await ctx.newPage();
  pp.on('dialog', (d) => d.accept());
  async function playerScore(reporter, opponent, winnerLabelStart, score) {
    await pp.goto(`${APP}/quads/player/${tok[reporter]}`, { waitUntil: 'networkidle' });
    const card = pp.locator('div.rounded-xl.p-4').filter({ hasText: opponent }).filter({ hasText: 'Singles' });
    await card.getByRole('button', { name: 'Enter Score' }).click();
    await card.getByRole('button', { name: new RegExp(`^${winnerLabelStart}.* won$`) }).click();
    await card.getByPlaceholder(/Score/).fill(score);
    await card.getByRole('button', { name: /Submit|Save/ }).click();
    await pp.waitForLoadState('networkidle');
    await card.getByText('Reported').waitFor({ timeout: 20000 });
  }
  // Seeds Eli1 Fay2 Gus3 Hal4. Some scores are typed winner-first, some
  // left-player-first — people do both, and both must count the same.
  await playerScore(Y('Hal'), Y('Eli'), Y('Hal'), '4-2'); // R1 Hal beats Eli
  await playerScore(Y('Fay'), Y('Gus'), Y('Fay'), '4-1');
  await playerScore(Y('Eli'), Y('Gus'), Y('Eli'), '4-2');
  await playerScore(Y('Hal'), Y('Fay'), Y('Fay'), '4-0');
  await playerScore(Y('Eli'), Y('Fay'), Y('Fay'), '4-3');
  await snap('12u-player-page', pp);
  await playerScore(Y('Gus'), Y('Hal'), Y('Gus'), '4-2'); // circle: Eli>Gus>Hal>Eli
  const d12 = await doublesRow(1);
  check('12U doubles created from a player\'s score: Fay+Hal vs Eli+Gus', d12.length === 1 && teams(d12[0]) === want(Y('Fay'), Y('Hal'), Y('Eli'), Y('Gus')), d12[0] && teams(d12[0]));
  check('12U doubles on court 3 @ 1:30', d12[0]?.court === '3' && d12[0]?.t === '13:30', `${d12[0]?.court} @ ${d12[0]?.t}`);
  await pp.goto(`${APP}/quads/player/${tok[Y('Hal')]}`, { waitUntil: 'networkidle' });
  const dblCard = pp.locator('div.rounded-xl.p-4').filter({ hasText: 'Round 4 · Doubles' });
  check('doubles appears on the player\'s page with court + time', (await dblCard.count()) === 1 && /1:30/.test(await dblCard.innerText()) && /Court 3/.test(await dblCard.innerText()));
  await dblCard.getByRole('button', { name: 'Enter Score' }).click();
  await dblCard.getByRole('button', { name: new RegExp(`${Y('Eli')}.*won$`) }).click();
  await dblCard.getByPlaceholder(/Score/).fill('4-2');
  await dblCard.getByRole('button', { name: /Submit|Save/ }).click();
  await dblCard.getByText('Reported').waitFor({ timeout: 20000 });
  await snap('12u-doubles-reported', pp);

  console.log('\n-- Standings on the Matches tab --');
  // No reload: the director's tab should pick up the players' scores by itself.
  await page.locator('text=Final — most games wins').nth(2).waitFor({ timeout: 45000 }).catch(() => {});
  const boards = await page.locator('text=Final — most games wins').count();
  check('director screen picks up the players scores on its own (no reload)', boards === 3, `${boards} final boards`);
  await snap('matches-final');

  console.log('\n-- Complete + public results --');
  await page.getByRole('button', { name: /Complete tournament/ }).click();
  await page.waitForURL(/\/results/, { timeout: 30000 });
  await page.waitForLoadState('networkidle');
  await snap('results');
  const body = await page.locator('body').innerText();
  // Hand-worked finals (games across all 4 rounds):
  //   10U  Ava 15, Ben 12 (3 wins), Cal 12 (2 wins), Dee 9
  //   12U  Fay 14, Eli 13, Gus 11, Hal 8
  //   13O  Ivy 15, Jon 13, Kit 11, Lou 5   ← doubles beat the singles winner
  // Each standings row reads "<name> … 1st place · doubles with …" — map name → place.
  const place = {};
  for (const m of body.matchAll(/(Test \w+ (?:10U|12U|13O))\s*(1st|2nd|3rd|4th) place/g)) place[m[1]] ??= m[2];
  const placed = (names) => names.every((n, i) => place[n] === ['1st', '2nd', '3rd', '4th'][i]);
  const show = (names) => names.map((n) => `${n.split(' ')[1]}=${place[n] ?? '?'}`).join(' ');
  const R10 = [T('Ava'), T('Ben'), T('Cal'), T('Dee')];
  const R12 = [Y('Fay'), Y('Eli'), Y('Gus'), Y('Hal')];
  const R13 = [O('Ivy'), O('Jon'), O('Kit'), O('Lou')];
  check('10U: Ava, Ben, Cal, Dee (Ben over Cal on match wins)', placed(R10), show(R10));
  check('12U: Fay, Eli, Gus, Hal', placed(R12), show(R12));
  check('13&O: Ivy, Jon, Kit, Lou (doubles decides it)', placed(R13), show(R13));
  for (const [who, games] of [[T('Ava'), 15], [Y('Fay'), 14], [O('Ivy'), 15]]) {
    const re = new RegExp(`${who}[\\s\\S]{0,200}?${games}\\s*games`);
    check(`champion ${who} shown with ${games} games`, re.test(body));
  }
  const [{ status }] = await q(`select public_status status from events where id = $1`, [ev.id]);
  check('event marked completed', status === 'completed');
  const dupes = await q(
    `select count(*)::int n from quad_matches m join quad_flights f on f.id = m.flight_id where f.event_id = $1 and m.match_type = 'doubles'`,
    [ev.id]
  );
  check('exactly one doubles per flight', dupes[0].n === 3, `${dupes[0].n}`);
  const unexpected = dialogs.filter((d) => d.startsWith('alert'));
  check('no error alerts shown to the director', unexpected.length === 0, unexpected.join(' | '));
} catch (err) {
  console.log(`\n  FAIL  script stopped: ${err.message.split('\n')[0]}`);
  results.push({ label: 'script ran to the end', pass: false });
  await snap('crash').catch(() => {});
} finally {
  await browser.close();
  await clearCourtSheet().catch((e) => console.log('    court sheet cleanup:', e.message));
  await db.end();
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed. Screenshots in ${SHOTS}`);
process.exit(failed ? 1 : 0);

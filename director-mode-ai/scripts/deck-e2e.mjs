/**
 * Drive the outreach swipe deck end to end, in a real browser.
 *
 *   npm start                                  (in another shell)
 *   node scripts/outreach-fake-deck.mjs seed
 *   node scripts/deck-e2e.mjs
 *   node scripts/outreach-fake-deck.mjs clean
 *
 * Playwright is not a dependency of this app — it lives in the court-booker
 * toolbox next door, and is loaded from there by absolute path. PLAYWRIGHT_DIR
 * overrides it.
 *
 * SIGNING IN: there is no stored password for Darrin anywhere, and asking for
 * one in chat is off limits. So this mints a magic link with the service-role
 * key, exchanges it for a session, and writes the @supabase/ssr cookie into
 * the browser context directly. Nothing is typed into a login form.
 *
 * SAFETY: every club it touches is a `zz-fake-outreach-*` row whose address is
 * .invalid or example.com, and it asserts that before it swipes on anything.
 * A right swipe here sets a queue row to `approved` and stops — the sender is
 * a separate cron with its own window and cap, so this script cannot mail
 * anyone even if it wanted to.
 */
import { readFileSync, mkdirSync } from 'fs';
import { pathToFileURL } from 'url';

const PW = process.env.PLAYWRIGHT_DIR || 'C:/Users/darri/court-booker/node_modules/playwright';
// Playwright is CJS, so the named export may or may not be detected across
// node versions — take whichever half of the namespace actually has it.
const pw = await import(pathToFileURL(`${PW}/index.js`).href);
const chromium = pw.chromium ?? pw.default?.chromium;

const APP = process.env.APP || 'http://localhost:3000';
const SHOTS = process.env.SHOTS || './.deck-shots';
mkdirSync(SHOTS, { recursive: true });

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL = process.env.DECK_E2E_EMAIL || 'darrinjco@gmail.com';

async function session() {
  const gen = await fetch(`${SB}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { apikey: KEY, authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: EMAIL }),
  });
  const link = await gen.json();
  if (!link.hashed_token) throw new Error(`generate_link: ${JSON.stringify(link).slice(0, 300)}`);
  const ver = await fetch(`${SB}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: KEY, 'content-type': 'application/json' },
    // `token_hash`, not `token`: generate_link returns the HASH, and passing
    // it as a plain token is hashed again and rejected as otp_expired.
    body: JSON.stringify({ type: 'magiclink', token_hash: link.hashed_token }),
  });
  const s = await ver.json();
  if (!s.access_token) throw new Error(`verify: ${JSON.stringify(s).slice(0, 300)}`);
  return s;
}

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass, detail });
  console.log(`${pass ? '  PASS' : '  FAIL'}  ${label}${detail ? `  - ${detail}` : ''}`);
};

const s = await session();
const ref = new URL(SB).hostname.split('.')[0];
const cookie = {
  name: `sb-${ref}-auth-token`,
  value:
    'base64-' +
    Buffer.from(
      JSON.stringify({
        access_token: s.access_token,
        token_type: 'bearer',
        expires_in: s.expires_in,
        expires_at: s.expires_at,
        refresh_token: s.refresh_token,
        user: s.user,
      }),
    ).toString('base64'),
  domain: 'localhost',
  path: '/',
  httpOnly: false,
  secure: false,
  sameSite: 'Lax',
  expires: Math.floor(Date.now() / 1000) + 3600,
};

const browser = await chromium.launch();

async function run(label, width, height, deep) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    hasTouch: width < 600,
    isMobile: width < 600,
  });
  await ctx.addCookies([cookie]);
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && console.log('    [console]', m.text().slice(0, 160)));

  console.log(`\n-- ${label} (${width}x${height}) --`);
  await page.goto(`${APP}/crm/deck`, { waitUntil: 'networkidle' });
  const shot = (n) => page.screenshot({ path: `${SHOTS}/${label}-${n}.png` });

  const card = page.getByTestId('deck-card');
  const visible = await card.isVisible().catch(() => false);
  check('the deck rendered a card', visible);
  await shot('1-card');
  if (!visible) {
    console.log('    page text:', ((await page.textContent('body')) || '').slice(0, 300));
    await ctx.close();
    return;
  }

  const name = (await card.locator('h2').textContent()) || '';
  // The guard rail: this script must never swipe on a real Directors Club row.
  check('the card is a fake club, never a real one', name.startsWith('Zed'), name);
  if (!name.startsWith('Zed')) {
    await ctx.close();
    return;
  }
  check('the why line is there', ((await page.getByTestId('deck-why').textContent()) || '').includes('region'));
  const body = (await page.getByTestId('deck-body').inputValue()) || '';
  check('the email is the whole email', body.includes('Worth 15 minutes?'), `${body.split(/\s+/).length} words`);
  check('progress reads N of M today', /\d+ of \d+ today/.test((await page.getByTestId('deck-progress').textContent()) || ''));
  check('no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

  // The app's global "Ask ClubMode" button is fixed in the bottom-right
  // corner. Approve is the primary action and must be fully tappable under it.
  const overlap = await page.evaluate(() => {
    const approve = document.querySelector('[data-testid="deck-approve"]');
    if (!approve) return 'no approve button';
    const a = approve.getBoundingClientRect();
    for (const el of Array.from(document.querySelectorAll('button, a'))) {
      if (el === approve || approve.contains(el)) continue;
      const s = getComputedStyle(el);
      if (s.position !== 'fixed' || s.visibility === 'hidden' || s.display === 'none') continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.left < a.right && r.right > a.left && r.top < a.bottom && r.bottom > a.top) {
        return `${(el.textContent || el.className || 'a fixed control').trim().slice(0, 40)} covers it`;
      }
    }
    return '';
  });
  check('nothing fixed covers the Approve button', overlap === '', overlap);

  if (!deep) {
    await ctx.close();
    return;
  }

  console.log('  . edit');
  await page.keyboard.press('e');
  check('E puts the cursor in the body', await page.getByTestId('deck-body').evaluate((el) => el === document.activeElement));
  await page.getByTestId('deck-body').fill(body.replace('Worth 15 minutes?', 'Edited by the test. Worth 15 minutes?'));
  await page.getByTestId('deck-body').blur();
  check('the card shows it was edited', ((await card.textContent()) || '').includes('edited'));
  await shot('2-edited');

  console.log('  . right swipe -> approve');
  const box = await card.boundingBox();
  const y = box.y + 55;
  await page.mouse.move(box.x + box.width * 0.35, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width * 0.35 + i * 28, y, { steps: 2 });
  await shot('3-mid-swipe');
  await page.mouse.up();
  await page.waitForTimeout(1200);
  const toast1 = (await page.getByTestId('deck-toast').textContent().catch(() => '')) || '';
  check('a right swipe approves', /Approved/i.test(toast1), toast1);
  // The toast must never claim a send. Approving queues; the cron sends.
  check('it says when it goes out, never that it went', !/\bSent\b/.test(toast1), toast1);
  await shot('4-approved');

  const deckJson = await fetch(`${APP}/api/outreach/deck`, {
    headers: { cookie: `${cookie.name}=${cookie.value}` },
  }).then((r) => r.json());
  check('the approved card left the deck', !JSON.stringify(deckJson.cards).includes(name), `${deckJson.cards.length} left`);

  console.log('  . left arrow -> skip, with a reason');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(300);
  check('it asks for a reason', await page.getByTestId('deck-reason').isVisible().catch(() => false));
  await shot('5-reason');
  await page.getByText('Too small', { exact: true }).click();
  await page.waitForTimeout(1200);
  const toast2 = (await page.getByTestId('deck-toast').textContent().catch(() => '')) || '';
  check('the skip records the reason', /Too small/i.test(toast2), toast2);
  await shot('6-skipped');

  console.log('  . U -> undo');
  check('an undo is offered', await page.getByTestId('deck-undo').isVisible().catch(() => false));
  const before = await fetch(`${APP}/api/outreach/deck`, { headers: { cookie: `${cookie.name}=${cookie.value}` } }).then((r) => r.json());
  await page.keyboard.press('u');
  await page.waitForTimeout(2500);
  // Assert the STATE, not the toast: the toast is on a 2.2s timer and racing
  // it produces a test that fails on a slow machine and passes on a fast one.
  const after = await fetch(`${APP}/api/outreach/deck`, { headers: { cookie: `${cookie.name}=${cookie.value}` } }).then((r) => r.json());
  check('undo puts the card back on the pile', after.cards.length === before.cards.length + 1, `${before.cards.length} -> ${after.cards.length}`);
  check('undo lifts the suppression it created', JSON.stringify(after.cards).includes('Zed Harbor'), 'the skipped club is proposable again');
  await shot('7-undone');

  console.log('  . to the end');
  for (let i = 0; i < 6; i++) {
    if (await page.getByTestId('deck-end').isVisible().catch(() => false)) break;
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(300);
    await page.getByTestId('deck-skip-noreason').click().catch(() => {});
    await page.waitForTimeout(900);
  }
  const ended = await page.getByTestId('deck-end').isVisible().catch(() => false);
  check('the end screen appears', ended);
  if (ended) {
    const txt = (await page.getByTestId('deck-end').textContent()) || '';
    check('it tallies the day', /approved/i.test(txt) && /skipped/i.test(txt));
    check('it links back to the pipeline', await page.getByRole('link', { name: /pipeline/i }).first().isVisible());
  }
  await shot('8-end');
  await ctx.close();
}

// Desktop first, and shallow: it only looks. The phone run is the deep one
// and it SPENDS the deck — three cards decided is an empty deck — so anything
// that wants to see a card has to go before it.
await run('desktop-1280', 1280, 900, false);
await run('phone-430', 430, 932, true);

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
console.log(`Screenshots: ${SHOTS}`);
process.exit(failed.length ? 1 : 0);

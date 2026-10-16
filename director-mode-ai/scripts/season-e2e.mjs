/**
 * Season Builder end to end, in a real browser, against a local server.
 *
 *   npm run dev                       (another shell)
 *   node scripts/season-e2e.mjs
 *
 * Signs in as the club owner with a minted magic link (no password, see
 * deck-e2e.mjs), opens the director page, creates the campaign if there is
 * none, previews the email (NEVER sends), then plays two members:
 *   - a personal link for a throwaway vault person (.invalid address)
 *   - the public newsletter link, typed as a second throwaway
 * and checks both land in the head count, then turns their group into a
 * CaptainMode team. Every throwaway row is deleted at the end.
 */
import { readFileSync, mkdirSync } from 'fs';
import { pathToFileURL } from 'url';
import pg from '../node_modules/pg/lib/index.js';

const PW = process.env.PLAYWRIGHT_DIR || 'C:/Users/darri/court-booker/node_modules/playwright';
const pw = await import(pathToFileURL(`${PW}/index.js`).href);
const chromium = pw.chromium ?? pw.default?.chromium;
const APP = process.env.APP || 'http://localhost:3000';
const SHOTS = './.season-shots';
mkdirSync(SHOTS, { recursive: true });

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const CLUB = 'c437bf37-1ea2-4dc1-9250-11402f377726';
const db = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;

const results = [];
const check = (label, pass, detail = '') => {
  results.push(pass);
  console.log(`${pass ? '  PASS' : '  FAIL'}  ${label}${detail ? `  - ${detail}` : ''}`);
};

async function session(email) {
  const gen = await fetch(`${SB}/auth/v1/admin/generate_link`, {
    method: 'POST', headers: { apikey: KEY, authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email }),
  }).then((r) => r.json());
  const s = await fetch(`${SB}/auth/v1/verify`, {
    method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: gen.hashed_token }),
  }).then((r) => r.json());
  const ref = new URL(SB).hostname.split('.')[0];
  return {
    name: `sb-${ref}-auth-token`,
    value: 'base64-' + Buffer.from(JSON.stringify({
      access_token: s.access_token, token_type: 'bearer', expires_in: s.expires_in, expires_at: s.expires_at,
      refresh_token: s.refresh_token, user: s.user,
    })).toString('base64'),
    domain: 'localhost', path: '/', httpOnly: false, secure: false, sameSite: 'Lax',
    expires: Math.floor(Date.now() / 1000) + 3600,
  };
}

const T1 = 'Zz Seasontest Personal', T2 = 'Zz Seasontest Public';
let vaultId, teamIds = [];
const browser = await chromium.launch();
try {
  // ---------------------------------------------------------------- director
  const cookie = await session('darrinjco@gmail.com');
  const dctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await dctx.addCookies([cookie, { ...cookie, name: 'cm_club', value: CLUB }]);
  const page = await dctx.newPage();
  page.on('console', (m) => m.type() === 'error' && console.log('    [console]', m.text().slice(0, 200)));
  await page.goto(`${APP}/run/members/season-builder`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(1500);
  if (await page.getByRole('button', { name: 'Create' }).count()) {
    await page.screenshot({ path: `${SHOTS}/1-setup.png`, fullPage: true });
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(4000);
  }
  const [camp] = await q(`select * from sb_campaigns where club_id=$1 order by created_at desc limit 1`, [CLUB]);
  check('campaign exists', !!camp, camp && `${camp.title} reply_by=${camp.reply_by?.toISOString?.().slice(0, 10) ?? camp.reply_by}`);
  check('three leagues; men 40+ has no day option',
    camp.leagues.length === 3 && camp.leagues.find((l) => l.key === 'm40').slots.join() === 'nights_weekends'
    && camp.leagues.find((l) => l.key === 'w40').slots.join() === 'day,nights_weekends');

  await page.getByRole('button', { name: 'Preview' }).click();
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${SHOTS}/2-preview.png`, fullPage: true });
  const sendBtn = page.getByRole('button', { name: /^Send to \d+ members$/ });
  const label = (await sendBtn.count()) ? await sendBtn.textContent() : '';
  check('preview shows the send button with a member count', /Send to \d+ members/.test(label), label);
  const n = Number((label.match(/\d+/) || [0])[0]);
  check('recipient count is the adult membership (500+)', n > 500, String(n));
  const frame = page.frameLocator('iframe[title="Email preview"]');
  const emailText = await frame.locator('body').innerText();
  check('email names all three leagues', /Women.s 40 & Over/.test(emailText) && /Men.s 40 & Over/.test(emailText) && /Mixed 18 & Over/.test(emailText));
  check('email has reply-by Friday, October 30', /Friday, October 30/.test(emailText));
  check('email says registration starts November 3', /November 3/.test(emailText));
  const invites = await q(`select count(*)::int n from sb_invites where campaign_id=$1 and sent_at is not null`, [camp.id]);
  check('NOTHING was sent by preview', invites[0].n === 0, `${invites[0].n} sent`);

  // ---------------------------------------------------------------- personal link
  [{ id: vaultId }] = await q(
    `insert into cc_vault_players (club_id, director_id, full_name, email, gender, membership_status)
     values ($1, '7ff5078a-ee6d-46b7-9af7-20b35f62729d', $2, 'zz-season-1@guest-test.invalid', 'female', 'active') returning id`, [CLUB, T1]);
  const [{ token }] = await q(
    `insert into sb_invites (campaign_id, vault_player_id, name, email) values ($1,$2,$3,'zz-season-1@guest-test.invalid') returning token`, [camp.id, vaultId, T1]);
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const m = await mctx.newPage();
  await m.goto(`${APP}/season/${token}`, { waitUntil: 'networkidle' });
  await m.screenshot({ path: `${SHOTS}/3-personal-open.png`, fullPage: true });
  check('personal page greets them by first name', (await m.locator('body').innerText()).includes('Hi Zz'));
  await m.getByRole('button', { name: /Yes, I.m interested/ }).click();
  check('gender prefilled from PlayerVault (women\u2019s leagues showing)', await m.getByText("Women's 40 & Over").count() > 0);
  check('no men\u2019s league offered to a woman', await m.getByText("Men's 40 & Over", { exact: true }).count() === 0);
  await m.getByRole('button', { name: /Daytime/ }).first().click();
  await m.getByRole('button', { name: '3.5' }).click();
  await m.getByRole('button', { name: /captain a team/ }).click();
  // Submit WITHOUT the age box: must be refused.
  await m.locator('select').nth(0).selectOption('01');
  await m.locator('select').nth(1).selectOption('2027');
  await m.getByRole('button', { name: 'Count me in' }).click();
  await m.waitForTimeout(800);
  check('40+ without the age box is refused', (await m.locator('body').innerText()).includes('confirm your age'));
  await m.getByText(/I was born in 1987 or earlier/).click();
  check('ticking the box clears the error', !(await m.locator('body').innerText()).includes('confirm your age'));
  check('no assistant bubble on the member page', await m.locator('text=Ask ClubMode').count() === 0);
  await m.screenshot({ path: `${SHOTS}/4-personal-filled.png`, fullPage: true });
  await m.getByRole('button', { name: 'Count me in' }).click();
  await m.waitForSelector('text=on the list', { timeout: 15000 });
  await m.screenshot({ path: `${SHOTS}/5-personal-done.png`, fullPage: true });
  const body5 = await m.locator('body').innerText();
  check('Jan 2027 expiry flags USTA renewal on screen', body5.includes('renew your USTA membership'));
  const [r1] = await q(`select * from sb_responses where campaign_id=$1 and name=$2`, [camp.id, T1]);
  check('personal answer saved', !!r1 && r1.ntrp === '3.5' && r1.role === 'captain' && r1.needs_renewal === true && r1.age_ok === true,
    r1 && JSON.stringify({ ntrp: r1.ntrp, role: r1.role, renew: r1.needs_renewal, choices: r1.choices }));

  // Re-open: answers are prefilled, and editing does not duplicate.
  await m.goto(`${APP}/season/${token}`, { waitUntil: 'networkidle' });
  await m.getByRole('button', { name: /Nights & weekends/ }).first().click();
  await m.locator('select').nth(1).selectOption('2028');
  await m.getByRole('button', { name: 'Count me in' }).click();
  await m.waitForSelector('text=on the list', { timeout: 15000 });
  const r1b = await q(`select * from sb_responses where campaign_id=$1 and name=$2`, [camp.id, T1]);
  check('editing updates the same row', r1b.length === 1 && r1b[0].choices.length === 2 && r1b[0].needs_renewal === false,
    JSON.stringify(r1b.map((r) => [r.choices.length, r.needs_renewal])));

  // ---------------------------------------------------------------- public link
  const p = await mctx.newPage();
  await p.goto(`${APP}/season/join/${camp.public_token}`, { waitUntil: 'networkidle' });
  await p.getByPlaceholder('First and last name').fill(T2);
  await p.getByPlaceholder('Email').fill('zz-season-2@guest-test.invalid');
  await p.getByRole('button', { name: /Yes, I.m interested/ }).click();
  await p.getByRole('button', { name: /^Men.s$/ }).click();
  check('men see no daytime option', await p.getByRole('button', { name: /Daytime/ }).count() === 0);
  await p.getByRole('button', { name: /Nights & weekends/ }).first().click(); // Men's 40+
  await p.getByRole('button', { name: /Nights & weekends/ }).nth(1).click(); // Mixed 18+
  await p.getByText(/I was born in 1987 or earlier/).click();
  await p.getByRole('button', { name: '4.0' }).click();
  await p.getByRole('button', { name: /just play/ }).click();
  await p.getByText(/Not sure/).click();
  await p.getByRole('button', { name: 'Count me in' }).click();
  await p.waitForSelector('text=on the list', { timeout: 15000 });
  await p.screenshot({ path: `${SHOTS}/6-public-done.png`, fullPage: true });
  const [r2] = await q(`select * from sb_responses where campaign_id=$1 and name=$2`, [camp.id, T2]);
  check('public answer saved, unmatched, renewal flagged (not sure)', !!r2 && r2.vault_player_id === null && r2.needs_renewal && r2.choices.length === 2 && r2.source === 'public');

  // ---------------------------------------------------------------- dashboard + team
  await page.goto(`${APP}/run/members/season-builder`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Head count by team', { timeout: 30000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/7-dashboard.png`, fullPage: true });
  const dtext = await page.locator('body').innerText();
  check('dashboard lists the unmatched newsletter sign-up', dtext.includes(T2));
  check('dashboard lists the captain volunteer', dtext.includes(T1));
  // Open the Men's 40+ 4.0 group and make a team from it.
  const row = page.locator('button', { hasText: '4.0' }).first();
  await row.click();
  await page.getByRole('button', { name: 'Create team in CaptainMode' }).first().click();
  await page.waitForSelector('text=Team ready', { timeout: 15000 });
  await page.screenshot({ path: `${SHOTS}/8-team.png`, fullPage: true });
  const teams = await q(`select t.id, t.name, (select count(*)::int from captain_players p where p.team_id=t.id) n from captain_teams t where t.club_id=$1 and t.name like '%' || $2`, [CLUB, camp.title]);
  teamIds = teams.map((t) => t.id);
  check('CaptainMode team created with the player', teams.length === 1 && teams[0].n === 1, JSON.stringify(teams));

  // CSV
  const csv = await page.evaluate(async (u) => (await fetch(u)).text(), `/api/season-builder/${camp.id}/export`);
  check('CSV export has both people', csv.includes(T1) && csv.includes(T2), `${csv.split('\n').length - 1} rows`);
} finally {
  // ---------------------------------------------------------------- cleanup
  for (const id of teamIds) {
    await q(`delete from captain_players where team_id=$1`, [id]);
    await q(`delete from captain_teams where id=$1`, [id]);
  }
  await q(`delete from sb_responses where name in ($1,$2)`, [T1, T2]);
  await q(`delete from sb_invites where name=$1`, [T1]);
  if (vaultId) await q(`delete from cc_vault_players where id=$1`, [vaultId]);
  await browser.close();
  await db.end();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} passed. Screens in ${SHOTS}/`);
  process.exit(failed ? 1 : 0);
}

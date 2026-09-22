/**
 * Fill in World Tennis Numbers from worldtennisnumber.com.
 *
 *   node scripts/wtn-lookup.mjs --resolve            # look everyone up, propose matches
 *   node scripts/wtn-lookup.mjs --report             # what was proposed, by tier
 *   node scripts/wtn-lookup.mjs --apply              # write the safe tier (auto)
 *   node scripts/wtn-lookup.mjs --apply --tier likely
 *   node scripts/wtn-lookup.mjs --apply "Declan Gonzales"=GON1234567
 *   node scripts/wtn-lookup.mjs --refresh            # re-pull everyone already matched
 *
 * The ITF puts the public player search behind a GraphQL endpoint that returns
 * SINGLES AND DOUBLES IN ONE CALL, so there is no doubles tab to click and no
 * browser to drive — one request per player, made politely.
 *
 * Two things about that search decide the whole design:
 *
 *   1. It is FUZZY by default. "Darrin Cohen" also returns Darrin Schain and
 *      Max Cohen. `exactMatch: true` fixes that, but a name is still not an
 *      identity — there are six Justin Whites. So this never writes a number
 *      it had to guess at: it proposes, and only the tier that cannot
 *      reasonably be anyone else gets written without a human looking.
 *   2. The site hides any rating with confidence <= 60. Club players sit at
 *      10-40 because they play few RATED matches, which is exactly why so many
 *      looked unrated. We ask for all of them and keep the confidence, so a
 *      soft number can be shown as soft instead of passing for a hard one.
 *
 * Once a person is matched their World Tennis ID is kept, and --refresh goes
 * straight back by ID. The name matching below only ever happens once.
 *
 * WTN runs 1 (pro) to 40 (beginner): LOWER is stronger, the opposite of NTRP.
 */
import pg from 'pg';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const ENDPOINT = 'https://prd-itf-kube.clubspark.pro/graphql';
const PROPOSALS = 'scripts/_wtn-proposals.json';
const CACHE = 'scripts/_wtn-cache.json';
const MIN_WTN = 1;
const MAX_WTN = 40;
const DEFAULT_DELAY = 1500;

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [
      l.slice(0, l.indexOf('=')).trim(),
      l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, ''),
    ]),
);

const u = new URL(env.DATABASE_URL);
const client = new pg.Client({
  host: u.hostname,
  port: u.port || 5432,
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.slice(1) || 'postgres',
  ssl: { rejectUnauthorized: false },
});

const has = (f) => process.argv.includes(f);
const arg = (f, d = null) => {
  const i = process.argv.indexOf(f);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

/* ---------------------------------------------------------------- names -- */

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);

// Rosters are written the way people are spoken to; the ITF has whatever was
// on the registration form. Bob is Robert there more often than not.
const NICKNAMES = {
  al: 'alan', alex: 'alexander', andy: 'andrew', ben: 'benjamin', beth: 'elizabeth',
  betsy: 'elizabeth', bill: 'william', billy: 'william', bob: 'robert', bobby: 'robert',
  brad: 'bradley', cathy: 'catherine', charlie: 'charles', chris: 'christopher',
  chuck: 'charles', cindy: 'cynthia', dan: 'daniel', danny: 'daniel', dave: 'david',
  deb: 'deborah', debbie: 'deborah', dick: 'richard', don: 'donald', doug: 'douglas',
  ed: 'edward', eddie: 'edward', fred: 'frederick', gabe: 'gabriel', greg: 'gregory',
  hank: 'henry', jack: 'john', jake: 'jacob', jeff: 'jeffrey', jen: 'jennifer',
  jenny: 'jennifer', jim: 'james', jimmy: 'james', joe: 'joseph', joey: 'joseph',
  jon: 'jonathan', josh: 'joshua', kate: 'katherine', kathy: 'katherine',
  katie: 'katherine', ken: 'kenneth', kim: 'kimberly', larry: 'lawrence',
  liz: 'elizabeth', lou: 'louis', maggie: 'margaret', matt: 'matthew', meg: 'margaret',
  mike: 'michael', nate: 'nathan', nick: 'nicholas', pat: 'patricia', patty: 'patricia',
  pete: 'peter', phil: 'philip', ray: 'raymond', rich: 'richard', rick: 'richard',
  rob: 'robert', ron: 'ronald', sam: 'samuel', sandy: 'sandra', steve: 'steven',
  sue: 'susan', susie: 'susan', ted: 'theodore', tim: 'timothy', tom: 'thomas',
  tony: 'anthony', vicki: 'victoria', will: 'william', zach: 'zachary',
};

// Sleepy Hollow draws from Lamorinda and the rest of the East Bay. "In
// California" is far too loose to identify a member by — Tustin and Irvine are
// a seven-hour drive, and Roseville is Sacramento. These are the towns a member
// actually comes from.
const LOCAL_CITIES = new Set([
  'alamo', 'danville', 'diablo', 'blackhawk', 'lafayette', 'moraga', 'orinda',
  'walnut creek', 'pleasant hill', 'concord', 'clayton', 'martinez', 'san ramon',
  'dublin', 'pleasanton', 'livermore', 'antioch', 'brentwood', 'oakley',
  'berkeley', 'oakland', 'piedmont', 'albany', 'el cerrito', 'richmond',
  'alameda', 'emeryville', 'san leandro', 'castro valley', 'hayward', 'benicia',
]);

const isLocal = (c) =>
  c.state === 'CA' && !!c.city && LOCAL_CITIES.has(c.city.trim().toLowerCase());

const norm = (s) =>
  (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** "Declan M Gonzales Jr" -> { given: 'declan', family: 'gonzales' } */
function splitName(full) {
  const t = norm(full).split(' ').filter(Boolean);
  while (t.length > 2 && SUFFIXES.has(t[t.length - 1])) t.pop();
  if (t.length < 2) return null;
  return { given: t[0], family: t[t.length - 1] };
}

function givenMatches(ours, theirs) {
  if (ours === theirs) return 'exact';
  if (NICKNAMES[ours] === theirs || NICKNAMES[theirs] === ours) return 'nickname';
  if (NICKNAMES[ours] && NICKNAMES[ours] === NICKNAMES[theirs]) return 'nickname';
  return null;
}

/* ------------------------------------------------------------ the search -- */

const QUERY = `query getPlayers($filter: PublicPersonFilterOptions, $pageArgs: PaginationArgs) {
  publicPersons(filter: $filter, pageArgs: $pageArgs) {
    items {
      tennisID nativeGivenName nativeFamilyName nationalityCode sex age birthYear
      worldTennisNumbers { type tennisNumber confidence }
      addresses { city countryCode state }
    }
    totalItems
  }
}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
let requests = 0;

async function search(term, { exact = true, usaOnly = true } = {}) {
  const key = `${term}|${exact}|${usaOnly}`;
  if (cache[key]) return cache[key];

  const filter = {
    ratings: [{ type: 'ITF', rating: { gte: MIN_WTN, lte: MAX_WTN }, confidence: { gt: 0 } }],
    search: { term, exactMatch: exact },
  };
  if (usaOnly) filter.nationalityCodes = ['USA'];

  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/graphql-response+json,application/json;q=0.9',
          referer: 'https://worldtennisnumber.com/',
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
        },
        body: JSON.stringify({
          operationName: 'getPlayers',
          variables: { filter, pageArgs: { skip: 0, limit: 10 } },
          query: QUERY,
        }),
      });
    } catch (e) {
      res = { ok: false, status: 0, problem: e.message };
    }
    requests++;

    if (!res.ok || res.status === 429 || res.status >= 500) {
      // Back off rather than lean on somebody else's server.
      const wait = 4000 * 2 ** attempt;
      console.log(`    (${res.status || res.problem}) backing off ${wait / 1000}s`);
      await sleep(wait);
      continue;
    }
    const json = await res.json();
    if (json.errors) throw new Error(JSON.stringify(json.errors).slice(0, 300));
    const items = json.data.publicPersons.items || [];
    cache[key] = items;
    return items;
  }
  throw new Error(`gave up on "${term}" after repeated failures`);
}

function numbers(item) {
  const s = item.worldTennisNumbers.find((w) => w.type === 'SINGLE');
  const d = item.worldTennisNumbers.find((w) => w.type === 'DOUBLE');
  return {
    singles: s ? Number(s.tennisNumber) : null,
    singlesConfidence: s ? s.confidence : null,
    doubles: d ? Number(d.tennisNumber) : null,
    doublesConfidence: d ? d.confidence : null,
  };
}

function place(item) {
  const a = (item.addresses || [])[0];
  return a ? { city: a.city || null, state: a.state || null } : { city: null, state: null };
}

const inBand = (n) => n == null || (n >= MIN_WTN && n <= MAX_WTN);

/* ------------------------------------------------------------- deciding -- */

/**
 * Tiers, by how far the evidence actually carries:
 *   auto   — one exact-name match AND it is placed in California (or the birth
 *            year we hold agrees). Nobody else it could plausibly be.
 *   likely — one exact-name match with no address at all. Probably them, but a
 *            glance is cheap, so it waits for one.
 *   review — more than one, or a single match living in another state, which is
 *            evidence AGAINST as much as for. Needs a pick by hand.
 *   none   — nobody of that name has a rating at all.
 */
function classify(person, items) {
  const ours = splitName(person.full_name);
  if (!ours) return { tier: 'none', reason: 'no surname on file', candidates: [] };

  const ourYear = person.dob ? new Date(person.dob).getUTCFullYear() : null;

  const candidates = items
    .map((i) => {
      const how = givenMatches(ours.given, norm(i.nativeGivenName));
      if (!how || norm(i.nativeFamilyName) !== ours.family) return null;
      const n = numbers(i);
      if (n.singles == null && n.doubles == null) return null;
      if (!inBand(n.singles) || !inBand(n.doubles)) return null;
      const p = place(i);
      return {
        tennisId: i.tennisID,
        name: `${i.nativeGivenName} ${i.nativeFamilyName}`,
        sex: i.sex,
        age: i.age || null,
        birthYear: i.birthYear || null,
        ...p,
        ...n,
        nameMatch: how,
        inCalifornia: p.state === 'CA',
        birthYearAgrees: ourYear != null && i.birthYear === ourYear,
      };
    })
    .filter(Boolean);

  if (candidates.length === 0) {
    return { tier: 'none', reason: 'no rated player by that name', candidates };
  }

  const nicknamed = candidates.some((c) => c.nameMatch === 'nickname');

  if (candidates.length === 1) {
    const c = candidates[0];
    if (c.birthYearAgrees) return { tier: 'auto', reason: 'only match, birth year agrees', candidates };
    if (nicknamed) return { tier: 'review', reason: `only match, but via nickname "${ours.given}"`, candidates };
    if (c.inCalifornia) return { tier: 'auto', reason: `only match, ${c.city || 'in CA'}`, candidates };
    if (!c.state) return { tier: 'likely', reason: 'only one in the country, no address to confirm', candidates };
    return { tier: 'review', reason: `only match, but lives in ${c.state}`, candidates };
  }

  const yr = candidates.filter((c) => c.birthYearAgrees);
  const cal = candidates.filter((c) => c.inCalifornia);
  if (yr.length === 1) {
    return { tier: 'auto', reason: `${candidates.length} share the name, one born ${yr[0].birthYear}`, candidates: [yr[0], ...candidates.filter((c) => c !== yr[0])] };
  }
  if (cal.length === 1) {
    return { tier: 'review', reason: `${candidates.length} share the name, one in ${cal[0].city || 'CA'}`, candidates: [cal[0], ...candidates.filter((c) => c !== cal[0])] };
  }
  return { tier: 'review', reason: `${candidates.length} players share this name`, candidates };
}

/* -------------------------------------------------------------- writing -- */

async function write(mpid, pick, label) {
  const sets = ['wtn_source = $2', 'wtn_updated_at = now()', 'wtn_checked_at = now()', 'updated_at = now()'];
  const params = [mpid, 'itf'];
  const push = (col, val) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };
  push('wtn_tennis_id', pick.tennisId);
  if (pick.singles != null) push('wtn', pick.singles);
  if (pick.doubles != null) push('wtn_doubles', pick.doubles);
  if (pick.singlesConfidence != null) push('wtn_singles_confidence', pick.singlesConfidence);
  if (pick.doublesConfidence != null) push('wtn_doubles_confidence', pick.doublesConfidence);
  await client.query(`update master_players set ${sets.join(', ')} where id = $1`, params);

  // Push out to the club-scoped mirrors, which is all a browser may read.
  const reached = {};
  const mirrorSql = (withUpdatedAt) => {
    const p = [mpid];
    const s = withUpdatedAt ? ['updated_at = now()'] : [];
    if (pick.singles != null) { p.push(pick.singles); s.push(`wtn = $${p.length}`); }
    if (pick.doubles != null) { p.push(pick.doubles); s.push(`wtn_doubles = $${p.length}`); }
    return { p, s };
  };
  for (const table of ['captain_players', 'cc_vault_players']) {
    const { p, s } = mirrorSql(true);
    if (s.length <= 1) break;
    const { rowCount } = await client.query(
      `update ${table} set ${s.join(', ')} where master_player_id = $1`, p,
    );
    reached[table] = rowCount;
  }
  const { p, s } = mirrorSql(false);
  if (s.length) {
    const { rowCount } = await client.query(
      `update players set ${s.join(', ')} where master_player_id = $1`, p,
    );
    reached.players = rowCount;
  }

  const mirrored = Object.entries(reached)
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `${t} ${n}`)
    .join(', ');
  console.log(
    `  ${label.padEnd(26)} S ${String(pick.singles ?? '—').padEnd(6)} D ${String(pick.doubles ?? '—').padEnd(6)}` +
      ` c${pick.singlesConfidence ?? '–'}/${pick.doublesConfidence ?? '–'}  ${mirrored || 'hub only'}`,
  );
}

/* --------------------------------------------------------------- report -- */

const TIERS = ['auto', 'likely', 'review', 'none'];

function report(proposals) {
  const by = Object.fromEntries(TIERS.map((t) => [t, proposals.filter((p) => p.tier === t)]));
  console.log('');
  for (const tier of TIERS) {
    const list = by[tier];
    if (!list.length) continue;
    console.log(`${tier.toUpperCase()}  (${list.length})`);
    if (tier === 'none') {
      const names = list.slice(0, 10).map((p) => p.name).join(', ');
      console.log(`  ${names}${list.length > 10 ? `, +${list.length - 10} more` : ''}\n`);
      continue;
    }
    for (const p of list) {
      const c = p.candidates[0];
      console.log(
        `  ${p.name.padEnd(26)} S ${String(c.singles ?? '—').padEnd(6)} D ${String(c.doubles ?? '—').padEnd(6)}` +
          ` c${c.singlesConfidence ?? '–'}/${c.doublesConfidence ?? '–'}  — ${p.reason}`,
      );
      if (tier === 'review') {
        for (const cc of p.candidates) {
          console.log(
            `      ${cc.tennisId}  ${cc.name}, ${cc.sex} ${cc.age ?? '?'}  ` +
              `${cc.city || 'no city'}, ${cc.state || '—'}  S ${cc.singles ?? '—'} D ${cc.doubles ?? '—'}`,
          );
        }
      }
    }
    console.log('');
  }
  console.log(
    `${proposals.length} looked up · ${by.auto.length} safe to write · ${by.likely.length} likely · ` +
      `${by.review.length} need a pick · ${by.none.length} have no rating`,
  );
  console.log(`\n  node scripts/wtn-lookup.mjs --apply                 writes the ${by.auto.length} auto`);
  if (by.likely.length) {
    console.log(`  node scripts/wtn-lookup.mjs --apply --tier likely   adds the ${by.likely.length} likely`);
  }
  if (by.review.length) {
    console.log(`  node scripts/wtn-lookup.mjs --apply "Name"=TENNISID  settles one by hand`);
  }
  console.log('');
}

/* ----------------------------------------------------------------- main -- */

await client.connect();
try {
  const delay = Number(arg('--delay', DEFAULT_DELAY));

  if (has('--resolve')) {
    const only = arg('--name');
    const limit = Number(arg('--limit', 0));
    const where = only
      ? 'where lower(full_name) = lower($1)'
      : `where wtn is null and wtn_doubles is null${has('--recheck') ? '' : ' and wtn_checked_at is null'}`;
    const { rows } = await client.query(
      `select id, full_name, dob from master_players ${where}
        order by full_name ${limit ? `limit ${limit}` : ''}`,
      only ? [only] : [],
    );
    console.log(`\nLooking up ${rows.length} player${rows.length === 1 ? '' : 's'} on worldtennisnumber.com`);
    console.log(`one request each, ${delay}ms apart — roughly ${Math.ceil((rows.length * delay) / 60000)} min\n`);

    const proposals = [];
    let i = 0;
    for (const person of rows) {
      i++;
      const parts = splitName(person.full_name);
      const before = requests;
      let items = [];
      if (parts) {
        items = await search(`${parts.given} ${parts.family}`);
        // A roster nickname misses an exact search; try the long form once.
        if (!items.length && NICKNAMES[parts.given]) {
          if (requests > before) await sleep(delay);
          items = await search(`${NICKNAMES[parts.given]} ${parts.family}`);
        }
      }
      const verdict = classify(person, items);
      proposals.push({ id: person.id, name: person.full_name, ...verdict });

      const mark = { auto: '✓', likely: '~', review: '?', none: '·' }[verdict.tier];
      if (verdict.tier !== 'none' || i % 25 === 0) {
        console.log(`  ${String(i).padStart(3)}/${rows.length} ${mark} ${person.full_name.padEnd(26)} ${verdict.reason}`);
      }
      writeFileSync(CACHE, JSON.stringify(cache));
      writeFileSync(PROPOSALS, JSON.stringify(proposals, null, 2));
      // Only pause for someone else's server. A cache hit -- which is every
      // player on a resumed run -- owes them nothing, so it does not wait.
      if (requests > before) await sleep(delay + Math.random() * 400);
    }

    // Remember the misses too, so a second run does not re-ask the same questions.
    const missed = proposals.filter((p) => p.tier === 'none').map((p) => p.id);
    if (missed.length) {
      await client.query('update master_players set wtn_checked_at = now() where id = any($1::uuid[])', [missed]);
    }
    console.log(`\n${requests} requests made.`);
    report(proposals);
    process.exit(0);
  }

  if (has('--report')) {
    if (!existsSync(PROPOSALS)) {
      console.error('Nothing resolved yet — run --resolve first.');
      process.exit(1);
    }
    report(JSON.parse(readFileSync(PROPOSALS, 'utf8')));
    process.exit(0);
  }

  if (has('--apply')) {
    if (!existsSync(PROPOSALS)) {
      console.error('Nothing resolved yet — run --resolve first.');
      process.exit(1);
    }
    const proposals = JSON.parse(readFileSync(PROPOSALS, 'utf8'));
    const tiers = new Set(['auto', ...arg('--tier', '').split(',').filter(Boolean)]);
    const picks = Object.fromEntries(
      process.argv
        .filter((a) => !a.startsWith('--') && a.includes('='))
        .map((a) => [norm(a.slice(0, a.indexOf('='))), a.slice(a.indexOf('=') + 1).trim()]),
    );
    const only = arg('--name');

    let wrote = 0;
    let skipped = 0;
    console.log('');
    for (const p of proposals) {
      if (only && norm(only) !== norm(p.name)) continue;
      const picked = picks[norm(p.name)];
      if (picked && !p.candidates.some((c) => c.tennisId === picked)) {
        console.log(`  ${p.name.padEnd(26)} no candidate ${picked} — run --report to see the options`);
        continue;
      }
      // A Sleepy Hollow member lives in the East Bay. When several people share
      // a name and exactly ONE of them is local, that is the member -- the rest
      // are strangers who happen to be called the same thing. A lone match
      // somewhere else is the opposite: evidence it is NOT them, so this never
      // rescues one of those, in California or otherwise.
      let californian = null;
      if (has('--pick-local') && p.tier === 'review') {
        const near = p.candidates.filter(isLocal);
        if (near.length === 1 && p.candidates.length > 1) californian = near[0];
      }
      const chosen = picked
        ? p.candidates.find((c) => c.tennisId === picked)
        : californian || (tiers.has(p.tier) ? p.candidates[0] : null);
      if (!chosen) continue;
      if (californian) {
        console.log(`  (${californian.city}, the only local one of ${p.candidates.length} same-named)`);
      }

      // Never quietly overwrite a number somebody typed in by hand.
      const { rows: cur } = await client.query(
        'select wtn, wtn_doubles, wtn_source from master_players where id = $1', [p.id],
      );
      const existing = cur[0];
      if (existing && (existing.wtn != null || existing.wtn_doubles != null)
          && existing.wtn_source === 'manual' && !has('--force')) {
        console.log(`  ${p.name.padEnd(26)} kept the number typed in by hand (--force to replace)`);
        skipped++;
        continue;
      }
      await write(p.id, chosen, p.name);
      wrote++;
    }
    console.log(`\n${wrote} written${skipped ? `, ${skipped} left alone` : ''}.\n`);
    process.exit(0);
  }

  if (has('--refresh')) {
    const { rows } = await client.query(
      `select id, full_name, wtn_tennis_id from master_players
        where wtn_tennis_id is not null order by wtn_updated_at nulls first`,
    );
    console.log(`\nRefreshing ${rows.length} matched player${rows.length === 1 ? '' : 's'} by World Tennis ID\n`);
    let changed = 0;
    for (const person of rows) {
      delete cache[`${person.wtn_tennis_id}|true|true`];
      const items = await search(person.wtn_tennis_id);
      const hit = items.find((i) => i.tennisID === person.wtn_tennis_id);
      if (!hit) {
        console.log(`  ${person.full_name.padEnd(26)} that ID no longer returns a rating`);
        await sleep(delay);
        continue;
      }
      const n = numbers(hit);
      if (!inBand(n.singles) || !inBand(n.doubles)) {
        console.log(`  ${person.full_name.padEnd(26)} out of the 1-40 band, left alone`);
        await sleep(delay);
        continue;
      }
      await write(person.id, { tennisId: person.wtn_tennis_id, ...n }, person.full_name);
      changed++;
      await sleep(delay + Math.random() * 400);
    }
    console.log(`\n${changed} refreshed.\n`);
    process.exit(0);
  }

  console.log(`
  node scripts/wtn-lookup.mjs --resolve [--limit N] [--name "X"] [--recheck]
  node scripts/wtn-lookup.mjs --report
  node scripts/wtn-lookup.mjs --apply [--tier likely] [--name "X"] [--force]
  node scripts/wtn-lookup.mjs --apply "Name"=TENNISID
  node scripts/wtn-lookup.mjs --refresh
`);
} finally {
  writeFileSync(CACHE, JSON.stringify(cache));
  await client.end();
}

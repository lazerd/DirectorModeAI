/**
 * Megan Sullivan's EBWT C availability, from the polls she ran before the team
 * existed in CaptainMode.
 *
 * She collected all 16 dates by hand and did not want her team asked twice, so
 * the answers are imported rather than re-polled.
 *
 * Two rules this script exists to enforce:
 *
 *   1. "No response" writes NOTHING. It is the absence of an answer, and
 *      inventing a 'no' for it would tell the lineup generator that fourteen
 *      players had declined 11/6 when in truth nobody replied.
 *
 *   2. A qualifier is kept verbatim in `note`. "Doubles only", "first shift
 *      only" and "call last" are all a YES with a condition — flattening them
 *      to bare 'yes' loses what the captain needs when building that lineup,
 *      and to 'maybe' misreports a precise answer as an uncertain one.
 *
 * Every poll line is asserted to account for all 19 rostered players before
 * anything is written, so a name typed wrong here stops the run instead of
 * silently landing as somebody else's answer.
 *
 *   node scripts/one-off/ebwt-c-poll-import.mjs          # preview
 *   node scripts/one-off/ebwt-c-poll-import.mjs --write  # write
 */
import pg from 'pg';
import { readFileSync } from 'fs';

const TEAM_ID = 'e0ac616d-5138-4526-93ca-c3a03ea11cc5';

/** Poll names that differ from the roster spelling. */
const ALIASES = {
  'Jennifer Walker': 'Jennifer L Walker',
  'Vi Le': 'Vi D Le',
};

/**
 * The polls, verbatim. Each match is keyed by its local date + opponent
 * shorthand as Megan wrote it; the match id is resolved from the schedule.
 */
const POLLS = [
  {
    date: '2026-09-11', opponent: 'Meadow',
    yes: ['Megan Sullivan', 'Susie Chao', 'Kami De Ruig', 'Hedieh Haghighi', 'Jillian Helvey', 'Jessica Howard', 'Elizabeth Lawrence', 'Meghan Schmicker', 'Jennifer Walker', 'Karen Yoo'],
    no: ['Megan Atashroo', 'Vi Le', 'Caedmon Patalano', 'Blair Halsey', 'Meaghan Weiss'],
    none: ['Lindsay Dahms', 'Erica Desjardins', 'Kaylin Deutscher', 'Sarah Peterson'],
  },
  {
    date: '2026-09-17', opponent: 'Moraga Valley',
    yes: ['Megan Sullivan', 'Kami De Ruig', 'Hedieh Haghighi', 'Jillian Helvey', 'Elizabeth Lawrence'],
    maybe: ['Karen Yoo'],
    notes: { 'Caedmon Patalano': 'first shift only', 'Jennifer Walker': 'call last' },
    no: ['Megan Atashroo', 'Susie Chao', 'Jessica Howard', 'Vi Le', 'Meghan Schmicker', 'Meaghan Weiss'],
    none: ['Lindsay Dahms', 'Erica Desjardins', 'Kaylin Deutscher', 'Blair Halsey', 'Sarah Peterson'],
  },
  {
    date: '2026-10-02', opponent: 'Orinda Country Club',
    yes: ['Hedieh Haghighi', 'Jillian Helvey', 'Elizabeth Lawrence', 'Meghan Schmicker', 'Jennifer Walker', 'Meaghan Weiss'],
    maybe: ['Megan Sullivan', 'Megan Atashroo', 'Vi Le'],
    notes: { 'Susie Chao': 'doubles only' },
    no: ['Kami De Ruig', 'Jessica Howard', 'Caedmon Patalano', 'Karen Yoo'],
    none: ['Lindsay Dahms', 'Erica Desjardins', 'Kaylin Deutscher', 'Blair Halsey', 'Sarah Peterson'],
  },
  {
    date: '2026-10-16', opponent: 'Rancho Colorado',
    yes: ['Megan Sullivan', 'Kami De Ruig', 'Hedieh Haghighi', 'Elizabeth Lawrence', 'Meghan Schmicker', 'Karen Yoo'],
    maybe: ['Jessica Howard', 'Vi Le', 'Caedmon Patalano', 'Meaghan Weiss'],
    notes: { 'Susie Chao': 'doubles only' },
    no: ['Megan Atashroo', 'Jillian Helvey', 'Jennifer Walker'],
    none: ['Lindsay Dahms', 'Erica Desjardins', 'Kaylin Deutscher', 'Blair Halsey', 'Sarah Peterson'],
  },
  {
    date: '2026-10-22', opponent: 'Moraga Country Club',
    yes: ['Megan Sullivan', 'Kami De Ruig', 'Hedieh Haghighi', 'Jillian Helvey', 'Elizabeth Lawrence', 'Vi Le', 'Meghan Schmicker', 'Meaghan Weiss'],
    maybe: ['Megan Atashroo', 'Karen Yoo'],
    no: ['Susie Chao', 'Jessica Howard', 'Caedmon Patalano', 'Jennifer Walker'],
    none: ['Lindsay Dahms', 'Erica Desjardins', 'Kaylin Deutscher', 'Blair Halsey', 'Sarah Peterson'],
  },
  {
    date: '2026-11-06', opponent: 'Pleasanton',
    yes: ['Megan Sullivan', 'Jillian Helvey', 'Vi Le'],
    none: ['Megan Atashroo', 'Susie Chao', 'Lindsay Dahms', 'Kami De Ruig', 'Erica Desjardins', 'Kaylin Deutscher', 'Hedieh Haghighi', 'Blair Halsey', 'Jessica Howard', 'Elizabeth Lawrence', 'Caedmon Patalano', 'Sarah Peterson', 'Meghan Schmicker', 'Jennifer Walker', 'Meaghan Weiss', 'Karen Yoo'],
  },
  {
    date: '2026-12-11', opponent: 'Diablo',
    yes: ['Megan Sullivan', 'Kami De Ruig', 'Hedieh Haghighi', 'Jillian Helvey', 'Elizabeth Lawrence', 'Caedmon Patalano', 'Meghan Schmicker', 'Jennifer Walker'],
    maybe: ['Megan Atashroo', 'Vi Le'],
    notes: { 'Susie Chao': 'doubles only' },
    no: ['Jessica Howard', 'Meaghan Weiss', 'Karen Yoo'],
    none: ['Lindsay Dahms', 'Erica Desjardins', 'Kaylin Deutscher', 'Blair Halsey', 'Sarah Peterson'],
  },
  {
    date: '2026-12-18', opponent: 'Blackhawk',
    yes: ['Megan Sullivan', 'Kami De Ruig', 'Hedieh Haghighi', 'Jillian Helvey', 'Jessica Howard', 'Vi Le', 'Meaghan Weiss'],
    maybe: ['Megan Atashroo', 'Elizabeth Lawrence', 'Karen Yoo'],
    no: ['Susie Chao', 'Caedmon Patalano', 'Meghan Schmicker'],
    none: ['Lindsay Dahms', 'Erica Desjardins', 'Kaylin Deutscher', 'Blair Halsey', 'Sarah Peterson', 'Jennifer Walker'],
  },
  {
    date: '2027-01-08', opponent: 'Meadow',
    yes: ['Megan Sullivan', 'Megan Atashroo', 'Hedieh Haghighi', 'Jillian Helvey', 'Meaghan Weiss', 'Meghan Schmicker'],
    maybe: ['Jessica Howard', 'Elizabeth Lawrence', 'Vi Le', 'Caedmon Patalano'],
    no: ['Susie Chao'],
    none: ['Lindsay Dahms', 'Kami De Ruig', 'Erica Desjardins', 'Kaylin Deutscher', 'Blair Halsey', 'Sarah Peterson', 'Jennifer Walker', 'Karen Yoo'],
  },
  {
    date: '2027-01-22', opponent: 'Moraga Valley',
    yes: ['Megan Sullivan', 'Megan Atashroo', 'Hedieh Haghighi', 'Jillian Helvey', 'Jessica Howard', 'Elizabeth Lawrence', 'Caedmon Patalano', 'Meghan Schmicker', 'Jennifer Walker'],
    maybe: ['Vi Le'],
    no: ['Susie Chao'],
    none: ['Lindsay Dahms', 'Kami De Ruig', 'Erica Desjardins', 'Kaylin Deutscher', 'Blair Halsey', 'Sarah Peterson', 'Meaghan Weiss', 'Karen Yoo'],
  },
  {
    date: '2027-01-29', opponent: 'Orinda Country Club',
    yes: ['Megan Sullivan', 'Megan Atashroo', 'Hedieh Haghighi', 'Jillian Helvey', 'Elizabeth Lawrence', 'Vi Le', 'Meghan Schmicker'],
    no: ['Susie Chao', 'Jessica Howard', 'Caedmon Patalano'],
    none: ['Lindsay Dahms', 'Kami De Ruig', 'Erica Desjardins', 'Kaylin Deutscher', 'Blair Halsey', 'Sarah Peterson', 'Jennifer Walker', 'Meaghan Weiss', 'Karen Yoo'],
  },
  {
    date: '2027-02-02', opponent: 'Rancho Colorado',
    yes: ['Hedieh Haghighi', 'Jillian Helvey', 'Elizabeth Lawrence', 'Vi Le', 'Meghan Schmicker'],
    maybe: ['Megan Sullivan'],
    no: ['Megan Atashroo', 'Susie Chao', 'Jessica Howard', 'Caedmon Patalano'],
    none: ['Lindsay Dahms', 'Kami De Ruig', 'Erica Desjardins', 'Kaylin Deutscher', 'Blair Halsey', 'Sarah Peterson', 'Jennifer Walker', 'Meaghan Weiss', 'Karen Yoo'],
  },
  {
    date: '2027-02-19', opponent: 'Moraga Country Club',
    yes: ['Megan Sullivan', 'Megan Atashroo', 'Hedieh Haghighi', 'Jillian Helvey', 'Jessica Howard', 'Elizabeth Lawrence', 'Caedmon Patalano'],
    maybe: ['Susie Chao', 'Vi Le', 'Meghan Schmicker'],
    none: ['Lindsay Dahms', 'Kami De Ruig', 'Erica Desjardins', 'Kaylin Deutscher', 'Blair Halsey', 'Sarah Peterson', 'Jennifer Walker', 'Meaghan Weiss', 'Karen Yoo'],
  },
  {
    date: '2027-03-19', opponent: 'Pleasanton',
    yes: ['Megan Sullivan', 'Hedieh Haghighi', 'Jillian Helvey', 'Elizabeth Lawrence', 'Caedmon Patalano', 'Meghan Schmicker'],
    maybe: ['Susie Chao', 'Jessica Howard', 'Vi Le'],
    no: ['Megan Atashroo'],
    none: ['Lindsay Dahms', 'Kami De Ruig', 'Erica Desjardins', 'Kaylin Deutscher', 'Blair Halsey', 'Sarah Peterson', 'Jennifer Walker', 'Meaghan Weiss', 'Karen Yoo'],
  },
  {
    date: '2027-04-01', opponent: 'Diablo',
    yes: ['Megan Sullivan', 'Hedieh Haghighi', 'Jillian Helvey', 'Vi Le'],
    maybe: ['Jessica Howard', 'Elizabeth Lawrence'],
    no: ['Megan Atashroo', 'Susie Chao', 'Caedmon Patalano', 'Meghan Schmicker'],
    none: ['Lindsay Dahms', 'Kami De Ruig', 'Erica Desjardins', 'Kaylin Deutscher', 'Blair Halsey', 'Sarah Peterson', 'Jennifer Walker', 'Meaghan Weiss', 'Karen Yoo'],
  },
  {
    date: '2027-04-02', opponent: 'Blackhawk',
    yes: ['Megan Sullivan', 'Hedieh Haghighi', 'Jillian Helvey', 'Elizabeth Lawrence'],
    maybe: ['Susie Chao', 'Jessica Howard', 'Vi Le', 'Meghan Schmicker'],
    no: ['Megan Atashroo', 'Caedmon Patalano'],
    none: ['Lindsay Dahms', 'Kami De Ruig', 'Erica Desjardins', 'Kaylin Deutscher', 'Blair Halsey', 'Sarah Peterson', 'Jennifer Walker', 'Meaghan Weiss', 'Karen Yoo'],
  },
];

const WRITE = process.argv.includes('--write');

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
);
const u = new URL(env.DATABASE_URL);
const client = new pg.Client({
  host: u.hostname, port: u.port || 5432,
  user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
  database: u.pathname.slice(1) || 'postgres', ssl: { rejectUnauthorized: false },
});
await client.connect();

const { rows: roster } = await client.query(
  'select id, name from captain_players where team_id=$1 and active',
  [TEAM_ID],
);
const byName = new Map(roster.map((r) => [r.name.toLowerCase(), r.id]));
const resolve = (n) => byName.get((ALIASES[n] || n).toLowerCase());

const { rows: matches } = await client.query(
  `select id, (match_at at time zone 'America/Los_Angeles')::date::text d, opponent
     from captain_matches where team_id=$1 order by match_at`,
  [TEAM_ID],
);

let problems = 0;
const writes = [];

for (const poll of POLLS) {
  const match = matches.find((m) => m.d === poll.date);
  if (!match) {
    console.error(`✗ no match on ${poll.date} (${poll.opponent})`);
    problems++;
    continue;
  }
  // The opponent shorthand must actually appear in the scheduled opponent, or
  // the poll line has been matched to the wrong fixture on a shared date.
  const key = poll.opponent.split(' ')[0].toLowerCase();
  if (!match.opponent.toLowerCase().includes(key)) {
    console.error(`✗ ${poll.date}: poll says "${poll.opponent}", schedule says "${match.opponent}"`);
    problems++;
    continue;
  }

  const entries = [];
  for (const [bucket, status] of [['yes', 'yes'], ['maybe', 'maybe'], ['no', 'no']]) {
    for (const name of poll[bucket] || []) entries.push([name, status, null]);
  }
  // A qualifier is a yes with a condition.
  for (const [name, note] of Object.entries(poll.notes || {})) entries.push([name, 'yes', note]);

  const named = new Set([...entries.map((e) => e[0]), ...(poll.none || [])]);
  if (named.size !== roster.length) {
    console.error(
      `✗ ${poll.date}: ${named.size} players named, roster has ${roster.length}` +
        ` — missing: ${roster.map((r) => r.name).filter((n) => ![...named].some((x) => (ALIASES[x] || x) === n)).join(', ')}`,
    );
    problems++;
  }
  for (const n of named) {
    if (!resolve(n)) {
      console.error(`✗ ${poll.date}: "${n}" is not on the roster`);
      problems++;
    }
  }

  for (const [name, status, note] of entries) {
    const pid = resolve(name);
    if (pid) writes.push({ match_id: match.id, player_id: pid, status, note, when: poll.date, who: name });
  }
  const counts = entries.reduce((a, [, s]) => ({ ...a, [s]: (a[s] || 0) + 1 }), {});
  console.log(
    `${poll.date}  ${String(match.opponent).slice(0, 38).padEnd(38)} ` +
      `yes ${counts.yes || 0}  maybe ${counts.maybe || 0}  no ${counts.no || 0}  ` +
      `no-response ${(poll.none || []).length}`,
  );
}

console.log(`\n${writes.length} answers across ${POLLS.length} matches; ${problems} problem(s).`);

if (problems) {
  console.error('Refusing to write.');
  await client.end();
  process.exit(1);
}

if (!WRITE) {
  console.log('Preview only — pass --write to apply.');
  await client.end();
  process.exit(0);
}

for (const w of writes) {
  await client.query(
    `insert into captain_availability (team_id, match_id, player_id, status, note, responded_at)
     values ($1,$2,$3,$4,$5, now())
     on conflict (match_id, player_id)
       do update set status = excluded.status, note = excluded.note, responded_at = now()`,
    [TEAM_ID, w.match_id, w.player_id, w.status, w.note],
  );
}
console.log(`Wrote ${writes.length} answers.`);
await client.end();

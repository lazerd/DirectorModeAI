/**
 * Builds (or rebuilds) the PTL demo seasons.
 *
 *   node scripts/ptl-demo-seed.mjs          # rebuild both
 *   node scripts/ptl-demo-seed.mjs season   # just the season-in-progress
 *   node scripts/ptl-demo-seed.mjs draft    # just the live draft room
 *
 * Two seasons, because a committee member needs to see two different things:
 *
 *   demo-season — a league mid-flight. Full 12 teams across three divisions,
 *                 108 players, a completed draft, five nights published up
 *                 front, three of them played, live standings, and the
 *                 promotion/relegation picture forming. This is the "what does
 *                 PTL look like running" view.
 *
 *   demo-draft  — parked on the clock with a few picks already made, so the
 *                 visitor can open a captain's room and ACTUALLY DRAFT. This is
 *                 the one that sells it. Reading about a snake draft does
 *                 nothing; taking a player off the board does.
 *
 * SAFETY. Every player is @ptl.example.com, which lib/demo/emailGuard.ts
 * suppresses before any database lookup. The enrolment route separately refuses
 * to send anything at all for a season with is_demo, so a visitor who types
 * their own real address into the form still gets nothing.
 *
 * Rerunning deletes and rebuilds — ptl_seasons cascades to everything below it,
 * so a visitor who drafted all over the demo is undone by one command.
 */
import pg from 'pg';
import { readFileSync } from 'fs';
import { randomBytes } from 'crypto';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
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

const token = () => randomBytes(16).toString('hex');

// Deterministic pseudo-random so a rebuild produces the same league. A demo
// that reshuffles every time is impossible to talk someone through on a call.
let seedState = 20270301;
function rnd() {
  seedState = (seedState * 1103515245 + 12345) & 0x7fffffff;
  return seedState / 0x7fffffff;
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const between = (lo, hi) => lo + rnd() * (hi - lo);

const FIRST = [
  'Alex','Marcus','Ryan','Diego','Tyler','Cameron','Jordan','Nikhil','Sebastian','Trevor',
  'Lucas','Ethan','Andre','Brandon','Kyle','Mateo','Connor','Devin','Julian','Grant',
  'Spencer','Elliot','Preston','Rafael','Dominic','Hayden','Corey','Isaiah','Nolan','Vikram',
  'Chase','Brett','Emilio','Garrett','Shane','Tobias','Reid','Antoine','Malik','Owen',
  'Peter','Curtis','Damian','Felix','Jonah','Keaton','Leo','Miles','Rory','Simon',
  'Theo','Wesley','Zane','Adrian','Bryce','Colin','Dean','Evan','Finn','Gabe',
];
const LAST = [
  'Nakamura','Whitfield','Okafor','Delgado','Brennan','Castellanos','Ashford','Sandoval','Vasquez','Holloway',
  'Ramirez','Sterling','Bhattacharya','Kowalski','Mercer','Fontaine','Abernathy','Rios','Lindqvist','Pham',
  'Calloway','Weatherby','Santoro','Ferreira','Ellsworth','Moreau','Tanaka','Guzman','Larkin','Petrov',
  'Hargrove','Salazar','Chandler','Novak','Beaumont','Iyer','Radcliffe','Esposito','Kimura','Vance',
  'Ackerman','Bouchard','Cervantes','Dunmore','Eriksen','Fairbanks','Goldstein','Hutchins','Ivanov','Jarrett',
  'Kingsley','Lombardi','Marchetti','Nystrom','Ortega','Prescott','Quintero','Rousseau','Sinclair','Thorne',
];

const CLUBS = [
  'Sleepy Hollow','Orinda CC','Moraga CC','Lafayette Tennis Club','Claremont Club',
  'Berkeley Tennis Club','Diablo CC','Round Hill CC','Bay Club SF','Olympic Club',
  'Peninsula TC','Los Altos Hills CC','Silver Creek','Almaden CC','Harbor Bay','Mill Valley TC',
];

const TEAMS = [
  ['Ironwood', 'IRN', '#0f766e'],
  ['Ridgeline', 'RDG', '#1e3a5f'],
  ['Redline', 'RED', '#b91c1c'],
  ['Bayside', 'BAY', '#0369a1'],
  ['Nightfall', 'NGT', '#312e81'],
  ['Crosscourt', 'CRS', '#7c2d12'],
  ['Overtime', 'OVR', '#a16207'],
  ['Highwire', 'HWR', '#6d28d9'],
  ['Sandbar', 'SND', '#ca8a04'],
  ['Gaslamp', 'GAS', '#be123c'],
  ['Northgate', 'NRG', '#15803d'],
  ['Westbrook', 'WST', '#0e7490'],
];

const CAPTAINS = [
  'Marcus Whitfield','Diego Delgado','Ryan Brennan','Nikhil Iyer','Sebastian Moreau','Tyler Hargrove',
  'Cameron Sterling','Rafael Santoro','Julian Beaumont','Grant Ellsworth','Devin Okafor','Spencer Vance',
];

const SITES = [
  ['Sleepy Hollow Swim & Tennis Club', 'Orinda, CA'],
  ['Claremont Club', 'Oakland, CA'],
  ['Bay Club SF Tennis', 'San Francisco, CA'],
  ['Round Hill Country Club', 'Alamo, CA'],
];

/** Every name used once, so no duplicates in a 108-player pool. */
function makeNamePool(n) {
  const seen = new Set();
  const out = [];
  while (out.length < n) {
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

async function wipe(slug) {
  await db.query(`DELETE FROM ptl_seasons WHERE slug = $1`, [slug]);
}

/**
 * Season scaffolding shared by both demos: divisions, teams, and the pool.
 * `teamCount` players-per-roster times teams, plus a few spare so the draft
 * pool never runs dry and a visitor always has someone to take.
 */
async function scaffold({ slug, name, status, note, seedKind, teamCount, rosterSize, pickSeconds, spare }) {
  await wipe(slug);

  const { rows: [season] } = await db.query(
    `INSERT INTO ptl_seasons
       (name, slug, status, roster_size, pick_seconds, entry_cents, is_demo, demo_note, reset_seed,
        tagline, blurb)
     VALUES ($1,$2,$3,$4,$5,5000,TRUE,$6,$7,$8,$9)
     RETURNING id`,
    [
      name, slug, status, rosterSize, pickSeconds, note, seedKind,
      'A 5.0+ drafted-team league built around a three-hour night.',
      'Players enroll individually. Captains draft balanced rosters at a live snake draft. '
      + 'A division of four plays a full round robin in one night — you face all three rivals, '
      + 'every match rating-counted, the whole season grid published on day one.',
    ],
  );
  const seasonId = season.id;

  const divisions = [];
  for (const [tier, dName, code, nightly, finals, dow] of [
    [1, 'Premier', 'PREM', 30000, 60000, 3],
    [2, 'Championship', 'CHMP', 20000, 40000, 2],
    [3, 'Challenger', 'CHAL', 10000, 20000, 4],
  ]) {
    const { rows: [d] } = await db.query(
      `INSERT INTO ptl_divisions
         (season_id, name, short_code, tier, nightly_prize_cents, finals_prize_cents,
          day_of_week, start_time, end_time)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'18:00','21:00') RETURNING id`,
      [seasonId, dName, code, tier, nightly, finals, dow],
    );
    divisions.push({ id: d.id, name: dName, tier });
  }

  const teams = [];
  for (let i = 0; i < teamCount; i++) {
    const [tName, code, color] = TEAMS[i];
    const { rows: [t] } = await db.query(
      `INSERT INTO ptl_teams
         (season_id, name, short_code, color, team_token, draft_slot, captain_name,
          captain_email, captain_is_playing)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, team_token`,
      [
        seasonId, tName, code, color, token(), i + 1, CAPTAINS[i],
        `captain.${code.toLowerCase()}@ptl.example.com`,
        i % 3 !== 0, // a couple of non-playing captains, who protect two rather than one
      ],
    );
    teams.push({ id: t.id, token: t.team_token, name: tName, code });
  }

  const poolSize = teamCount * rosterSize + spare;
  const names = makeNamePool(poolSize);
  const entries = [];
  for (let i = 0; i < poolSize; i++) {
    // A believable 5.0+ spread: mostly 5.0, a tail of 5.5s, a couple of 6.0s.
    const ntrp = rnd() < 0.62 ? 5.0 : rnd() < 0.9 ? 5.5 : 6.0;
    const utr = Number(between(ntrp === 5.0 ? 9.6 : ntrp === 5.5 ? 11.4 : 12.8, ntrp === 5.0 ? 11.6 : ntrp === 5.5 ? 13.0 : 14.2).toFixed(2));
    const composite = Number((utr * 0.75 + (ntrp === 5.0 ? 10 : ntrp === 5.5 ? 12 : 14) * 0.25).toFixed(2));
    const { rows: [e] } = await db.query(
      `INSERT INTO ptl_entries
         (season_id, name, email, phone, home_club, ntrp, utr, wtn, composite_score,
          rating_source, rating_confidence, status, payment_status, player_token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'utr+ntrp','high','confirmed',$10,$11)
       RETURNING id`,
      [
        seasonId, names[i],
        `${names[i].toLowerCase().replace(/[^a-z]+/g, '.')}@ptl.example.com`,
        `555-01${String(i).padStart(2, '0')}`,
        pick(CLUBS), ntrp, utr,
        Number(between(2.5, 7.5).toFixed(2)),
        composite,
        rnd() < 0.8 ? 'paid' : 'unpaid',
        token(),
      ],
    );
    entries.push({ id: e.id, name: names[i], composite });
  }

  // A season still taking entries has no captains and no draft yet — creating
  // one would put an empty board on the demo and imply the field is settled.
  let draftId = null;
  if (teamCount > 0) {
    const { rows: [draft] } = await db.query(
      `INSERT INTO ptl_drafts (season_id, pick_seconds, rounds) VALUES ($1,$2,$3) RETURNING id`,
      [seasonId, pickSeconds, rosterSize],
    );
    draftId = draft.id;
  }

  return { seasonId, divisions, teams, entries, draftId, rosterSize };
}

/** Give each captain their protected player(s) before the draft opens. */
async function seedKeepers(ctx) {
  const { seasonId, teams, entries } = ctx;
  const { rows: caps } = await db.query(
    `SELECT id, captain_is_playing FROM ptl_teams WHERE season_id=$1 ORDER BY draft_slot`, [seasonId]);
  let cursor = 0;
  for (const t of caps) {
    const n = t.captain_is_playing ? 1 : 2;
    for (let k = 0; k < n; k++) {
      const entry = entries[cursor++];
      await db.query(
        `INSERT INTO ptl_keepers (season_id, team_id, entry_id) VALUES ($1,$2,$3)`,
        [seasonId, t.id, entry.id]);
      await db.query(
        `INSERT INTO ptl_roster (season_id, team_id, entry_id, acquired) VALUES ($1,$2,$3,'keeper')`,
        [seasonId, t.id, entry.id]);
    }
  }
  return cursor;
}

/**
 * Run the draft to completion through the REAL engine — expire the clock, let
 * ptl_tick auto-pick, repeat. The demo's rosters are therefore genuinely the
 * output of the same code a live draft would use, not hand-dealt rows.
 */
async function runDraftToCompletion(draftId) {
  await db.query(`SELECT ptl_start_draft($1)`, [draftId]);
  for (let guard = 0; guard < 400; guard++) {
    const { rows: [{ ptl_draft_state: st }] } = await db.query(`SELECT ptl_draft_state($1)`, [draftId]);
    if (st.status === 'complete') return;
    await db.query(`UPDATE ptl_drafts SET current_deadline_at = NOW() - INTERVAL '1 second' WHERE id=$1`, [draftId]);
    await db.query(`SELECT ptl_tick($1)`, [draftId]);
  }
  throw new Error('draft did not complete');
}

/** Strength order within each team — drives who plays the singles line. */
async function setLadders(seasonId) {
  await db.query(
    `WITH ranked AS (
       SELECT r.id, ROW_NUMBER() OVER (
                PARTITION BY r.team_id ORDER BY e.composite_score DESC NULLS LAST, e.name
              ) AS pos
         FROM ptl_roster r JOIN ptl_entries e ON e.id = r.entry_id
        WHERE r.season_id = $1
     )
     UPDATE ptl_roster SET ladder_position = ranked.pos FROM ranked WHERE ptl_roster.id = ranked.id`,
    [seasonId]);
}

/**
 * Publish the grid and play some of it.
 *
 * Results are written straight into ptl_meetings here rather than derived.
 * The authoritative cascade is src/lib/ptl/meeting.ts — this is seed data, and
 * the scores below are chosen so the outcome is unambiguous at level 1 or 2,
 * except for one deliberately crafted meeting that runs all the way to level 4
 * so the demo has a real example of the tiebreak chain on screen.
 */
async function seedSeasonPlay(ctx, { weeksPlayed, weeksTotal }) {
  const { seasonId, divisions } = ctx;
  const { rows: teams } = await db.query(
    `SELECT id, division_id, name FROM ptl_teams WHERE season_id=$1 ORDER BY short_code`, [seasonId]);

  const seasonStart = new Date('2027-03-01T00:00:00Z');
  let showcaseUsed = false;

  /*
   * A division's nights must land on the weekday the division actually says it
   * plays. The first cut offset each division by its tier, which produced a
   * Premier division advertising Wednesdays with five Friday fixtures on it —
   * the kind of detail a committee member spots in four seconds and then stops
   * trusting the rest of the page.
   */
  const firstNightFor = (dayOfWeek) => {
    const d = new Date(seasonStart);
    while (d.getUTCDay() !== dayOfWeek) d.setUTCDate(d.getUTCDate() + 1);
    return d;
  };

  for (const div of divisions) {
    const divTeams = teams.filter((t) => t.division_id === div.id);
    if (divTeams.length < 2) continue;

    // Premier plays Wednesdays, Championship Tuesdays, Challenger Thursdays —
    // matching the day_of_week written on each division row above.
    const dayOfWeek = [0, 3, 2, 4][div.tier];
    const first = firstNightFor(dayOfWeek);

    for (let week = 1; week <= weeksTotal; week++) {
      const playDate = new Date(first);
      playDate.setUTCDate(first.getUTCDate() + (week - 1) * 7);
      const [siteName, siteAddr] = SITES[(week + div.tier) % SITES.length];
      const played = week <= weeksPlayed;

      const { rows: [night] } = await db.query(
        `INSERT INTO ptl_nights
           (division_id, week_no, play_date, start_time, end_time, site_name, site_address,
            courts, is_finals, status)
         VALUES ($1,$2,$3,'18:00','21:00',$4,$5,4,$6,$7) RETURNING id`,
        [div.id, week, playDate.toISOString().slice(0, 10), siteName, siteAddr,
         week === weeksTotal, played ? 'complete' : 'scheduled'],
      );

      // A 4-team division plays a full round robin in one night: 3 rounds of 2
      // meetings, each meeting on 2 courts. That is the whole format.
      const pairings = [
        [[0, 1], [2, 3]],
        [[0, 2], [1, 3]],
        [[0, 3], [1, 2]],
      ];

      for (let round = 0; round < pairings.length; round++) {
        for (const [h, a] of pairings[round]) {
          if (!divTeams[h] || !divTeams[a]) continue;

          // One showcase meeting per demo that goes the full distance.
          const showcase = played && !showcaseUsed && div.tier === 1 && week === 2 && round === 0;
          if (showcase) showcaseUsed = true;

          let homeLines, awayLines, homeGames, awayGames, result, level;
          if (!played) {
            [homeLines, awayLines, homeGames, awayGames, result, level] = [0, 0, 0, 0, 'pending', null];
          } else if (showcase) {
            // 1-1 on lines, level on games — decided on combined tiebreak points.
            [homeLines, awayLines, homeGames, awayGames, result, level] = [1, 1, 11, 11, 'away', 4];
          } else {
            const homeWins = rnd() < 0.5;
            const sweep = rnd() < 0.45;
            homeLines = homeWins ? (sweep ? 2 : 1) : (sweep ? 0 : 1);
            awayLines = 2 - homeLines;
            const margin = Math.floor(between(1, 6));
            homeGames = homeWins ? 12 + margin : 12 - margin;
            awayGames = homeWins ? 12 - margin : 12 + margin;
            result = homeWins ? 'home' : 'away';
            level = sweep ? 1 : 2;
          }

          const { rows: [meeting] } = await db.query(
            `INSERT INTO ptl_meetings
               (night_id, division_id, round_no, home_team_id, away_team_id, result,
                home_games, away_games, home_lines_won, away_lines_won, decided_at_level, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
            [night.id, div.id, round + 1, divTeams[h].id, divTeams[a].id, result,
             homeGames, awayGames, homeLines, awayLines, level, played ? 'complete' : 'pending'],
          );

          for (const [i, lineType] of ['singles', 'doubles'].entries()) {
            const lineHomeGames = played ? Math.round(homeGames / 2) + (i === 0 ? homeGames % 2 : 0) : null;
            const lineAwayGames = played ? Math.round(awayGames / 2) + (i === 0 ? awayGames % 2 : 0) : null;
            const lineWinner = !played
              ? null
              : homeLines === 2 ? 'home'
              : awayLines === 2 ? 'away'
              : i === 0 ? 'home' : 'away';
            await db.query(
              `INSERT INTO ptl_lines
                 (meeting_id, line_type, score, home_games, away_games, winner, court_label,
                  score_token, status, reported_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
              [
                meeting.id, lineType,
                played ? `${lineHomeGames >= lineAwayGames ? '4-2 4-3' : '2-4 3-4'}` : null,
                lineHomeGames, lineAwayGames, lineWinner,
                `Court ${round * 2 + i + 1}`, token(),
                played ? 'complete' : 'pending',
                played ? new Date().toISOString() : null,
              ],
            );
          }

          if (showcase) {
            // The two 7-point tiebreaks split, so combined points decide it:
            // home 7+4 = 11, away 5+7 = 12. Away by one point, at level 4.
            await db.query(
              `INSERT INTO ptl_shootouts (meeting_id, kind, home_pts, away_pts)
               VALUES ($1,'tb7_singles',7,5), ($1,'tb7_doubles',4,7)`,
              [meeting.id]);
          }
        }
      }
    }
  }
}

// ============================================
// The two demos
// ============================================

async function seedSeasonDemo() {
  console.log('Building demo-season …');
  const ctx = await scaffold({
    slug: 'demo-season',
    name: 'Spring 2027',
    status: 'running',
    note: 'Sample season — built for the USTA NorCal 5.0+ sub-committee.',
    seedKind: 'season',
    teamCount: 12,
    rosterSize: 9,
    pickSeconds: 90,
    spare: 14,
  });

  await seedKeepers(ctx);
  await runDraftToCompletion(ctx.draftId);
  await setLadders(ctx.seasonId);
  await seedSeasonPlay(ctx, { weeksPlayed: 3, weeksTotal: 5 });

  const { rows: [{ count }] } = await db.query(
    `SELECT count(*) FROM ptl_roster WHERE season_id=$1`, [ctx.seasonId]);
  console.log(`  12 teams · 3 divisions · ${count} drafted · 5 nights, 3 played`);
  return ctx;
}

async function seedDraftDemo() {
  console.log('Building demo-draft …');
  const ctx = await scaffold({
    slug: 'demo-draft',
    name: 'Fall 2027 Draft',
    status: 'drafting',
    note: 'Live draft room — pick a player and watch the board move.',
    seedKind: 'draft',
    teamCount: 12,
    rosterSize: 9,
    // A long clock on purpose: a visitor reading the page must not have the
    // draft auto-pick out from under them while they work out what it is.
    pickSeconds: 600,
    spare: 30,
  });

  await seedKeepers(ctx);
  await db.query(`SELECT ptl_start_draft($1)`, [ctx.draftId]);

  /*
   * A handful of real picks so the board has something on it. Made through
   * ptl_make_pick rather than by expiring the clock, because a tick records the
   * pick as an auto-pick — and a board where every single name is tagged
   * "auto" tells a visitor the captains never showed up, which is the opposite
   * of the story.
   */
  for (let i = 0; i < 7; i++) {
    const { rows: [{ ptl_draft_state: st }] } = await db.query(`SELECT ptl_draft_state($1)`, [ctx.draftId]);
    if (st.status !== 'live' || !st.on_the_clock_team_id) break;
    const { rows: [best] } = await db.query(
      `SELECT e.id FROM ptl_entries e
        WHERE e.season_id = $1 AND e.status = 'confirmed'
          AND NOT EXISTS (SELECT 1 FROM ptl_roster r WHERE r.season_id = $1 AND r.entry_id = e.id)
        ORDER BY e.composite_score DESC NULLS LAST, e.created_at ASC LIMIT 1`,
      [ctx.seasonId],
    );
    if (!best) break;
    await db.query(`SELECT ptl_make_pick($1,$2,$3,false,$4)`,
      [ctx.draftId, st.on_the_clock_team_id, best.id, 'captain']);
  }
  await db.query(
    `UPDATE ptl_drafts SET current_deadline_at = NOW() + (pick_seconds || ' seconds')::INTERVAL WHERE id=$1`,
    [ctx.draftId]);

  const { rows: [{ ptl_draft_state: st }] } = await db.query(`SELECT ptl_draft_state($1)`, [ctx.draftId]);
  const { rows: [onClock] } = await db.query(
    `SELECT name, short_code, team_token FROM ptl_teams WHERE id=$1`, [st.on_the_clock_team_id]);

  console.log(`  ${st.picks_made} picks made · ${onClock.name} on the clock`);
  return { ...ctx, onClock };
}

async function seedEnrollDemo() {
  console.log('Building demo-enroll …');
  const ctx = await scaffold({
    slug: 'demo-enroll',
    name: 'Fall 2027',
    status: 'enrolling',
    note: 'Enrolment is open — try the sign-up form.',
    seedKind: 'enroll',
    teamCount: 0,
    rosterSize: 9,
    pickSeconds: 90,
    spare: 64,
  });

  await db.query(
    `UPDATE ptl_seasons
        SET enroll_opens_at = NOW() - INTERVAL '10 days',
            enroll_closes_at = NOW() + INTERVAL '30 days'
      WHERE id = $1`,
    [ctx.seasonId],
  );

  console.log(`  64 already enrolled · open for 30 more days`);
  return ctx;
}

// ============================================

const which = process.argv[2];
await db.connect();
try {
  let draftCtx = null;
  if (!which || which === 'season') await seedSeasonDemo();
  if (!which || which === 'draft') draftCtx = await seedDraftDemo();
  if (!which || which === 'enroll') await seedEnrollDemo();

  const base = env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  console.log('\nDemo links');
  console.log(`  League      ${base}/ptl?season=demo-season`);
  console.log(`  Enrolment   ${base}/ptl/enroll?season=demo-enroll`);
  console.log(`  Live board  ${base}/ptl/draft/board?season=demo-draft`);
  if (draftCtx?.onClock) {
    console.log(`  Draft room  ${base}/ptl/draft/${draftCtx.onClock.team_token}`);
    console.log(`              (${draftCtx.onClock.name} — on the clock right now)`);
  }
  console.log('\nRebuild any time with:  node scripts/ptl-demo-seed.mjs\n');
} finally {
  await db.end();
}

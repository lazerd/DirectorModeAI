/**
 * PTL draft engine check.
 *
 * Builds a throwaway season in the real database, runs the draft through the
 * cases that actually break drafts, then deletes everything it made.
 *
 * The one that matters is #3: two captains tapping the same player in the same
 * instant, from two separate connections. That is not a rare edge case — it is
 * what a draft room does every time a run starts on a position. It has to be
 * tested with real concurrent connections, because a single-client loop will
 * pass no matter how wrong the locking is.
 *
 *   node scripts/ptl-draft-check.mjs
 */
import pg from 'pg';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
);

function client() {
  const u = new URL(env.DATABASE_URL);
  return new pg.Client({
    host: u.hostname,
    port: u.port || 5432,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.slice(1) || 'postgres',
    ssl: { rejectUnauthorized: false },
  });
}

const SLUG = `ptl-check-${Date.now()}`;
let pass = 0;
let fail = 0;

function ok(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Postgres wraps our RAISE messages; pull the PTL_ code back out. */
function code(err) {
  const m = /PTL_[A-Z_]+/.exec(err?.message || '');
  return m ? m[0] : err?.message || 'unknown';
}

const db = client();
await db.connect();

let seasonId;
try {
  // ---------- build a season: 4 teams, roster of 3, 20 in the pool ----------
  const { rows: [season] } = await db.query(
    `INSERT INTO ptl_seasons (name, slug, status, roster_size, pick_seconds)
     VALUES ('PTL Check', $1, 'drafting', 3, 90) RETURNING id`, [SLUG]);
  seasonId = season.id;

  for (const [tier, name, sc] of [[1, 'Premier', 'PREM'], [2, 'Championship', 'CHMP']]) {
    await db.query(
      `INSERT INTO ptl_divisions (season_id, name, short_code, tier) VALUES ($1,$2,$3,$4)`,
      [seasonId, name, sc, tier]);
  }

  const teams = [];
  for (let i = 1; i <= 4; i++) {
    const { rows: [t] } = await db.query(
      `INSERT INTO ptl_teams (season_id, name, short_code, team_token, draft_slot, captain_name)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [seasonId, `Team ${i}`, `T${i}`, `${SLUG}-team-${i}`, i, `Captain ${i}`]);
    teams.push(t.id);
  }

  const entries = [];
  for (let i = 1; i <= 20; i++) {
    const { rows: [e] } = await db.query(
      `INSERT INTO ptl_entries (season_id, name, email, ntrp, composite_score, status, player_token)
       VALUES ($1,$2,$3,5.0,$4,'confirmed',$5) RETURNING id`,
      [seasonId, `Player ${i}`, `p${i}@${SLUG}.test`, 12 - i * 0.1, `${SLUG}-p-${i}`]);
    entries.push(e.id);
  }

  const { rows: [draft] } = await db.query(
    `INSERT INTO ptl_drafts (season_id, pick_seconds, rounds) VALUES ($1, 90, 3) RETURNING id`,
    [seasonId]);
  const draftId = draft.id;

  console.log(`\nPTL draft engine — season ${SLUG}\n`);

  // ---------- 1. start ----------
  const { rows: [{ ptl_start_draft: started }] } = await db.query(
    `SELECT ptl_start_draft($1)`, [draftId]);
  ok('draft starts on pick 1, team in slot 1', started.current_pick_no === 1 && started.on_the_clock_team_id === teams[0]);
  ok('a deadline is set on start', !!started.current_deadline_at);

  // ---------- 2. out-of-turn is refused ----------
  try {
    await db.query(`SELECT ptl_make_pick($1,$2,$3)`, [draftId, teams[2], entries[0]]);
    ok('team 3 cannot pick during team 1\'s turn', false, 'the pick was allowed');
  } catch (e) {
    ok('team 3 cannot pick during team 1\'s turn', code(e) === 'PTL_NOT_YOUR_TURN', code(e));
  }

  // ---------- 3. THE RACE: two connections, same player, same moment ----------
  const a = client();
  const b = client();
  await a.connect();
  await b.connect();
  const contested = entries[0];
  const results = await Promise.allSettled([
    a.query(`SELECT ptl_make_pick($1,$2,$3,false,'A')`, [draftId, teams[0], contested]),
    b.query(`SELECT ptl_make_pick($1,$2,$3,false,'B')`, [draftId, teams[0], contested]),
  ]);
  await a.end();
  await b.end();

  const won = results.filter((r) => r.status === 'fulfilled').length;
  const lost = results.filter((r) => r.status === 'rejected');
  ok('exactly one of two simultaneous picks for the same player wins', won === 1,
    `${won} succeeded`);
  ok('the loser is told why, not left hanging',
    lost.length === 1 && ['PTL_ENTRY_ALREADY_DRAFTED', 'PTL_NOT_YOUR_TURN'].includes(code(lost[0].reason)),
    lost.map((l) => code(l.reason)).join(','));

  const { rows: [{ count: rosterCount }] } = await db.query(
    `SELECT count(*) FROM ptl_roster WHERE season_id=$1 AND entry_id=$2`, [seasonId, contested]);
  ok('the contested player is on exactly one roster', Number(rosterCount) === 1, `${rosterCount} rows`);

  // ---------- 4. the same player cannot be taken again later ----------
  try {
    await db.query(`SELECT ptl_make_pick($1,$2,$3)`, [draftId, teams[1], contested]);
    ok('an already-drafted player cannot be picked again', false, 'the pick was allowed');
  } catch (e) {
    ok('an already-drafted player cannot be picked again', code(e) === 'PTL_ENTRY_ALREADY_DRAFTED', code(e));
  }

  // ---------- 5. the clock only fires when it has actually expired ----------
  const before = await db.query(`SELECT count(*) FROM ptl_draft_picks WHERE draft_id=$1`, [draftId]);
  await db.query(`SELECT ptl_tick($1)`, [draftId]);
  const after = await db.query(`SELECT count(*) FROM ptl_draft_picks WHERE draft_id=$1`, [draftId]);
  ok('a tick before the deadline changes nothing', before.rows[0].count === after.rows[0].count);

  // Expire it by hand rather than sleeping 90s.
  await db.query(`UPDATE ptl_drafts SET current_deadline_at = NOW() - INTERVAL '1 second' WHERE id=$1`, [draftId]);

  // Team 2 is on the clock and queued player 9 third; 1 and 2 are gone/taken.
  const { rows: [{ on_the_clock_team_id: clockTeam }] } = await db.query(`SELECT ptl_draft_state($1)`, [draftId])
    .then((r) => ({ rows: [r.rows[0].ptl_draft_state] }));
  await db.query(
    `INSERT INTO ptl_draft_queue (draft_id, team_id, entry_id, rank) VALUES ($1,$2,$3,1)`,
    [draftId, clockTeam, entries[8]]);

  await db.query(`SELECT ptl_tick($1)`, [draftId]);
  const { rows: [autoPick] } = await db.query(
    `SELECT team_id, entry_id, is_auto FROM ptl_draft_picks WHERE draft_id=$1 ORDER BY pick_no DESC LIMIT 1`,
    [draftId]);
  ok('an expired clock auto-picks the top of that captain\'s queue',
    autoPick.entry_id === entries[8] && autoPick.is_auto === true && autoPick.team_id === clockTeam);

  // ---------- 6. duplicate ticks are harmless ----------
  await db.query(`UPDATE ptl_drafts SET current_deadline_at = NOW() - INTERVAL '1 second' WHERE id=$1`, [draftId]);
  const c = client();
  const d2 = client();
  await c.connect();
  await d2.connect();
  const n0 = (await db.query(`SELECT count(*)::int n FROM ptl_draft_picks WHERE draft_id=$1`, [draftId])).rows[0].n;
  await Promise.allSettled([
    c.query(`SELECT ptl_tick($1)`, [draftId]),
    d2.query(`SELECT ptl_tick($1)`, [draftId]),
  ]);
  await c.end();
  await d2.end();
  const n1 = (await db.query(`SELECT count(*)::int n FROM ptl_draft_picks WHERE draft_id=$1`, [draftId])).rows[0].n;
  ok('two simultaneous ticks produce one pick, not two', n1 - n0 === 1, `${n1 - n0} picks`);

  // ---------- 7. undo ----------
  const lastBefore = (await db.query(
    `SELECT pick_no, entry_id FROM ptl_draft_picks WHERE draft_id=$1 ORDER BY pick_no DESC LIMIT 1`,
    [draftId])).rows[0];
  const { rows: [{ ptl_undo_last_pick: undone }] } = await db.query(`SELECT ptl_undo_last_pick($1)`, [draftId]);
  const stillRostered = (await db.query(
    `SELECT count(*)::int n FROM ptl_roster WHERE season_id=$1 AND entry_id=$2`,
    [seasonId, lastBefore.entry_id])).rows[0].n;
  ok('undo hands the clock back to that pick', undone.current_pick_no === lastBefore.pick_no);
  ok('undo takes the player back off the roster', stillRostered === 0);

  // ---------- 8. run it to completion ----------
  let guard = 0;
  for (;;) {
    const { rows: [{ ptl_draft_state: st }] } = await db.query(`SELECT ptl_draft_state($1)`, [draftId]);
    if (st.status === 'complete') break;
    if (++guard > 100) { ok('draft reaches completion', false, 'did not finish in 100 picks'); break; }
    await db.query(`UPDATE ptl_drafts SET current_deadline_at = NOW() - INTERVAL '1 second' WHERE id=$1`, [draftId]);
    await db.query(`SELECT ptl_tick($1)`, [draftId]);
  }

  const { rows: sizes } = await db.query(
    `SELECT t.short_code, count(r.id)::int n FROM ptl_teams t
       LEFT JOIN ptl_roster r ON r.team_id = t.id
      WHERE t.season_id=$1 GROUP BY t.short_code ORDER BY t.short_code`, [seasonId]);
  ok('every team ends with a full roster of 3', sizes.every((s) => s.n === 3),
    sizes.map((s) => `${s.short_code}:${s.n}`).join(' '));

  const { rows: [{ n: unplaced }] } = await db.query(
    `SELECT count(*)::int n FROM ptl_teams WHERE season_id=$1 AND division_id IS NULL`, [seasonId]);
  ok('completing the draft places every team in a division', unplaced === 0, `${unplaced} unplaced`);

  const { rows: placed } = await db.query(
    `SELECT d.short_code, count(t.id)::int n FROM ptl_divisions d
       LEFT JOIN ptl_teams t ON t.division_id = d.id
      WHERE d.season_id=$1 GROUP BY d.short_code ORDER BY d.short_code`, [seasonId]);
  ok('divisions are filled evenly', placed.every((p) => p.n === 2),
    placed.map((p) => `${p.short_code}:${p.n}`).join(' '));

  const { rows: [{ n: dupes }] } = await db.query(
    `SELECT count(*)::int n FROM (
       SELECT entry_id FROM ptl_roster WHERE season_id=$1 GROUP BY entry_id HAVING count(*) > 1
     ) x`, [seasonId]);
  ok('no player is on two rosters', dupes === 0, `${dupes} duplicated`);

  // ---------- 9. roster minimums ----------
  // A gendered season needs as many women as men on a roster. The rule: take
  // anyone until your remaining picks are exactly what your minimums still
  // require, then only what you need. This is the check that stops a captain
  // drafting eight men and turning up unable to field a meeting.
  //
  // Roster of 6 with minimums of 2 and 2 leaves two picks of genuine slack, so
  // the test can watch the constraint switch on rather than starting inside it.
  console.log('');
  console.log('-- roster minimums --');

  const { rows: [gs] } = await db.query(
    `INSERT INTO ptl_seasons (name, slug, status, roster_size, pick_seconds,
                              category, min_men, min_women)
     VALUES ('PTL Gender Check', $1, 'drafting', 6, 90, 'mixed', 2, 2) RETURNING id`,
    [`${SLUG}-gender`]);
  const gSeason = gs.id;

  const gTeams = [];
  for (let i = 1; i <= 2; i++) {
    const { rows: [t] } = await db.query(
      `INSERT INTO ptl_teams (season_id, name, short_code, team_token, draft_slot)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [gSeason, `G${i}`, `G${i}`, `${SLUG}-g-${i}`, i]);
    gTeams.push(t.id);
  }

  const men = [];
  const women = [];
  for (let i = 0; i < 20; i++) {
    const gender = i % 2 === 0 ? 'm' : 'f';
    const { rows: [e] } = await db.query(
      `INSERT INTO ptl_entries (season_id, name, email, ntrp, composite_score, status, player_token, gender)
       VALUES ($1,$2,$3,5.0,$4,'confirmed',$5,$6) RETURNING id`,
      [gSeason, `${gender === 'm' ? 'Man' : 'Woman'} ${i}`, `g${i}@${SLUG}.test`, 12 - i * 0.1,
       `${SLUG}-g-p-${i}`, gender]);
    (gender === 'm' ? men : women).push(e.id);
  }

  const { rows: [gd] } = await db.query(
    `INSERT INTO ptl_drafts (season_id, pick_seconds, rounds) VALUES ($1, 90, 6) RETURNING id`,
    [gSeason]);
  const gDraft = gd.id;
  await db.query(`SELECT ptl_start_draft($1)`, [gDraft]);

  const needs = async (team) =>
    (await db.query(`SELECT ptl_roster_needs($1) n`, [team])).rows[0].n;
  const onClock = async () =>
    (await db.query(`SELECT ptl_draft_state($1) s`, [gDraft])).rows[0].s.on_the_clock_team_id;

  // Feed whoever is on the clock a man, until G1 has three of them. Asking who
  // is up rather than assuming the snake order keeps the test honest.
  const takenMen = new Set();
  let nextMan = 0;
  while ((await needs(gTeams[0])).men < 2) {
    const team = await onClock();
    const m = men[nextMan++];
    await db.query(`SELECT ptl_make_pick($1,$2,$3)`, [gDraft, team, m]);
    takenMen.add(m);
  }

  let n = await needs(gTeams[0]);
  ok('with slack left, a roster is not yet constrained',
    n.must_take === null && n.slots_left > n.men_needed + n.women_needed, JSON.stringify(n));

  // Fill G1 with men until the constraint binds.
  while ((await needs(gTeams[0])).must_take === null) {
    const team = await onClock();
    const m = men[nextMan++];
    await db.query(`SELECT ptl_make_pick($1,$2,$3)`, [gDraft, team, m]);
  }

  n = await needs(gTeams[0]);
  ok('the constraint switches on when the remaining picks are exactly what is owed',
    n.must_take === 'f' && n.women_needed === n.slots_left, JSON.stringify(n));

  // Wait for G1's turn, then try another man.
  while ((await onClock()) !== gTeams[0]) {
    await db.query(`SELECT ptl_make_pick($1,$2,$3)`, [gDraft, await onClock(), women[0]]).catch(async () => {
      await db.query(`SELECT ptl_make_pick($1,$2,$3)`, [gDraft, await onClock(), men[nextMan++]]);
    });
  }

  try {
    await db.query(`SELECT ptl_make_pick($1,$2,$3)`, [gDraft, gTeams[0], men[nextMan]]);
    ok('a captain cannot draft past the roster minimum', false, 'the pick was allowed');
  } catch (e) {
    ok('a captain cannot draft past the roster minimum', code(e) === 'PTL_ROSTER_MINIMUM', code(e));
  }

  const freeWoman = women.find((w) => w !== women[0]);
  await db.query(`SELECT ptl_make_pick($1,$2,$3)`, [gDraft, gTeams[0], freeWoman]);
  ok('the pick the minimum requires is accepted', true);

  // Auto-pick must obey it too: queue a locked team nothing but men.
  let locked = null;
  for (const t of gTeams) {
    const ns = await needs(t);
    if (ns.must_take === 'f' && ns.slots_left > 0) { locked = t; break; }
  }
  if (locked) {
    const spare = men.slice(nextMan + 1, nextMan + 3);
    for (const [i, m] of spare.entries()) {
      await db.query(
        `INSERT INTO ptl_draft_queue (draft_id, team_id, entry_id, rank) VALUES ($1,$2,$3,$4)`,
        [gDraft, locked, m, i + 1]);
    }
    while ((await onClock()) !== locked) {
      const team = await onClock();
      const ns = await needs(team);
      const pool = ns.must_take === 'f' ? women : men;
      const pick = pool.find(async () => true);
      await db.query(
        `SELECT ptl_make_pick($1,$2,(
            SELECT e.id FROM ptl_entries e
             WHERE e.season_id=$3 AND e.status='confirmed'
               AND NOT EXISTS (SELECT 1 FROM ptl_roster r WHERE r.season_id=$3 AND r.entry_id=e.id)
               AND ptl_gender_allowed($2, e.gender)
             ORDER BY e.composite_score DESC LIMIT 1))`,
        [gDraft, team, gSeason]);
      void pick;
    }
    await db.query(`UPDATE ptl_drafts SET current_deadline_at = NOW() - INTERVAL '1 second' WHERE id=$1`, [gDraft]);
    await db.query(`SELECT ptl_tick($1)`, [gDraft]);
    const { rows: [autoGender] } = await db.query(
      `SELECT e.gender FROM ptl_draft_picks p JOIN ptl_entries e ON e.id = p.entry_id
        WHERE p.draft_id=$1 ORDER BY p.pick_no DESC LIMIT 1`, [gDraft]);
    ok('auto-pick skips an all-male queue when women are owed', autoGender.gender === 'f', autoGender.gender);
  }

  // Run it out and check every roster is legal.
  for (let guard = 0; guard < 60; guard++) {
    const { rows: [{ ptl_draft_state: st }] } = await db.query(`SELECT ptl_draft_state($1)`, [gDraft]);
    if (st.status === 'complete') break;
    await db.query(`UPDATE ptl_drafts SET current_deadline_at = NOW() - INTERVAL '1 second' WHERE id=$1`, [gDraft]);
    await db.query(`SELECT ptl_tick($1)`, [gDraft]);
  }
  const { rows: comp } = await db.query(
    `SELECT t.short_code,
            count(*) FILTER (WHERE e.gender='m')::int m,
            count(*) FILTER (WHERE e.gender='f')::int f
       FROM ptl_teams t
       JOIN ptl_roster r ON r.team_id = t.id
       JOIN ptl_entries e ON e.id = r.entry_id
      WHERE t.season_id=$1 GROUP BY t.short_code ORDER BY t.short_code`, [gSeason]);
  ok('every finished roster meets both minimums',
    comp.length === 2 && comp.every((c) => c.m >= 2 && c.f >= 2),
    comp.map((c) => `${c.short_code}:${c.m}M/${c.f}F`).join(' '));

  await db.query(`DELETE FROM ptl_seasons WHERE id=$1`, [gSeason]);


} finally {
  if (seasonId) await db.query(`DELETE FROM ptl_seasons WHERE id=$1`, [seasonId]);
  await db.end();
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exitCode = fail > 0 ? 1 : 0;

/**
 * The Partner Finder check.
 *
 * Runs against PROD through the same RPCs the app calls, on two throwaway
 * clubs and throwaway accounts, and deletes all of it in `finally`:
 *
 *   1. post           — a member posts; non-members, past times and the daily
 *                       limit are refused
 *   2. recipients     — only members whose level fits are emailed; unrated only
 *                       when allowed; the poster, the crew and anyone who
 *                       turned game emails off are left out
 *   3. the race       — two claims for the LAST spot at the same instant:
 *                       exactly one wins, every round
 *   4. auto-close     — the game is 'full' the moment the last spot goes
 *   5. cancel re-opens — a player drops out and the game is open again
 *   6. poster cancel  — only the poster can call it off, and nobody can join after
 *   7. expiry         — a past game that never filled is marked expired
 *   8. RLS canary     — signed in as a real member: no other member's email or
 *                       phone; an owner of ANOTHER club and anon see nothing
 *
 *   node scripts/partner-finder-check.mjs
 *
 * Sends no email: it never calls the API routes, only the database functions.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import crypto from 'crypto';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anonClient = () => createClient(URL_, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

const RUN = crypto.randomBytes(4).toString('hex');
const PASSWORD = `Pf-${crypto.randomBytes(12).toString('hex')}!`;
const emailFor = (who) => `pf-check-${RUN}-${who}@clubmode-check.invalid`;

let failures = 0;
const check = (name, pass, detail = '') => {
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const users = {};
const clubIds = [];

async function makeUser(who, fullName) {
  const { data, error } = await admin.auth.admin.createUser({
    email: emailFor(who),
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) throw new Error(`createUser ${who}: ${error.message}`);
  users[who] = data.user.id;
  await admin.from('profiles').update({ full_name: fullName }).eq('id', data.user.id);
  return data.user.id;
}

async function signIn(who) {
  const c = anonClient();
  const { error } = await c.auth.signInWithPassword({ email: emailFor(who), password: PASSWORD });
  if (error) throw new Error(`signIn ${who}: ${error.message}`);
  return c;
}

const rpc = async (fn, args) => {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
};

const inDays = (d) => new Date(Date.now() + d * 864e5).toISOString();

async function post(clubId, userId, overrides = {}) {
  return rpc('pf_post_game', {
    p_club: clubId,
    p_user: userId,
    p_starts_at: inDays(2),
    p_duration: 90,
    p_format: 'doubles',
    p_spots: 2,
    p_rating_min: 3.0,
    p_rating_max: 3.5,
    p_include_unrated: false,
    p_court: '',
    p_note: 'check note with 555-0100',
    p_daily_limit: 3,
    ...overrides,
  });
}

async function gameRow(id) {
  const { data } = await admin.from('pf_games').select('status, filled_at').eq('id', id).single();
  return data;
}

async function cleanup() {
  for (const id of clubIds) await admin.from('cc_clubs').delete().eq('id', id);
  if (users.ownerA) await admin.from('cc_vault_players').delete().eq('director_id', users.ownerA);
  await admin.from('master_players').delete().like('email', `pf-check-${RUN}-%`);
  for (const id of Object.values(users)) await admin.auth.admin.deleteUser(id);
}

try {
  console.log(`run ${RUN}\n`);

  // ---- setup ------------------------------------------------------------
  await makeUser('ownerA', 'Olive Owner');
  await makeUser('poster', 'Mary Beth Poster');
  await makeUser('m35', 'Ann Vault');
  await makeUser('m45', 'Bob Hub');
  await makeUser('unrated', 'Cy Unrated');
  await makeUser('crew', 'Dee Crew');
  await makeUser('ownerB', 'Otto Otherclub');

  for (const [key, owner] of [['A', users.ownerA], ['B', users.ownerB]]) {
    const { data, error } = await admin
      .from('cc_clubs')
      .insert({ name: `PF Check ${key} ${RUN}`, slug: `pf-check-${key.toLowerCase()}-${RUN}`, owner_id: owner, timezone: 'America/New_York' })
      .select('id')
      .single();
    if (error) throw error;
    clubIds.push(data.id);
  }
  const [clubA, clubB] = clubIds;

  const { error: memErr } = await admin.from('cc_club_members').insert([
    { club_id: clubA, user_id: users.ownerA, role: 'owner' },
    { club_id: clubA, user_id: users.poster, role: 'member' },
    { club_id: clubA, user_id: users.m35, role: 'member' },
    { club_id: clubA, user_id: users.m45, role: 'member' },
    { club_id: clubA, user_id: users.unrated, role: 'member' },
    { club_id: clubA, user_id: users.crew, role: 'maintenance' },
    { club_id: clubB, user_id: users.ownerB, role: 'owner' },
  ]);
  if (memErr) throw memErr;

  // Levels from both sources: the club's PlayerVault, and the person hub.
  await admin.from('cc_vault_players').insert({ director_id: users.ownerA, full_name: 'Ann Vault', email: emailFor('m35'), usta_rating: 3.5 });
  await admin.from('master_players').insert([
    { email: emailFor('m45'), full_name: 'Bob Hub', ntrp: 4.5, ntrp_source: 'self', ntrp_updated_at: new Date().toISOString() },
    { email: emailFor('poster'), full_name: 'Mary Beth Poster', ntrp: 3.0, ntrp_source: 'self', ntrp_updated_at: new Date().toISOString() },
    // The crew member is rated in range, so leaving them out proves the role rule, not the level rule.
    { email: emailFor('crew'), full_name: 'Dee Crew', ntrp: 3.5, ntrp_source: 'self', ntrp_updated_at: new Date().toISOString() },
  ]);

  // ---- 1. post ------------------------------------------------------------
  const roster = await rpc('pf_member_roster', { p_club: clubA, p_user: null });
  const lvl = Object.fromEntries(roster.map((r) => [r.user_id, r]));
  check('roster reads the vault level (club) and the hub level (self)',
    Number(lvl[users.m35]?.ntrp) === 3.5 && lvl[users.m35]?.ntrp_source === 'club' &&
    Number(lvl[users.m45]?.ntrp) === 4.5 && lvl[users.m45]?.ntrp_source === 'self');
  check('roster leaves out the maintenance crew', !lvl[users.crew]);

  const p1 = await post(clubA, users.poster);
  check('a member can post a game', p1.ok === true && !!p1.game_id, JSON.stringify(p1));
  const game = p1.game_id;

  const outsider = await post(clubA, users.ownerB);
  check('an owner of another club cannot post at this one', outsider.ok === false && outsider.error === 'not_member');
  const crewPost = await post(clubA, users.crew);
  check('the maintenance crew cannot post', crewPost.ok === false && crewPost.error === 'not_member');
  const past = await post(clubA, users.poster, { p_starts_at: inDays(-1) });
  check('a game in the past is refused', past.ok === false && past.error === 'in_past');

  const p2 = await post(clubA, users.poster, { p_include_unrated: true, p_spots: 1, p_rating_min: null, p_rating_max: null });
  const p3 = await post(clubA, users.poster, { p_include_unrated: true });
  const p4 = await post(clubA, users.poster);
  check('the daily post limit holds at 3', p2.ok && p3.ok && p4.ok === false && p4.error === 'rate_limited', `p4=${JSON.stringify(p4)}`);

  // ---- 2. recipients ------------------------------------------------------
  const ids = (rows) => new Set(rows.map((r) => r.user_id));
  const r1 = ids(await rpc('pf_game_recipients', { p_game: game, p_limit: 50 }));
  check('3.0-3.5, no unrated: only the 3.5 member is emailed',
    r1.size === 1 && r1.has(users.m35), `got ${[...r1].map((id) => Object.keys(users).find((k) => users[k] === id)).join(',')}`);

  const r3 = ids(await rpc('pf_game_recipients', { p_game: p3.game_id, p_limit: 50 }));
  check('3.0-3.5 with unrated: the 3.5 member and the unrated members, never the 4.5, the poster or the crew',
    r3.has(users.m35) && r3.has(users.unrated) && r3.has(users.ownerA) && !r3.has(users.m45) && !r3.has(users.poster) && !r3.has(users.crew),
    `size ${r3.size}`);

  const r2 = ids(await rpc('pf_game_recipients', { p_game: p2.game_id, p_limit: 50 }));
  check('any level: everyone but the poster and the crew', r2.size === 4 && !r2.has(users.poster) && !r2.has(users.crew));

  await admin.from('pf_member_prefs').upsert({ club_id: clubA, user_id: users.unrated, notify_games: false, phone: '555-0199', share_phone: false });
  const r3b = ids(await rpc('pf_game_recipients', { p_game: p3.game_id, p_limit: 50 }));
  check('a member who turned game emails off is not emailed', !r3b.has(users.unrated) && r3b.has(users.m35));

  const capped = await rpc('pf_game_recipients', { p_game: p2.game_id, p_limit: 1 });
  check('the recipient cap is respected', capped.length === 1);

  // ---- 3. the race --------------------------------------------------------
  const first = await rpc('pf_claim_spot', { p_game: game, p_user: users.m35, p_via: 'email' });
  check('first claim takes a spot and leaves one', first.result === 'joined' && first.spots_left === 1 && first.now_full === false);
  const own = await rpc('pf_claim_spot', { p_game: game, p_user: users.poster, p_via: 'board' });
  check('the poster cannot claim their own game', own.result === 'own_game');
  const stranger = await rpc('pf_claim_spot', { p_game: game, p_user: users.ownerB, p_via: 'board' });
  check('an owner of another club cannot claim', stranger.result === 'not_member');

  const [a, b] = await Promise.all([
    admin.rpc('pf_claim_spot', { p_game: game, p_user: users.m45, p_via: 'email' }),
    admin.rpc('pf_claim_spot', { p_game: game, p_user: users.unrated, p_via: 'email' }),
  ]);
  const results = [a.data?.result, b.data?.result];
  check('two simultaneous claims for the last spot: exactly one wins',
    results.filter((x) => x === 'joined').length === 1 && results.filter((x) => x === 'full').length === 1,
    results.join(' / '));
  const winner = a.data?.result === 'joined' ? users.m45 : users.unrated;
  const loser = winner === users.m45 ? users.unrated : users.m45;

  // More rounds, on fresh single-spot games, with three claimers at once.
  let roundsOk = 0;
  const ROUNDS = 8;
  for (let i = 0; i < ROUNDS; i++) {
    await admin.from('pf_games').update({ created_at: inDays(-2) }).eq('posted_by', users.ownerA); // keep the owner under the daily limit
    const g = await post(clubA, users.ownerA, { p_spots: 1, p_rating_min: null, p_rating_max: null });
    if (!g.ok) throw new Error(`round post: ${JSON.stringify(g)}`);
    const out = await Promise.all(
      [users.m35, users.m45, users.unrated].map((u) => admin.rpc('pf_claim_spot', { p_game: g.game_id, p_user: u, p_via: 'board' })),
    );
    const { count } = await admin.from('pf_game_players').select('id', { count: 'exact', head: true }).eq('game_id', g.game_id).eq('status', 'in');
    if (out.filter((o) => o.data?.result === 'joined').length === 1 && count === 1) roundsOk++;
  }
  check(`three-way race for one spot, ${ROUNDS} rounds: never overfilled`, roundsOk === ROUNDS, `${roundsOk}/${ROUNDS}`);

  // ---- 4. auto-close ------------------------------------------------------
  let row = await gameRow(game);
  const { count: inCount } = await admin.from('pf_game_players').select('id', { count: 'exact', head: true }).eq('game_id', game).eq('status', 'in');
  check('the game closes itself when the last spot goes', row.status === 'full' && !!row.filled_at && inCount === 2);
  const late = await rpc('pf_claim_spot', { p_game: game, p_user: users.ownerA, p_via: 'email' });
  check('a late tap is told the game is full', late.result === 'full');

  // ---- 5. cancel re-opens -------------------------------------------------
  const left = await rpc('pf_leave_spot', { p_game: game, p_user: winner });
  row = await gameRow(game);
  check('a player dropping out re-opens the game', left.result === 'left' && left.reopened === true && row.status === 'open' && row.filled_at === null);
  const again = await rpc('pf_claim_spot', { p_game: game, p_user: loser, p_via: 'board' });
  row = await gameRow(game);
  check('the re-opened spot can be taken, and the game fills again', again.result === 'joined' && again.now_full === true && row.status === 'full');
  const notIn = await rpc('pf_leave_spot', { p_game: game, p_user: users.ownerA });
  check('someone not in the game cannot leave it', notIn.result === 'not_in');

  // ---- 6. poster cancel ---------------------------------------------------
  const wrong = await rpc('pf_cancel_game', { p_game: game, p_user: users.m35 });
  check('a player cannot cancel someone else\'s game', wrong.result === 'not_poster');
  const cancelled = await rpc('pf_cancel_game', { p_game: game, p_user: users.poster });
  const afterCancel = await rpc('pf_claim_spot', { p_game: p3.game_id, p_user: users.m35, p_via: 'board' });
  check('the poster can cancel', cancelled.result === 'cancelled' && (await gameRow(game)).status === 'cancelled');
  const joinCancelled = await rpc('pf_claim_spot', { p_game: game, p_user: users.ownerA, p_via: 'board' });
  check('nobody can join a cancelled game', joinCancelled.result === 'cancelled' && afterCancel.result === 'joined');

  // ---- 7. expiry ----------------------------------------------------------
  await admin.from('pf_games').update({ starts_at: inDays(-0.1) }).eq('id', p2.game_id);
  await rpc('pf_expire_games', {});
  check('a past game that never filled is marked expired', (await gameRow(p2.game_id)).status === 'expired');
  const stats = await rpc('pf_club_stats', { p_club: clubA, p_since: inDays(-1) });
  check('director stats count posts and fills', stats.posted >= 3 && stats.filled >= 1 && stats.cancelled === 1, JSON.stringify(stats));

  // ---- 8. RLS canary ------------------------------------------------------
  const member = await signIn('m35');
  await admin.from('pf_member_prefs').upsert({ club_id: clubA, user_id: users.m35, phone: '555-0135' });

  const { data: prefsSeen } = await member.from('pf_member_prefs').select('user_id, phone');
  check('a member reads only their own preferences (no one else\'s phone)',
    (prefsSeen ?? []).length === 1 && prefsSeen[0].user_id === users.m35 && !(prefsSeen ?? []).some((p) => p.phone === '555-0199'),
    `${(prefsSeen ?? []).length} rows`);

  const roster1 = await member.rpc('pf_member_roster', { p_club: clubA, p_user: null });
  const recip1 = await member.rpc('pf_game_recipients', { p_game: p3.game_id, p_limit: 50 });
  check('a member cannot call the roster or recipient functions (they carry emails)',
    !!roster1.error && !!recip1.error,
    `${roster1.error?.message} / ${recip1.error?.message}`);

  const claimAs = await member.rpc('pf_claim_spot', { p_game: p4.game_id ?? p3.game_id, p_user: users.m45, p_via: 'board' });
  check('a member cannot claim a spot as somebody else', !!claimAs.error);

  const { data: links, error: linksErr } = await member.from('pf_links').select('token');
  check('a member cannot read anyone\'s secret links', !!linksErr || (links ?? []).length === 0);

  const { data: seenGames } = await member.from('pf_games').select('id, status, club_id');
  check('a member sees open games at their own club',
    (seenGames ?? []).some((g) => g.id === p3.game_id) && (seenGames ?? []).every((g) => g.club_id === clubA));
  const { error: noteErr } = await member.from('pf_games').select('id, note, posted_by');
  check('a member cannot read the note or who posted through the API', !!noteErr, noteErr?.message);

  const { data: authPeek } = await member.from('profiles').select('id').neq('id', users.m35);
  check('a member cannot list other members\' profiles', (authPeek ?? []).length === 0);

  const other = await signIn('ownerB');
  const [og, op, opr] = await Promise.all([
    other.from('pf_games').select('id').eq('club_id', clubA),
    other.from('pf_game_players').select('id').eq('club_id', clubA),
    other.from('pf_member_prefs').select('user_id').eq('club_id', clubA),
  ]);
  check('an owner of another club reads nothing',
    (og.data ?? []).length === 0 && (op.data ?? []).length === 0 && (opr.data ?? []).length === 0,
    `${(og.data ?? []).length}/${(op.data ?? []).length}/${(opr.data ?? []).length}`);

  const anon = anonClient();
  const [ag, ap, al, ar] = await Promise.all([
    anon.from('pf_games').select('id'),
    anon.from('pf_member_prefs').select('user_id'),
    anon.from('pf_links').select('token'),
    anon.rpc('pf_member_roster', { p_club: clubA, p_user: null }),
  ]);
  check('anon reads nothing',
    [ag, ap, al].every((r) => !!r.error || (r.data ?? []).length === 0) && (!!ar.error || !(ar.data ?? []).length),
    [ag, ap, al, ar].map((r) => (r.error ? 'denied' : `${(r.data ?? []).length} rows`)).join(', '));

  const staff = await signIn('ownerA');
  const { data: staffGames } = await staff.from('pf_games').select('id, status').eq('club_id', clubA);
  check('club staff read every game at their club, cancelled and expired included',
    (staffGames ?? []).some((g) => g.status === 'cancelled') && (staffGames ?? []).some((g) => g.status === 'expired'));
} catch (e) {
  failures++;
  console.error('ERROR', e);
} finally {
  await cleanup();
  const { count } = await admin.from('cc_clubs').select('id', { count: 'exact', head: true }).like('slug', `pf-check-%-${RUN}`);
  console.log(`\ncleanup: ${count === 0 ? 'clubs, members, games, levels and accounts removed' : `${count} clubs left behind`}`);
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

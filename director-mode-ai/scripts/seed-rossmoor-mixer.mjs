/**
 * seed-rossmoor-mixer.mjs — Rossmoor's monthly "Wild Card", as a mixed doubles
 * mixer, for the pitch.
 *
 * Rossmoor runs a monthly Saturday "Wild Card": 12 men + 12 women, first come
 * first served, and a spreadsheet that draws partners, courts and rotations.
 * In ClubMode that is simply a mixed doubles mixer with separate men's and
 * women's spots. This stages October's as if signup had already filled:
 *
 *   - "Rossmoor Wild Card, October" (match_format mixed-doubles), Sat Oct 3
 *     2026 9:00am, Buckeye courts, 6 courts, 3 rounds of 6 games
 *   - public signup at /events/rossmoor-wild-card-october-2026 with 12 men /
 *     12 women spots, both full (so a new signup shows the waitlist)
 *   - 24 players drawn from the demo director's invented PlayerVault residents,
 *     all 3 rounds drawn by MixerMode's mixed doubles generator, round 1 scored
 *
 *   node scripts/seed-rossmoor-mixer.mjs
 *
 * Run seed-rossmoor-demo.mjs first (it creates the director and the vault).
 * That script wipes every event the demo director owns, this one included, so
 * run this again after it.
 *
 * IDEMPOTENT. Deletes and rebuilds ONLY this event (found by its slug, owned by
 * the demo director at Rossmoor) and the `players` rows this script tagged.
 * The event id, event code and player ids are kept, so shared links survive.
 *
 * NO EMAIL. Signup rows carry no email address, so nothing ("Email scoring
 * links", confirmations) can mail an @example.com inbox and bounce.
 *
 * Draws with the app's own RoundGenerator (src/lib/advancedMatchGeneration.ts)
 * so the seeded sheet is exactly what "Generate Multiple" makes. That file uses
 * TypeScript parameter properties, which need Node's type TRANSFORM, so the
 * script re-runs itself with --experimental-transform-types (Node 22.7+).
 */

import { spawnSync } from 'child_process';

if (!process.execArgv.includes('--experimental-transform-types')) {
  const r = spawnSync(
    process.execPath,
    ['--experimental-transform-types', '--no-warnings', ...process.argv.slice(1)],
    { stdio: 'inherit' },
  );
  process.exit(r.status ?? 1);
}

const { createClient } = await import('@supabase/supabase-js');
const { readFileSync } = await import('fs');
const { randomBytes } = await import('crypto');
const { RoundGenerator } = await import('../src/lib/advancedMatchGeneration.ts');

const CLUB_SLUG = 'rossmoor-tennis-club';
const DIRECTOR_EMAIL = 'rossmoor-demo@clubmode.ai';
// Slug and player tag predate the rename; kept so existing links and rows match.
const EVENT_SLUG = 'rossmoor-wild-card-october-2026';
const PLAYER_TAG = 'seed:rossmoor-wildcard';
const PREFERRED_CODE = 'WLDCRD';
const SEED = 20261003;
const COURTS = 6;
const ROUNDS = 3;

// Round 1 scores, court by court (fixed 6 games: a 3-3 goes to a tiebreak).
const ROUND1_SCORES = [
  [4, 2], [2, 4], [5, 1], [3, 3], [1, 5], [4, 2],
];

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
  auth: { autoRefreshToken: false, persistSession: false },
});

async function must(p, what) {
  const { error, data } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

async function findUser(email) {
  for (let page = 1; page < 50; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const hit = data.users.find((u) => (u.email || '').toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 1000) break;
  }
  return null;
}

/** Repeat partners / opponents across the drawn rounds, for the run log. */
function scheduleStats(rounds) {
  const partners = new Map();
  const opponents = new Map();
  const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  for (const round of rounds) {
    for (const p of round) {
      if (!p.player2_id) continue;
      const a = [p.player1_id, p.player3_id].filter(Boolean);
      const b = [p.player2_id, p.player4_id].filter(Boolean);
      if (a.length === 2) bump(partners, key(a[0], a[1]));
      if (b.length === 2) bump(partners, key(b[0], b[1]));
      for (const x of a) for (const y of b) bump(opponents, key(x, y));
    }
  }
  const repeats = (m) => [...m.values()].reduce((s, n) => s + Math.max(0, n - 1), 0);
  return { repeatPartners: repeats(partners), repeatOpponents: repeats(opponents) };
}

const code6 = () =>
  Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomBytes(1)[0] % 32]).join('');

async function main() {
  const { data: club } = await db.from('cc_clubs').select('id, name').eq('slug', CLUB_SLUG).maybeSingle();
  if (!club) throw new Error(`No club "${CLUB_SLUG}" — run seed-rossmoor.mjs first.`);
  const director = await findUser(DIRECTOR_EMAIL);
  if (!director) throw new Error(`No ${DIRECTOR_EMAIL} — run seed-rossmoor-demo.mjs first.`);
  const directorId = director.id;
  console.log(`\nSeeding the Wild Card mixer for ${club.name}\n`);

  // ------------------------------------------------------------------ reset
  const { data: old } = await db
    .from('events')
    .select('id, event_code')
    .eq('slug', EVENT_SLUG)
    .eq('club_id', club.id)
    .eq('user_id', directorId);
  // Event id, code and player ids survive a re-run, so the director link,
  // the print link and each ?me= phone link keep working.
  let keepCode = null;
  const keepEventId = old?.[0]?.id ?? null;
  const { data: oldPlayers } = await db
    .from('players')
    .select('id, name')
    .eq('user_id', directorId)
    .eq('rating_notes', PLAYER_TAG);
  const keepPlayerId = new Map((oldPlayers ?? []).map((p) => [p.name, p.id]));
  for (const ev of old ?? []) {
    keepCode = keepCode ?? ev.event_code;
    await db.from('calendar_items').update({ event_id: null }).eq('event_id', ev.id);
    // rounds → matches, event_players and tournament_entries cascade.
    await must(db.from('events').delete().eq('id', ev.id), 'reset event');
  }
  const { data: stray } = await db.from('events').select('id, user_id').eq('slug', EVENT_SLUG);
  if (stray?.length) throw new Error(`Slug ${EVENT_SLUG} is used by an event this script doesn't own; refusing.`);
  await must(
    db.from('players').delete().eq('user_id', directorId).eq('rating_notes', PLAYER_TAG),
    'reset players',
  );
  console.log(`· wiped ${old?.length ?? 0} prior Wild Card mixer event(s) and their players`);

  // ----------------------------------------------------------------- people
  const vault = await must(
    db
      .from('cc_vault_players')
      .select('full_name, gender, email')
      .eq('director_id', directorId)
      .like('email', '%@example.com')
      .order('full_name'),
    'vault',
  );
  const men = vault.filter((v) => v.gender === 'male').slice(0, 12);
  const women = vault.filter((v) => v.gender === 'female').slice(0, 12);
  if (men.length < 12 || women.length < 12) {
    throw new Error(`Vault has ${men.length} men / ${women.length} women; need 12 of each.`);
  }

  // ------------------------------------------------------------------ event
  let code = keepCode ?? PREFERRED_CODE;
  for (let i = 0; ; i += 1) {
    const { count } = await db.from('events').select('id', { count: 'exact', head: true }).eq('event_code', code);
    if (!count) break;
    if (i > 10) throw new Error('No free event code.');
    code = code6();
  }

  const event = await must(
    db
      .from('events')
      .insert({
        ...(keepEventId ? { id: keepEventId } : {}),
        user_id: directorId,
        club_id: club.id,
        name: 'Rossmoor Wild Card, October',
        event_date: '2026-10-03',
        start_time: '09:00',
        end_time: '12:00',
        duration_minutes: 180,
        event_code: code,
        slug: EVENT_SLUG,
        venue: 'Buckeye courts',
        num_courts: COURTS,
        match_format: 'mixed-doubles',
        scoring_format: 'fixed_games',
        target_games: 6,
        format_notes:
          'Monthly Wild Card. Mixed doubles with a new partner and new opponents every round, drawn for you. Three 6-game rounds. Coffee and pastries at the Buckeye courts after.',
        public_registration: true,
        public_status: 'open',
        entry_fee_cents: 0,
        max_players: 24,
        max_men: 12,
        max_women: 12,
        gender_restriction: 'coed',
        registration_opens_at: '2026-09-01T09:00:00-07:00',
        registration_closes_at: '2026-10-01T17:00:00-07:00',
      })
      .select('id, event_code')
      .single(),
    'event',
  );

  const roster = [...men, ...women];
  const players = await must(
    db
      .from('players')
      .insert(roster.map((v) => ({
        ...(keepPlayerId.has(v.full_name) ? { id: keepPlayerId.get(v.full_name) } : {}),
        user_id: directorId,
        club_id: club.id,
        name: v.full_name,
        gender: v.gender,
        rating_notes: PLAYER_TAG,
      })))
      .select('id, name, gender'),
    'players',
  );
  await must(
    db.from('event_players').insert(players.map((p, i) => ({
      event_id: event.id,
      player_id: p.id,
      strength_order: i,
      active: true,
    }))),
    'event_players',
  );

  // The signups that filled it: confirmed, already imported, no email on file.
  const now = Date.parse('2026-09-01T09:00:00-07:00');
  await must(
    db.from('tournament_entries').insert(roster.map((v, i) => ({
      event_id: event.id,
      player_name: v.full_name,
      gender: v.gender,
      position: 'in_draw',
      payment_status: 'waived',
      registered_at: new Date(now + (i * 37 + 3) * 60_000).toISOString(),
      imported_at: new Date(now + 5 * 864e5).toISOString(),
    }))),
    'tournament_entries',
  );
  console.log(`· Event ${event.event_code}: 12 men + 12 women signed up and checked in`);

  // ----------------------------------------------------------------- rounds
  // Same call RoundsTab makes for "Generate Multiple", seeded so re-runs match.
  // Players go in by name so the draw doesn't depend on fresh uuids.
  const byName = [...players].sort((a, b) => a.name.localeCompare(b.name));
  const generator = new RoundGenerator(
    byName.map((p) => ({ player_id: p.id, name: p.name, gender: p.gender })),
    COURTS,
    'mixed-doubles',
  );
  generator.setSeed(SEED);
  const schedule = generator.generateMultipleRounds(ROUNDS);
  const stats = scheduleStats(schedule);

  const standings = new Map(players.map((p) => [p.id, { wins: 0, losses: 0, games_won: 0, games_lost: 0 }]));
  for (let r = 0; r < schedule.length; r += 1) {
    const scored = r === 0;
    const round = await must(
      db
        .from('rounds')
        .insert({
          event_id: event.id,
          round_number: r + 1,
          status: scored ? 'completed' : 'upcoming',
          start_time: scored ? '2026-10-03T09:05:00-07:00' : null,
          end_time: scored ? '2026-10-03T09:50:00-07:00' : null,
        })
        .select('id')
        .single(),
      `round ${r + 1}`,
    );
    // Courts first (numbered 1..n in draw order), then sit-out rows — the same
    // shape RoundsTab writes.
    const ordered = [...schedule[r].filter((p) => p.player2_id), ...schedule[r].filter((p) => !p.player2_id)];
    const rows = ordered.map((row, i) => {
      const base = { ...row, court_number: i + 1, round_id: round.id };
      if (!scored || !row.player2_id) return base;
      const [s1, s2] = ROUND1_SCORES[i % ROUND1_SCORES.length];
      const tie = s1 === s2;
      const winner = tie ? 1 : s1 > s2 ? 1 : 2;
      for (const [pid, side] of [[row.player1_id, 1], [row.player3_id, 1], [row.player2_id, 2], [row.player4_id, 2]]) {
        const s = standings.get(pid);
        if (!s) continue;
        s.games_won += side === 1 ? s1 : s2;
        s.games_lost += side === 1 ? s2 : s1;
        if (winner === side) s.wins += 1;
        else s.losses += 1;
      }
      return { ...base, team1_score: s1, team2_score: s2, winner_team: winner, tiebreaker_winner: tie ? 1 : null };
    });
    await must(db.from('matches').insert(rows), `matches round ${r + 1}`);
  }
  // Mirror what the score dialog keeps on event_players.
  for (const [pid, s] of standings) {
    await must(
      db.from('event_players').update(s).eq('event_id', event.id).eq('player_id', pid),
      'event_players standings',
    );
  }
  console.log(
    `· ${schedule.length} rounds on ${COURTS} courts · ${stats.repeatPartners} repeat partners · ` +
      `${stats.repeatOpponents} repeat opponents · round 1 scored`,
  );

  // ---------------------------------------------------------------- summary
  const me = players.find((p) => p.gender === 'female');
  const base = 'https://clubmode.ai';
  console.log('\nOpen:');
  console.log(`  ${base}/mixer/events/${event.id}   (director, log in as ${DIRECTOR_EMAIL})`);
  console.log(`  ${base}/event/${event.event_code}/print`);
  console.log(`  ${base}/event/${event.event_code}?me=${me.id}   (${me.name}'s phone view)`);
  console.log(`  ${base}/events/${EVENT_SLUG}   (public signup, both sides full → waitlist)`);
  console.log('');
}

main().catch((e) => {
  console.error('\nFAILED:', e.message || e);
  process.exit(1);
});

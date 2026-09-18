/**
 * seed-rossmoor-pickleball-demo.mjs — a lived-in sales demo for the Rossmoor
 * Pickleball Club.
 *
 * seed-rossmoor-pickleball.mjs builds the club, its website, its courts, its
 * rate cards and its weekly programmes. This script fills that club with a
 * week in progress so the board can click around something that looks like
 * their own September:
 *
 *   - three demo logins seated ONLY at this club (a board member, two members)
 *   - ~80 invented residents in PlayerVault, ages 60–88, across the club's own
 *     four levels
 *   - a real week on the six indoor courts: Drill & Thrill, Club Play by
 *     level morning and afternoon, Open Play, the mentor session, the clinics,
 *     and two postings looking for players
 *   - court bookings on the new indoor courts, members and one guest, so the
 *     booking page and the court sheet show a believable mix of booked and open
 *   - the September Hit and Giggle as a mixed round robin — 24 players, three
 *     rounds drawn and scored, instead of a basket of names
 *   - Grill & Chill, the Annual Meeting and the Annual Gala on a published
 *     2026 calendar
 *   - two open CourtConnect games so the board isn't shown an empty board
 *
 *   node scripts/seed-rossmoor-pickleball-demo.mjs                    # build / reset
 *   node scripts/seed-rossmoor-pickleball-demo.mjs --reset-passwords  # also rotate logins
 *
 * IDEMPOTENT. Every run deletes what this script owns and rebuilds it. What it
 * owns is found by OWNERSHIP, never by club alone, so if the club ever starts
 * using ClubMode for real, nothing a real member made is touched:
 *   cc_vault_players   director_id = demo board member
 *   players            user_id = demo board member AND rating_notes = PLAYER_TAG
 *   events             user_id = demo board member AND club_id = this club
 *   calendar_plans     owner_id = demo board member AND club_id = this club
 *   reservations       club_id = this club AND (meta.seed = SEED_TAG OR
 *                      created_by = a demo login)   — court_bookings cascade
 *   pf_games           club_id = this club AND posted_by = a demo login
 *
 * PEOPLE ARE INVENTED. Every resident below is made up and every address is
 * @example.com, so nothing can ever mail a real person. The only real names
 * anywhere in this club are the published 2026 board and the two trainers, and
 * they appear on the club's website with their roles and nothing else.
 *
 * NO EMAIL LEAVES. cc_clubs.demo_mode is on for this club (see the club seed),
 * so every email the club would send is held.
 *
 * Passwords are generated on first creation and printed once. They are never
 * written to this file.
 *
 * The Hit and Giggle draw uses the app's own RoundGenerator
 * (src/lib/advancedMatchGeneration.ts) so the seeded sheet is exactly what
 * "Generate Multiple" makes. That file uses TypeScript parameter properties,
 * which need Node's type TRANSFORM, so the script re-runs itself with
 * --experimental-transform-types (Node 22.7+).
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

const SLUG = 'rossmoor-pickleball-club';
const SEED_TAG = 'rpc-demo';
const PLAYER_TAG = 'seed:rpc-hit-and-giggle';
const TZ = 'America/Los_Angeles';
const RESET_PASSWORDS = process.argv.includes('--reset-passwords');

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

// ---------------------------------------------------------------- the logins
const ACCOUNTS = {
  // The club is run by a volunteer board, not a paid director, so the staff
  // login is NAMED for that. Its club role is still `director`.
  director: { email: 'rpc-demo@clubmode.ai', name: 'Board Member (demo)', role: 'director' },
  member: { email: 'rpc-member@clubmode.ai', name: 'Robin Demo', role: 'member' },
  member2: { email: 'rpc-member2@clubmode.ai', name: 'Casey Demo', role: 'member' },
};

/**
 * The club's own four levels, and the number each one maps to.
 *
 * THE NAME IS THE REAL THING. This club does not use DUPR and does not use
 * NTRP: members self-select Novice, Intermediate, Advanced Intermediate or
 * Advanced on the join form, and moving up means asking a trainer, working a
 * skills sheet, drilling, then an evaluation by the Training Committee.
 *
 * The number exists only because every matching surface in ClubMode sorts on
 * one (CourtConnect's level filter, the mixer's strength order). It is carried
 * as a sort key and the club's own words are carried in `notes`, which is what
 * a director reads in PlayerVault.
 *
 * THE NAMES THEMSELVES ARE ROWS, in cc_club_level_tiers — seeded by
 * seed-rossmoor-pickleball.mjs, which is what turns every 2.75 in this file
 * into the word "Intermediate" on screen. The ratings here must stay the ones
 * that seed gives its tiers, or a demo member reads as the tier next door.
 * One decimal place: every rating column is numeric(2,1).
 */
const LEVELS = {
  novice: { name: 'Novice', rating: 2.0, band: '1.0–2.0' },
  intermediate: { name: 'Intermediate', rating: 2.8, band: '2.5–3.0' },
  adv_int: { name: 'Advanced Intermediate', rating: 3.3, band: '3.0–3.5' },
  advanced: { name: 'Advanced', rating: 4.0, band: '4.0+' },
};

// ---------------------------------------------------------------- the people
// [name, age, level key]. INVENTED — see the header. Kept in data so a re-run
// rebuilds the same club.
const MEN = [
  ['Alan Pettigrew', 72, 'intermediate'], ['Roger Stavros', 68, 'adv_int'],
  ['Mel Kirkbride', 79, 'novice'], ['Curtis Nakagawa', 65, 'advanced'],
  ['Sidney Aalto', 83, 'novice'], ['Wendell Pryce', 71, 'intermediate'],
  ['Marvin Oduya', 66, 'adv_int'], ['Hugh Bellingham', 74, 'intermediate'],
  ['Terrence Fiore', 63, 'advanced'], ['Abe Lindholm', 80, 'novice'],
  ['Rudy Vasquez-Coe', 69, 'adv_int'], ['Stuart Peng', 61, 'advanced'],
  ['Barry Orlowski', 77, 'intermediate'], ['Desmond Achebe', 64, 'adv_int'],
  ['Ellis Waterman', 86, 'novice'], ['Grant Sibley', 70, 'intermediate'],
  ['Ivan Prochazka', 75, 'adv_int'], ['Neal Bracewell', 62, 'advanced'],
  ['Oscar Villarreal', 67, 'adv_int'], ['Perry Tanabe', 73, 'intermediate'],
  ['Quentin Hollandsworth', 81, 'novice'], ['Ramon Escalante', 66, 'intermediate'],
  ['Seth Goodwillie', 60, 'advanced'], ['Tobias Merrick', 78, 'intermediate'],
  ['Victor Ramaswamy', 71, 'adv_int'], ['Wayne Bufford', 84, 'novice'],
  ['Calvin Hyde-Pierce', 69, 'intermediate'], ['Dennis Kowalik', 76, 'adv_int'],
  ['Edgar Munn', 63, 'advanced'], ['Floyd Bassani', 88, 'novice'],
  ['Gilbert Ngata', 72, 'intermediate'], ['Horace Dill', 65, 'adv_int'],
  ['Irving Feldspar', 82, 'intermediate'], ['Julius Okonjo', 68, 'advanced'],
  ['Kirby Lavalle', 74, 'intermediate'], ['Lowell Santangelo', 70, 'adv_int'],
  ['Manny Rueda', 61, 'advanced'], ['Nolan Pike', 85, 'novice'],
];
const WOMEN = [
  ['Adele Strandberg', 70, 'intermediate'], ['Bernadette Ocampo', 66, 'adv_int'],
  ['Cecile Ravenscroft', 81, 'novice'], ['Delia Marchbanks', 64, 'advanced'],
  ['Eloise Tanigawa', 75, 'intermediate'], ['Fern Bialystok', 87, 'novice'],
  ['Georgia Penhale', 68, 'adv_int'], ['Harriet Solano', 72, 'intermediate'],
  ['Imogen Duchamp', 62, 'advanced'], ['Jocelyn Abara', 79, 'intermediate'],
  ['Kitty Volker', 65, 'adv_int'], ['Leona Pastore', 84, 'novice'],
  ['Mabel Onwuka', 69, 'intermediate'], ['Noreen Haldane', 73, 'adv_int'],
  ['Odette Crisanto', 60, 'advanced'], ['Peggy Vanterpool', 77, 'intermediate'],
  ['Queenie Aldritch', 63, 'adv_int'], ['Rosemary Ilagan', 71, 'intermediate'],
  ['Selma Brockhurst', 86, 'novice'], ['Thea Nwachukwu', 67, 'advanced'],
  ['Ursula Maslowski', 74, 'adv_int'], ['Verna Cardoza', 61, 'intermediate'],
  ['Willa Petrosyan', 80, 'novice'], ['Xenia Broadwater', 66, 'adv_int'],
  ['Yvette Lamontagne', 70, 'intermediate'], ['Zelda Furtado', 78, 'intermediate'],
  ['Annette Purcell', 64, 'advanced'], ['Bonnie Takahashi', 83, 'novice'],
  ['Corinne Eastlake', 69, 'adv_int'], ['Dorinda Salvatierra', 72, 'intermediate'],
  ['Estelle Wyman', 60, 'advanced'], ['Francine Okorafor', 76, 'adv_int'],
  ['Greta Hollingsley', 88, 'novice'], ['Hazel Bertolucci', 65, 'intermediate'],
  ['Ingrid Pomerantz', 71, 'adv_int'], ['Jeanette Villamor', 68, 'intermediate'],
  ['Kay Strickler', 82, 'novice'], ['Lucille Amadi', 62, 'advanced'],
  ['Marta Zelenko', 74, 'adv_int'], ['Nadine Oyelowo', 67, 'intermediate'],
  ['Opal Renfroe', 79, 'intermediate'], ['Phoebe Castellon', 63, 'adv_int'],
];

const emailOf = (name) =>
  `${name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')}@example.com`;

/** The levels the two demo members play at, so CourtConnect has them matched. */
const DEMO_MEMBER_LEVELS = { member: 'intermediate', member2: 'adv_int' };

// ------------------------------------------------------------ the event dates
/*
 * The club's own published 2026 calendar. Their Hit and Giggle list ends with
 * SEPTEMBER 14 — there is no later one on their site, so that is the one
 * seeded, drawn and scored, rather than a date we made up. Everything after it
 * is upcoming.
 */
const HIT_AND_GIGGLE = { date: '2026-09-14', start: '16:00', end: '18:00' };
const GRILL_AND_CHILL = { date: '2026-10-14', start: '17:00', end: '19:00' };
const ANNUAL_MEETING = { date: '2026-10-28', start: '13:00', end: '14:30' };
const ANNUAL_GALA = { date: '2027-01-15', start: '17:00', end: '21:00' };

// Draw settings for the Hit and Giggle round robin.
const MIXER_SLUG = 'rossmoor-pickleball-hit-and-giggle-september-2026';
const MIXER_CODE = 'GIGGLE';
const MIXER_SEED = 20260914;
const MIXER_COURTS = 6;
const MIXER_ROUNDS = 3;
// Games to 11. Six courts, three rounds; one score line per court per round.
const MIXER_SCORES = [
  [[11, 7], [11, 9], [9, 11], [11, 4], [8, 11], [11, 6]],
  [[11, 5], [7, 11], [11, 8], [11, 9], [11, 3], [6, 11]],
  [[9, 11], [11, 6], [11, 7], [5, 11], [11, 8], [11, 10]],
];

// ------------------------------------------------------------------ helpers
async function ins(table, row, sel = 'id') {
  const { data, error } = await db.from(table).insert(row).select(sel).single();
  if (error) throw new Error(`${table}: ${error.message}${error.details ? ' — ' + error.details : ''}`);
  return data;
}
async function insMany(table, rows) {
  if (!rows.length) return [];
  const { data, error } = await db.from(table).insert(rows).select('*');
  if (error) throw new Error(`${table}: ${error.message}${error.details ? ' — ' + error.details : ''}`);
  return data;
}
async function must(p, what) {
  const { error, data } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

/**
 * Club wall-clock to an ISO instant, with the zone's REAL offset on that date.
 * Never a naive server date: Vercel runs UTC, and 9am here is not 9am there.
 */
function pt(ymd, hhmm) {
  const off =
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' })
      .formatToParts(new Date(`${ymd}T12:00:00Z`))
      .find((p) => p.type === 'timeZoneName')
      .value.replace('GMT', '') || '+00:00';
  return new Date(`${ymd}T${hhmm}:00${off}`).toISOString();
}
/** Today in club time, plus n days, as YYYY-MM-DD. */
function ymdIn(n) {
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  return new Date(Date.parse(`${local}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}
const dow = (ymd) => new Date(`${ymd}T12:00:00Z`).getUTCDay();
const newPassword = () => `Rpc-${randomBytes(12).toString('base64url')}-9`;
const code6 = () =>
  Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomBytes(1)[0] % 32]).join('');

async function allUsers() {
  const out = [];
  for (let page = 1; page < 50; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    out.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return out;
}

// ================================================================== main
async function main() {
  const { data: club } = await db
    .from('cc_clubs')
    .select('id, name, owner_id, timezone, demo_mode')
    .eq('slug', SLUG)
    .maybeSingle();
  if (!club) throw new Error(`No club "${SLUG}" — run seed-rossmoor-pickleball.mjs first.`);
  const clubId = club.id;
  console.log(`\nSeeding demo for ${club.name} (${clubId})\n`);

  // ------------------------------------------------------------ accounts
  const users = await allUsers();
  const ids = {};
  const passwords = {};
  for (const [key, acct] of Object.entries(ACCOUNTS)) {
    const found = users.find((u) => (u.email || '').toLowerCase() === acct.email);
    if (found) {
      ids[key] = found.id;
      const patch = { email_confirm: true };
      if (RESET_PASSWORDS) {
        passwords[key] = newPassword();
        patch.password = passwords[key];
      }
      await must(db.auth.admin.updateUserById(found.id, patch), `update ${acct.email}`);
    } else {
      passwords[key] = newPassword();
      const { data, error } = await db.auth.admin.createUser({
        email: acct.email,
        password: passwords[key],
        email_confirm: true,
        user_metadata: { full_name: acct.name },
      });
      if (error) throw new Error(`create ${acct.email}: ${error.message}`);
      ids[key] = data.user.id;
    }

    // The profile row normally arrives by trigger. Make sure it exists, then
    // UPDATE — upsert trips the protect_profile_billing guard.
    const { data: prof } = await db.from('profiles').select('id').eq('id', ids[key]).maybeSingle();
    if (!prof) await must(db.from('profiles').insert({ id: ids[key], full_name: acct.name }), 'profiles insert');
    const profilePatch = { full_name: acct.name, organization_name: club.name, timezone: TZ };
    if (key === 'director') {
      Object.assign(profilePatch, {
        plan_tier: 'pro',
        subscription_status: 'active',
        current_period_end: new Date(Date.now() + 365 * 864e5).toISOString(),
      });
    }
    await must(db.from('profiles').update(profilePatch).eq('id', ids[key]), `profile ${acct.email}`);

    // Seated at this club and nowhere else.
    await must(
      db.from('cc_club_members').delete().eq('user_id', ids[key]).neq('club_id', clubId),
      'strip other memberships',
    );
    await must(
      db.from('cc_club_members').upsert(
        { club_id: clubId, user_id: ids[key], role: acct.role },
        { onConflict: 'club_id,user_id' },
      ),
      'membership',
    );
    // A demo login must never own a club — that would change which club it sees.
    const { count: owns } = await db
      .from('cc_clubs')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', ids[key]);
    if (owns) throw new Error(`${acct.email} owns ${owns} club(s); refusing to continue.`);
  }
  const directorId = ids.director;
  const demoIds = Object.values(ids);
  console.log('· 3 demo accounts, seated only at this club');

  /*
   * The two demo members' levels.
   *
   * Written to master_players, the PERSON, because that is where CourtConnect
   * reads a signed-in member's level from (pf_member_roster falls back to it
   * when the CLUB OWNER's PlayerVault has no row for the address — and the
   * vault rows below belong to the demo board member, not the owner).
   */
  for (const key of ['member', 'member2']) {
    const email = ACCOUNTS[key].email;
    const rating = LEVELS[DEMO_MEMBER_LEVELS[key]].rating;
    const patch = { ntrp: rating, ntrp_source: 'self', ntrp_updated_at: new Date().toISOString() };
    const { data: mp } = await db.from('master_players').select('id').ilike('email', email).maybeSingle();
    if (mp) await must(db.from('master_players').update(patch).eq('id', mp.id), 'master_players');
    else
      await must(
        db.from('master_players').insert({ email, full_name: ACCOUNTS[key].name, primary_club_id: clubId, ...patch }),
        'master_players',
      );
  }

  // ---------------------------------------------------------------- reset
  {
    // Two reads rather than one `or()`: a jsonb path inside an or() filter is
    // easy to get subtly wrong, and this has delete privileges.
    const [tagged, mine] = await Promise.all([
      db.from('reservations').select('id').eq('club_id', clubId).eq('meta->>seed', SEED_TAG),
      db.from('reservations').select('id').eq('club_id', clubId).in('created_by', demoIds),
    ]);
    const rowIds = [...new Set([...(tagged.data ?? []), ...(mine.data ?? [])].map((r) => r.id))];
    if (rowIds.length) {
      // reservation_signups and court_bookings both cascade from reservations.
      await must(db.from('reservations').delete().in('id', rowIds), 'reset reservations');
    }
  }
  await must(
    db.from('pf_games').delete().eq('club_id', clubId).in('posted_by', demoIds),
    'reset CourtConnect games',
  );
  await must(db.from('cc_vault_players').delete().eq('director_id', directorId), 'reset vault');
  {
    const { data: evs } = await db.from('events').select('id').eq('club_id', clubId).eq('user_id', directorId);
    const evIds = (evs ?? []).map((e) => e.id);
    if (evIds.length) {
      await db.from('calendar_items').update({ event_id: null }).in('event_id', evIds);
      for (const t of ['tournament_matches', 'tournament_entries', 'event_players', 'event_teams']) {
        await db.from(t).delete().in('event_id', evIds);
      }
      // rounds → matches cascade with the event.
      await must(db.from('events').delete().in('id', evIds), 'reset events');
    }
    await must(
      db.from('players').delete().eq('user_id', directorId).eq('rating_notes', PLAYER_TAG),
      'reset mixer players',
    );
    const { data: plans } = await db
      .from('calendar_plans')
      .select('id')
      .eq('club_id', clubId)
      .eq('owner_id', directorId);
    const planIds = (plans ?? []).map((p) => p.id);
    if (planIds.length) {
      await must(db.from('calendar_items').delete().in('plan_id', planIds), 'reset calendar_items');
      await must(db.from('calendar_plans').delete().in('id', planIds), 'reset calendar_plans');
    }
  }
  console.log('· wiped prior demo rows');

  // --------------------------------------------------------------- vault
  const everyone = [
    ...MEN.map(([n, a, lvl]) => [n, a, lvl, 'male']),
    ...WOMEN.map(([n, a, lvl]) => [n, a, lvl, 'female']),
  ];
  const vault = await insMany(
    'cc_vault_players',
    everyone.map(([full_name, age, lvl, gender]) => ({
      director_id: directorId,
      full_name,
      email: emailOf(full_name),
      gender,
      age,
      // The sort key. The club's own words are in `notes`, below.
      usta_rating: LEVELS[lvl].rating,
      rating_source: 'manual',
      primary_sport: 'pickleball',
      sports: ['pickleball'],
      membership_status: 'active',
      notes: `Fictional demo member · Club level: ${LEVELS[lvl].name} (${LEVELS[lvl].band})`,
    })),
  );
  const vaultByName = new Map(vault.map((v) => [v.full_name, v]));
  const byLevel = (lvl) => everyone.filter(([, , l]) => l === lvl).map(([n]) => n);
  console.log(
    `· PlayerVault: ${vault.length} residents — ` +
      Object.entries(LEVELS)
        .map(([k, v]) => `${byLevel(k).length} ${v.name}`)
        .join(', '),
  );

  // ---------------------------------------------------------- court sheet
  const { data: courtRows } = await db
    .from('courts')
    .select('id, number, name')
    .eq('club_id', clubId)
    .order('number');
  const court = new Map((courtRows ?? []).map((c) => [c.number, c.id]));
  const courtName = new Map((courtRows ?? []).map((c) => [c.number, c.name]));
  const indoor = [1, 2, 3, 4, 5, 6];
  if (indoor.some((n) => !court.get(n))) throw new Error('The six indoor courts are missing.');

  const { data: progRows } = await db.from('club_programs').select('id, slug, title').eq('club_id', clubId);
  const prog = new Map((progRows ?? []).map((p) => [p.slug, p]));

  const resRows = [];
  const hold = (ymd, courtNo, start, end, type, title, extra = {}) => {
    if (!court.get(courtNo)) return;
    resRows.push({
      club_id: clubId,
      court_id: court.get(courtNo),
      starts_at: pt(ymd, start),
      ends_at: pt(ymd, end),
      type,
      source: extra.source ?? 'manual',
      source_id: extra.source_id ?? null,
      title,
      status: 'confirmed',
      created_by: directorId,
      signups_open: !!extra.signups,
      signups_capacity: extra.signups ? extra.capacity : null,
      signups_pitch: extra.signups ? extra.pitch : null,
      meta: { seed: SEED_TAG, ...(extra.meta ?? {}) },
    });
  };
  const fromProgram = (slug) => {
    const p = prog.get(slug);
    return p ? { source: 'programs', source_id: p.id, meta: { program_id: p.id, program_title: p.title } } : {};
  };
  /** Does this court already have something across this window? */
  const free = (ymd, courtNo, start, end) => {
    const s = Date.parse(pt(ymd, start));
    const e = Date.parse(pt(ymd, end));
    const id = court.get(courtNo);
    return !resRows.some(
      (r) => r.court_id === id && Date.parse(r.starts_at) < e && Date.parse(r.ends_at) > s,
    );
  };

  // Three weeks of their standing week, on the six indoor courts.
  for (let n = 0; n < 21; n += 1) {
    const d = ymdIn(n);
    const w = dow(d);
    // Drill & Thrill, Mon/Tue/Wed 8–9.
    if (w >= 1 && w <= 3) {
      for (const c of [1, 2, 3]) {
        hold(d, c, '08:00', '09:00', 'lesson', 'Morning Drill & Thrill', fromProgram('morning-drill-and-thrill'));
      }
    }
    // Club Play, mornings, level alternating by day.
    if (w === 1 || w === 3 || w === 5) {
      for (const c of [1, 2, 3]) {
        hold(d, c, '09:00', '11:00', 'member', 'Club Play — Novice & Intermediate', fromProgram('club-play-novice-intermediate'));
      }
    }
    if (w === 2 || w === 4) {
      for (const c of [1, 2, 3]) {
        hold(d, c, '09:00', '11:00', 'member', 'Club Play — Advanced Intermediate & Advanced', fromProgram('club-play-advanced'));
      }
    }
    // Club Play, afternoons, the other way round.
    if (w === 1 || w === 3) {
      for (const c of [4, 5, 6]) {
        hold(d, c, '13:00', '15:00', 'member', 'Club Play — Advanced Intermediate & Advanced', fromProgram('club-play-advanced'));
      }
    }
    if (w === 2 || w === 4) {
      for (const c of [4, 5, 6]) {
        hold(d, c, '13:00', '15:00', 'member', 'Club Play — Novice & Intermediate', fromProgram('club-play-novice-intermediate'));
      }
    }
    // The mentor session for new players, Friday late morning.
    if (w === 5) hold(d, 1, '11:00', '12:00', 'lesson', 'Mentor session — new players', fromProgram('mentor-novice-session'));
    // The free intermediate clinic, Thursday afternoon.
    if (w === 4) {
      for (const c of [1, 2]) {
        hold(d, c, '15:30', '17:00', 'lesson', 'Intermediate clinic', fromProgram('intermediate-clinic'));
      }
    }
    // Open Play — residents and guests, not just members.
    if (w === 6) {
      for (const c of [1, 2, 3, 4]) {
        hold(d, c, '09:00', '11:30', 'member', 'Open Play — residents & guests', fromProgram('open-play'));
      }
      for (const c of [1, 2]) {
        hold(d, c, '12:00', '13:30', 'lesson', 'Orientation clinic for new residents', fromProgram('orientation-clinic'));
      }
    }
    if (w === 0) {
      for (const c of [1, 2]) {
        hold(d, c, '09:00', '11:00', 'member', 'Open Play — residents & guests', fromProgram('open-play'));
      }
    }
  }

  // Two postings looking for players.
  const nextDow = (want) => {
    for (let n = 1; n < 8; n += 1) if (dow(ymdIn(n)) === want) return ymdIn(n);
    return null;
  };
  const OPEN_PLAY = [
    {
      ymd: nextDow(6), court: 5, start: '15:00', end: '16:30',
      title: 'Saturday afternoon doubles',
      pitch: 'Doubles Sat 3pm, need 2 more (Intermediate)',
      players: ['Adele Strandberg', 'Grant Sibley'],
    },
    {
      ymd: nextDow(2), court: 6, start: '16:00', end: '17:30',
      title: 'Tuesday evening rec doubles',
      pitch: 'Evening doubles Tue 4pm, need 2 more (Advanced Intermediate)',
      players: ['Marvin Oduya', 'Kitty Volker'],
    },
  ];
  for (const o of OPEN_PLAY) {
    hold(o.ymd, o.court, o.start, o.end, 'member', o.title, {
      signups: true, capacity: 4, pitch: o.pitch, meta: { open_play: true },
    });
  }

  /*
   * Court bookings on the indoor courts.
   *
   * Six of them, through the booking page's own two tables: a `reservations`
   * row holding the court and a `court_bookings` row saying who holds it and
   * what they were charged. Five members at the member rate (free), one
   * resident's guest at $5 an hour, so the booking page shows both halves of
   * the price list. Any candidate that would land on a Club Play block is
   * skipped rather than forced — the exclusion constraint is the club's rule,
   * not an obstacle.
   */
  const { data: rateRows } = await db
    .from('court_rate_cards')
    .select('id, label, applies_to, price_cents')
    .eq('club_id', clubId)
    .eq('active', true);
  const rateFor = (audience) => (rateRows ?? []).find((r) => r.applies_to === audience) ?? null;

  const BOOKINGS = [
    { day: 1, court: 4, start: '18:00', minutes: 90, who: 'Curtis Nakagawa', audience: 'member' },
    { day: 1, court: 5, start: '19:00', minutes: 90, who: 'Thea Nwachukwu', audience: 'member' },
    { day: 2, court: 2, start: '17:00', minutes: 90, who: 'Robin Demo', audience: 'member', login: 'member' },
    { day: 3, court: 6, start: '18:30', minutes: 90, who: 'Ingrid Pomerantz', audience: 'member' },
    { day: 4, court: 3, start: '16:00', minutes: 60, who: 'Barry Orlowski', audience: 'member' },
    {
      day: 5, court: 5, start: '09:30', minutes: 90, who: 'Dana Whitcomb', audience: 'public',
      note: 'Guest of a member — Rossmoor resident, not in the club yet.',
    },
  ];
  const bookingPlan = [];
  for (const b of BOOKINGS) {
    const ymd = ymdIn(b.day);
    const [h, m] = b.start.split(':').map(Number);
    const endMin = h * 60 + m + b.minutes;
    const end = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
    if (!free(ymd, b.court, b.start, end)) continue;
    const card = rateFor(b.audience);
    const cents = card ? Math.round((card.price_cents * b.minutes) / 60) : 0;
    const ref = `book-${bookingPlan.length}`;
    hold(ymd, b.court, b.start, end, 'member', `Court booking — ${b.who}`, {
      source: 'courtconnect',
      // The ref is how the court_bookings row below finds its reservation:
      // Postgres hands `starts_at` back in its own format, so matching on the
      // timestamp text would silently match nothing.
      meta: { booked_by: b.who, audience: b.audience, booking_ref: ref },
    });
    bookingPlan.push({ ...b, ymd, end, cents, card, ref });
  }

  const reservations = await insMany('reservations', resRows);

  let signupCount = 0;
  for (const o of OPEN_PLAY) {
    const r = reservations.find((x) => x.signups_open && x.signups_pitch === o.pitch);
    if (!r) continue;
    const rows = o.players.map((name, i) => {
      const v = vaultByName.get(name);
      return {
        reservation_id: r.id,
        vault_player_id: v.id,
        guest_name: name,
        guest_email: v.email,
        status: 'confirmed',
        signed_up_at: new Date(Date.now() - (2 - i) * 3600e3).toISOString(),
      };
    });
    signupCount += (await insMany('reservation_signups', rows)).length;
  }

  const bookingRows = [];
  for (const b of bookingPlan) {
    const r = reservations.find((x) => x.meta?.booking_ref === b.ref);
    if (!r) continue;
    const v = vaultByName.get(b.who);
    bookingRows.push({
      club_id: clubId,
      reservation_id: r.id,
      court_id: court.get(b.court),
      booker_name: b.who,
      booker_email: v ? v.email : (b.login ? ACCOUNTS[b.login].email : emailOf(b.who)),
      booker_user_id: b.login ? ids[b.login] : null,
      rate_applied: b.audience,
      minutes: b.minutes,
      amount_cents: b.cents,
      price_breakdown: b.card
        ? [{
            rate_card_id: b.card.id,
            label: b.card.label,
            minutes: b.minutes,
            price_cents_per_hour: b.card.price_cents,
            cents: b.cents,
          }]
        : [],
      payment_status: b.cents > 0 ? 'pending' : 'waived',
      notes: b.note ?? null,
    });
  }
  const bookings = await insMany('court_bookings', bookingRows);
  console.log(
    `· Court sheet: ${reservations.length} reservations, 2 postings looking for players, ` +
      `${signupCount} signups, ${bookings.length} court bookings`,
  );

  // ------------------------------------------------------- Hit and Giggle
  const newCode = async (preferred) => {
    let c = preferred;
    for (let i = 0; i < 12; i += 1) {
      const { count } = await db.from('events').select('id', { count: 'exact', head: true }).eq('event_code', c);
      if (!count) return c;
      c = code6();
    }
    throw new Error('Could not find a free event code.');
  };

  const { data: strayMixer } = await db.from('events').select('id').eq('slug', MIXER_SLUG);
  if (strayMixer?.length) throw new Error(`Slug ${MIXER_SLUG} is used by an event this script does not own; refusing.`);

  const mixerEvent = await ins('events', {
    user_id: directorId,
    club_id: clubId,
    name: 'Hit and Giggle — September',
    event_date: HIT_AND_GIGGLE.date,
    start_time: HIT_AND_GIGGLE.start,
    end_time: HIT_AND_GIGGLE.end,
    duration_minutes: 120,
    event_code: await newCode(MIXER_CODE),
    slug: MIXER_SLUG,
    venue: 'Creekside courts',
    num_courts: MIXER_COURTS,
    match_format: 'mixed-doubles',
    scoring_format: 'first_to_x',
    target_games: 11,
    format_notes:
      'The club social. All levels, a new partner and new opponents every round, games to 11.\n\nThe club signs people up by passing a basket round as they arrive. This is that basket: everyone who put their name in, drawn into three rounds across six courts, with each player\'s own next court on their phone.',
    public_registration: true,
    public_status: 'completed',
    entry_fee_cents: 0,
    max_players: 24,
    max_men: 12,
    max_women: 12,
    gender_restriction: 'coed',
    registration_opens_at: pt('2026-08-14', '09:00'),
    registration_closes_at: pt(HIT_AND_GIGGLE.date, HIT_AND_GIGGLE.start),
  }, 'id, event_code');

  // 12 men + 12 women, spread across the club's four levels rather than taken
  // alphabetically — a Hit and Giggle is explicitly all levels.
  const pickSpread = (pool, n) => {
    const order = ['advanced', 'adv_int', 'intermediate', 'novice'];
    const buckets = order.map((lvl) => pool.filter(([, , l]) => l === lvl));
    const out = [];
    for (let i = 0; out.length < n; i += 1) {
      for (const b of buckets) {
        if (b[i] && out.length < n) out.push(b[i]);
      }
      if (i > 40) break;
    }
    return out;
  };
  const mixMen = pickSpread(MEN, 12);
  const mixWomen = pickSpread(WOMEN, 12);
  if (mixMen.length < 12 || mixWomen.length < 12) throw new Error('Not enough invented players for the draw.');

  const roster = [
    ...mixMen.map(([n]) => ({ name: n, gender: 'male' })),
    ...mixWomen.map(([n]) => ({ name: n, gender: 'female' })),
  ];
  const players = await insMany(
    'players',
    roster.map((p) => ({
      user_id: directorId,
      club_id: clubId,
      name: p.name,
      gender: p.gender,
      rating_notes: PLAYER_TAG,
    })),
  );
  await insMany(
    'event_players',
    players.map((p, i) => ({ event_id: mixerEvent.id, player_id: p.id, strength_order: i, active: true })),
  );
  // The signups that filled it: no email on file, so nothing can ever mail an
  // @example.com inbox and bounce.
  const signupStart = Date.parse(pt('2026-08-14', '09:00'));
  await insMany(
    'tournament_entries',
    roster.map((p, i) => ({
      event_id: mixerEvent.id,
      player_name: p.name,
      gender: p.gender,
      position: 'in_draw',
      payment_status: 'waived',
      registered_at: new Date(signupStart + (i * 71 + 5) * 60_000).toISOString(),
      imported_at: pt(HIT_AND_GIGGLE.date, '15:45'),
    })),
  );

  // The same call RoundsTab makes for "Generate Multiple", seeded so re-runs
  // draw the same sheet. Players go in by NAME so the draw does not depend on
  // freshly minted uuids.
  const byName = [...players].sort((a, b) => a.name.localeCompare(b.name));
  const generator = new RoundGenerator(
    byName.map((p) => ({ player_id: p.id, name: p.name, gender: p.gender })),
    MIXER_COURTS,
    'mixed-doubles',
  );
  generator.setSeed(MIXER_SEED);
  const schedule = generator.generateMultipleRounds(MIXER_ROUNDS);

  const standings = new Map(players.map((p) => [p.id, { wins: 0, losses: 0, games_won: 0, games_lost: 0 }]));
  let matchCount = 0;
  for (let r = 0; r < schedule.length; r += 1) {
    const round = await ins('rounds', {
      event_id: mixerEvent.id,
      round_number: r + 1,
      status: 'completed',
      start_time: pt(HIT_AND_GIGGLE.date, `16:${String(r * 20 + 5).padStart(2, '0')}`),
      end_time: pt(HIT_AND_GIGGLE.date, `16:${String(r * 20 + 18).padStart(2, '0')}`),
    });
    const ordered = [...schedule[r].filter((p) => p.player2_id), ...schedule[r].filter((p) => !p.player2_id)];
    const rows = ordered.map((row, i) => {
      const base = { ...row, court_number: i + 1, round_id: round.id };
      if (!row.player2_id) return base;
      const [s1, s2] = MIXER_SCORES[r % MIXER_SCORES.length][i % MIXER_COURTS];
      const winner = s1 > s2 ? 1 : 2;
      for (const [pid, side] of [
        [row.player1_id, 1], [row.player3_id, 1],
        [row.player2_id, 2], [row.player4_id, 2],
      ]) {
        const s = standings.get(pid);
        if (!s) continue;
        s.games_won += side === 1 ? s1 : s2;
        s.games_lost += side === 1 ? s2 : s1;
        if (winner === side) s.wins += 1;
        else s.losses += 1;
      }
      return { ...base, team1_score: s1, team2_score: s2, winner_team: winner };
    });
    matchCount += (await insMany('matches', rows)).length;
  }
  for (const [pid, s] of standings) {
    await must(
      db.from('event_players').update(s).eq('event_id', mixerEvent.id).eq('player_id', pid),
      'event_players standings',
    );
  }
  console.log(
    `· Hit and Giggle ${MIXER_CODE}: 24 players, ${schedule.length} rounds on ${MIXER_COURTS} courts, ${matchCount} matches, all scored`,
  );

  // --------------------------------------------------------------- events
  const grill = await ins('events', {
    user_id: directorId,
    club_id: clubId,
    name: 'Grill & Chill',
    event_date: GRILL_AND_CHILL.date,
    start_time: GRILL_AND_CHILL.start,
    end_time: GRILL_AND_CHILL.end,
    duration_minutes: 120,
    event_code: await newCode(code6()),
    num_courts: MIXER_COURTS,
    match_format: 'mixed-doubles',
    scoring_format: 'timed',
    round_length_minutes: 20,
    venue: 'Creekside courts',
    format_notes:
      'Paddles down at six. Burgers, salads and whatever you brought, on the patio at Creekside. Bring a chair.',
    public_registration: true,
    public_status: 'open',
    entry_fee_cents: 0,
    max_players: 80,
  });

  const gala = await ins('events', {
    user_id: directorId,
    club_id: clubId,
    name: 'Annual Gala',
    event_date: ANNUAL_GALA.date,
    start_time: ANNUAL_GALA.start,
    end_time: ANNUAL_GALA.end,
    duration_minutes: 240,
    event_code: await newCode(code6()),
    num_courts: 0,
    match_format: 'mixed-doubles',
    scoring_format: 'timed',
    venue: 'Rossmoor Event Center',
    format_notes:
      'The club’s night out: dinner, the Volunteer of the Year, and the year in pickleball. Event Center, five till nine.',
    public_registration: true,
    public_status: 'open',
    entry_fee_cents: 0,
    max_players: 220,
  });

  // The published club calendar reads calendar_items on a published plan.
  const plan = await ins('calendar_plans', {
    club_id: clubId,
    owner_id: directorId,
    year: 2026,
    name: 'Rossmoor Pickleball Club 2026',
    status: 'published',
  });
  const calendarItems = await insMany('calendar_items', [
    {
      plan_id: plan.id, club_id: clubId, title: 'Hit and Giggle — September', department: 'pickleball',
      description: 'Social mixed doubles, all levels, a new partner every round. 4–6pm.',
      status: 'done', target_date: HIT_AND_GIGGLE.date, start_time: HIT_AND_GIGGLE.start,
      duration_minutes: 120, courts_needed: MIXER_COURTS, expected_attendance: 24,
      entry_fee_cents: 0, event_id: mixerEvent.id,
    },
    {
      plan_id: plan.id, club_id: clubId, title: 'Grill & Chill', department: 'social',
      description: 'Play, then eat. Burgers and salads on the Creekside patio, 5–7pm.',
      status: 'promoted', target_date: GRILL_AND_CHILL.date, start_time: GRILL_AND_CHILL.start,
      duration_minutes: 120, courts_needed: MIXER_COURTS, expected_attendance: 80,
      entry_fee_cents: 0, event_id: grill.id,
    },
    {
      plan_id: plan.id, club_id: clubId, title: 'Annual Meeting (board)', department: 'other',
      description: 'The October board meeting and the club’s Annual Meeting. Club Room, Creekside, 1:00–2:30pm.',
      status: 'promoted', target_date: ANNUAL_MEETING.date, start_time: ANNUAL_MEETING.start,
      duration_minutes: 90, courts_needed: 0, expected_attendance: 40, entry_fee_cents: 0,
    },
    {
      plan_id: plan.id, club_id: clubId, title: 'Annual Gala', department: 'social',
      description: 'Dinner at the Rossmoor Event Center, 5–9pm. Volunteer of the Year and the year in pickleball.',
      status: 'promoted', target_date: ANNUAL_GALA.date, start_time: ANNUAL_GALA.start,
      duration_minutes: 240, courts_needed: 0, expected_attendance: 200, entry_fee_cents: 0,
      event_id: gala.id,
    },
  ]);
  console.log(`· Events: Hit and Giggle, Grill & Chill, Annual Meeting, Annual Gala — ${calendarItems.length} on a published 2026 calendar`);

  // ---------------------------------------------------------- CourtConnect
  /*
   * A CourtConnect board with nothing on it demos nothing. Casey (the second
   * demo member) posts two open games so Robin can tap "I'm in" on the first
   * visit. Inserted directly rather than through the app, because posting
   * through the app would notify the club, and this is a seed, not a visitor.
   *
   * The level bands are the club's own four tiers expressed as the numbers
   * CourtConnect filters on: 2.5–3.25 is Intermediate through Advanced
   * Intermediate.
   */
  const games = [
    {
      starts_at: pt(ymdIn(1), '10:00'),
      format: 'doubles',
      spots_needed: 2,
      rating_min: LEVELS.intermediate.rating,
      rating_max: LEVELS.adv_int.rating,
      include_unrated: false,
      note: 'Rec doubles, Intermediate and up. I’ll bring balls.',
    },
    {
      starts_at: pt(ymdIn(2), '16:00'),
      format: 'mixed',
      spots_needed: 2,
      rating_min: null,
      rating_max: null,
      include_unrated: true,
      note: 'Mixed, all levels welcome — new members especially.',
    },
  ];
  await must(
    db.from('pf_games').insert(
      games.map((g) => ({ ...g, club_id: clubId, posted_by: ids.member2, duration_min: 90, status: 'open' })),
    ),
    'CourtConnect games',
  );
  console.log(`· CourtConnect: ${games.length} open games posted by ${ACCOUNTS.member2.name}`);

  // -------------------------------------------------------------- summary
  console.table({
    cc_vault_players: vault.length,
    reservations: reservations.length,
    reservation_signups: signupCount,
    court_bookings: bookings.length,
    mixer_players: players.length,
    mixer_matches: matchCount,
    events: 3,
    calendar_items: calendarItems.length,
    pf_games: games.length,
  });

  const base = 'https://clubmode.ai';
  console.log('\nOpen:');
  console.log(`  ${base}/c/${SLUG}`);
  console.log(`  ${base}/c/${SLUG}/courts            (book an indoor court)`);
  console.log(`  ${base}/c/${SLUG}/play              (CourtConnect)`);
  console.log(`  ${base}/courtsheet/${SLUG}`);
  console.log(`  ${base}/calendar/${SLUG}?year=2026`);
  console.log(`  ${base}/event/${mixerEvent.event_code}/print   (Hit and Giggle round sheets)`);
  console.log(`  ${base}/events/${MIXER_SLUG}   (the Hit and Giggle sign-up page)`);
  console.log(`  ${base}/member`);
  console.log(`\ndemo_mode is ${club.demo_mode ? 'ON — every club email is held' : 'OFF'}. Courts today: ${indoor.map((n) => courtName.get(n)).join(', ')}`);

  console.log('\nLogins:');
  for (const [key, acct] of Object.entries(ACCOUNTS)) {
    console.log(
      `  ${acct.role.padEnd(8)} ${acct.email.padEnd(26)} ${
        passwords[key] ?? '(password unchanged — pass --reset-passwords to rotate)'
      }`,
    );
  }
  console.log('');
}

main().catch((e) => {
  console.error('\nFAILED:', e.message || e);
  process.exit(1);
});

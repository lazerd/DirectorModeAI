/**
 * seed-rossmoor-demo.mjs — a lived-in sales demo for Rossmoor Tennis Club.
 *
 * seed-rossmoor.mjs builds the club, its website and its weekly programs. This
 * script fills that club with a season in progress so the board can click
 * around something that looks like their own September:
 *
 *   - three demo logins seated ONLY at Rossmoor (a director, two members)
 *   - ~60 fictional residents in PlayerVault
 *   - three CaptainMode teams (SMIL men, two EBWL women's teams) with a
 *     schedule, availability coming in, a saved lineup and an open sub request
 *   - three weeks of the court sheet: drop-in, clinic, ball machine, a home
 *     SMIL match, and two open-play postings looking for players
 *   - Oktoberfest Social and the Halloween Tournament, on the member home and
 *     on the published club calendar
 *
 *   node scripts/seed-rossmoor-demo.mjs                    # build / reset
 *   node scripts/seed-rossmoor-demo.mjs --reset-passwords  # also rotate logins
 *
 * IDEMPOTENT. Every run deletes what this script owns and rebuilds it. What it
 * owns is found by OWNERSHIP, never by club alone, so a real Rossmoor booking or
 * event made by someone else is never touched:
 *   captain_teams      captain_user_id = demo director (children cascade)
 *   cc_vault_players   director_id     = demo director
 *   events             user_id = demo director AND club_id = Rossmoor
 *   calendar_plans     owner_id = demo director AND club_id = Rossmoor
 *   reservations       club_id = Rossmoor AND meta.seed = SEED_TAG
 *
 * PEOPLE ARE INVENTED. Every roster name below is made up and every roster
 * email is @example.com, so nothing can ever mail a real person. The only real
 * names are the club's public captains (Bernie Wolf, Pat Baughman, Becky
 * Reiss), and they appear as team-contact labels with no contact details.
 *
 * NO EMAIL LEAVES. CaptainMode's daily cron sends lineups, nudges and
 * reminders on its own. Every demo team has all four timeline emails switched
 * OFF (captain_email_settings), because example.com bounces and a bounce costs
 * the sending domain reputation.
 *
 * Passwords are generated on first creation and printed once. They are never
 * written to this file.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { randomBytes } from 'crypto';

const SLUG = 'rossmoor-tennis-club';
const SEED_TAG = 'rossmoor-demo';
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
  director: { email: 'rossmoor-demo@clubmode.ai', name: 'Demo Director', role: 'director' },
  member: { email: 'rossmoor-member@clubmode.ai', name: 'Pat Demo', role: 'member' },
  member2: { email: 'rossmoor-member2@clubmode.ai', name: 'Lee Demo', role: 'member' },
};

// ---------------------------------------------------------------- the people
// [name, age, NTRP]. Invented. Kept in data so a re-run rebuilds the same club.
const MEN = [
  ['Walter Brandt', 74, 3.5], ['Harold Kessler', 81, 3.0], ['Gordon Pruitt', 69, 3.5],
  ['Leonard Ashby', 77, 3.0], ['Stanley Okafor', 66, 4.0], ['Frank Delgado', 72, 3.5],
  ['Warren Ishikawa', 70, 3.5], ['Russell Thornbury', 84, 3.0], ['Dale Whitcombe', 68, 3.5],
  ['Norman Feld', 79, 3.0], ['Clifford Yee', 73, 3.5], ['Arthur Lindqvist', 76, 3.0],
  ['Vernon Castellano', 65, 3.5], ['Eugene Markham', 88, 2.5], ['Howard Brennan', 71, 3.0],
  ['Lloyd Nakamura', 63, 4.0], ['Gerald Fairbanks', 82, 2.5], ['Raymond Oyelaran', 67, 3.5],
  ['Martin Szabo', 75, 3.0], ['Douglas Penhallow', 61, 3.5], ['Philip Grimsby', 86, 2.5],
  ['Kenneth Alvarado', 64, 3.5], ['Theodore Haskins', 78, 3.0], ['Bruce Kowalczyk', 70, 3.0],
];
const WOMEN = [
  ['Dorothy Albrecht', 76, 3.5], ['Marjorie Kline', 71, 4.0], ['Joan Whitaker', 68, 3.5],
  ['Carol Esposito', 73, 3.5], ['Judith Hanlon', 80, 3.5], ['Beverly Tran', 66, 4.0],
  ['Nancy Liebowitz', 74, 3.5], ['Sandra Okonkwo', 69, 3.5], ['Elaine Prescott', 77, 3.5],
  ['Janet Moriyama', 70, 4.0], ['Gail Fontaine', 72, 3.5], ['Linda Carrozza', 67, 3.5],
  ['Patricia Vogel', 62, 3.0], ['Susan Hargrove', 64, 3.5], ['Diane Kaplowitz', 60, 3.0],
  ['Maureen Delacroix', 65, 3.0], ['Roberta Engstrom', 71, 3.5], ['Frances Oduya', 63, 3.0],
  ['Lorraine Bexley', 68, 3.0], ['Phyllis Tanaka', 61, 3.5], ['Rosalind Mercer', 66, 3.0],
  ['Helen Vukovich', 62, 3.5], ['Irene Castellanos', 79, 3.0], ['Evelyn Sorensen', 83, 2.5],
  ['Margaret Quill', 75, 3.0], ['Constance Abernathy', 87, 2.5], ['Sharon Wexler', 70, 3.0],
  ['Donna Pelletier', 73, 3.0], ['Kathleen Rourke', 69, 3.5], ['Ellen Nakashima', 78, 3.0],
  ['Ruth Amsel', 85, 2.5], ['Cynthia Baptiste', 64, 3.0], ['Glenda Hollis', 72, 3.0],
  ['Audrey Pomeroy', 81, 3.0], ['Virginia Salcedo', 67, 3.5], ['Arlene Du Bois', 76, 3.0],
];

const emailOf = (name) => `${name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')}@example.com`;

// -------------------------------------------------------------------- teams
// Rosters are names from the lists above. `subs` are flagged is_sub.
const TEAMS = [
  {
    key: 'smil',
    name: 'Rossmoor SMIL Men 60+',
    level: '60+ · 3.0–3.5',
    captain: 'Bernie Wolf',
    gender: 'M',
    doubles: 4,
    time: '10:00',
    demoMember: 'member2', // Lee Demo
    roster: [
      'Walter Brandt', 'Gordon Pruitt', 'Stanley Okafor', 'Frank Delgado', 'Warren Ishikawa',
      'Dale Whitcombe', 'Clifford Yee', 'Vernon Castellano', 'Lloyd Nakamura', 'Raymond Oyelaran',
      'Harold Kessler', 'Leonard Ashby', 'Norman Feld',
    ],
    subs: ['Harold Kessler', 'Leonard Ashby', 'Norman Feld'],
    // Senior Men's Interclub League: alternate Wednesdays, skipping Thanksgiving
    // week and the holidays.
    matches: [
      ['2026-09-30', true, 'Blackhawk'],
      ['2026-10-14', false, 'Walnut Creek #1'],
      ['2026-10-28', true, 'Crow Canyon'],
      ['2026-11-11', false, 'Round Hill'],
      ['2026-12-09', true, 'Moraga CC'],
      ['2027-01-13', false, 'Blackhawk'],
    ],
  },
  {
    key: 'w65',
    name: 'Rossmoor Women 65+ (EBWL)',
    level: '3.5+',
    captain: 'Pat Baughman',
    gender: 'F',
    doubles: 3,
    time: '09:30',
    demoMember: null,
    roster: [
      'Dorothy Albrecht', 'Marjorie Kline', 'Joan Whitaker', 'Carol Esposito', 'Judith Hanlon',
      'Beverly Tran', 'Nancy Liebowitz', 'Sandra Okonkwo', 'Elaine Prescott', 'Janet Moriyama',
      'Gail Fontaine', 'Linda Carrozza',
    ],
    subs: ['Judith Hanlon', 'Linda Carrozza'],
    matches: [
      ['2026-10-06', true, 'Bay Trees'],
      ['2026-10-20', false, 'Danville'],
      ['2026-11-03', true, 'Diablo'],
      ['2026-11-17', false, 'Crow Canyon'],
      ['2026-12-01', true, 'Pleasanton'],
    ],
  },
  {
    key: 'buckeyes',
    name: 'Rossmoor Buckeyes 50+ (EBWL)',
    level: '3.0–3.5',
    captain: 'Becky Reiss',
    gender: 'F',
    doubles: 3,
    time: '09:30',
    demoMember: 'member', // Pat Demo
    roster: [
      'Patricia Vogel', 'Susan Hargrove', 'Diane Kaplowitz', 'Maureen Delacroix', 'Roberta Engstrom',
      'Frances Oduya', 'Lorraine Bexley', 'Phyllis Tanaka', 'Rosalind Mercer', 'Helen Vukovich',
      'Kathleen Rourke',
    ],
    subs: ['Rosalind Mercer', 'Frances Oduya'],
    matches: [
      ['2026-10-08', false, 'Concord'],
      ['2026-10-22', true, 'El Cerrito'],
      ['2026-11-05', false, 'San Ramon'],
      ['2026-11-19', true, 'Fremont'],
      ['2026-12-03', false, 'Walnut Creek'],
    ],
  },
];

const HOME = 'Buckeye Tennis Complex, Rossmoor';
const EMAIL_KINDS = [
  ['poll', 14],
  ['lineup', 7],
  ['nudge', 2],
  ['reminder', 1],
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
 * Pacific wall-clock to an ISO string with an EXPLICIT offset. PDT runs
 * through 2am Sun Nov 1 2026 and resumes Mar 14 2027; nothing here is
 * scheduled in the small hours, so the date alone decides.
 */
function pt(ymd, hhmm) {
  const pdt = (ymd < '2026-11-01') || (ymd >= '2027-03-14');
  return `${ymd}T${hhmm}:00${pdt ? '-07:00' : '-08:00'}`;
}
/** Today in club time, plus n days, as YYYY-MM-DD. */
function ymdIn(n) {
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  return new Date(Date.parse(`${local}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}
const dow = (ymd) => new Date(`${ymd}T12:00:00Z`).getUTCDay();
const addMin = (hhmm, m) => {
  const [h, mm] = hhmm.split(':').map(Number);
  const t = h * 60 + mm + m;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};
const newPassword = () => `Rtc-${randomBytes(12).toString('base64url')}-9`;
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
    .select('id, name, owner_id, timezone')
    .eq('slug', SLUG)
    .maybeSingle();
  if (!club) throw new Error(`No club "${SLUG}" — run seed-rossmoor.mjs first.`);
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

    // Seated at Rossmoor and nowhere else.
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
  console.log('· 3 demo accounts, seated only at Rossmoor');

  // CaptainMode is its own subscription: the club comps its director.
  await must(
    db.from('captain_subscriptions').upsert(
      {
        user_id: directorId,
        club_id: clubId,
        rate_type: 'club_linked',
        status: 'comped',
        comp_note: 'Rossmoor demo — comped by the club',
        comped_by: club.owner_id,
        comped_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    ),
    'captain_subscriptions',
  );

  // ---------------------------------------------------------------- reset
  await must(
    db.from('reservations').delete().eq('club_id', clubId).eq('meta->>seed', SEED_TAG),
    'reset reservations',
  );
  await must(db.from('captain_teams').delete().eq('captain_user_id', directorId), 'reset captain_teams');
  await must(db.from('cc_vault_players').delete().eq('director_id', directorId), 'reset vault');
  {
    const { data: evs } = await db.from('events').select('id').eq('club_id', clubId).eq('user_id', directorId);
    const evIds = (evs ?? []).map((e) => e.id);
    if (evIds.length) {
      await db.from('calendar_items').update({ event_id: null }).in('event_id', evIds);
      for (const t of ['tournament_matches', 'tournament_entries', 'event_players', 'event_teams']) {
        await db.from(t).delete().in('event_id', evIds);
      }
      await must(db.from('events').delete().in('id', evIds), 'reset events');
    }
    const { data: plans } = await db.from('calendar_plans').select('id').eq('club_id', clubId).eq('owner_id', directorId);
    const planIds = (plans ?? []).map((p) => p.id);
    if (planIds.length) {
      await must(db.from('calendar_items').delete().in('plan_id', planIds), 'reset calendar_items');
      await must(db.from('calendar_plans').delete().in('id', planIds), 'reset calendar_plans');
    }
  }
  console.log('· wiped prior demo rows');

  // --------------------------------------------------------------- vault
  const vaultRows = [
    ...MEN.map(([n, a, r]) => [n, a, r, 'male']),
    ...WOMEN.map(([n, a, r]) => [n, a, r, 'female']),
  ].map(([full_name, age, usta, gender]) => ({
    director_id: directorId,
    full_name,
    email: emailOf(full_name),
    gender,
    age,
    usta_rating: usta,
    rating_source: 'manual',
    primary_sport: 'tennis',
    sports: ['tennis'],
    membership_status: 'active',
    notes: 'Fictional demo resident.',
  }));
  const vault = await insMany('cc_vault_players', vaultRows);
  const vaultByName = new Map(vault.map((v) => [v.full_name, v]));
  const ratingOf = new Map([...MEN, ...WOMEN].map(([n, , r]) => [n, r]));
  console.log(`· PlayerVault: ${vault.length} residents`);

  // ------------------------------------------------------------ captain
  const teamOut = {};
  for (const T of TEAMS) {
    const firstMatch = T.matches[0][0];
    const lastMatch = T.matches[T.matches.length - 1][0];
    const team = await ins('captain_teams', {
      captain_user_id: directorId,
      created_by: directorId,
      club_id: clubId,
      name: T.name,
      league_type: 'flex',
      level: T.level,
      season_start: firstMatch,
      season_end: lastMatch,
      captaining_style: 'equal_play',
      default_singles_courts: 0,
      default_doubles_courts: T.doubles,
      host_notes: 'Park in the Buckeye lot off Tice Creek Drive. Water and fruit at the viewing stands.',
    });
    const teamId = team.id;

    await must(
      db.from('captain_team_staff').insert({ team_id: teamId, user_id: directorId, role: 'captain' }),
      'captain_team_staff',
    );
    // The team's public captain, as a label only — no contact details.
    await must(
      db.from('captain_team_contacts').insert({
        team_id: teamId, name: T.captain, role: 'captain', on_emails: false, sort_order: 0,
      }),
      'captain_team_contacts',
    );
    // Timeline emails OFF (see header).
    await must(
      db.from('captain_email_settings').insert(
        EMAIL_KINDS.map(([kind, lead]) => ({ team_id: teamId, kind, enabled: false, lead_days: lead })),
      ),
      'captain_email_settings',
    );
    await insMany(
      'captain_opponents',
      [...new Set(T.matches.map((m) => m[2]))].map((opponent) => ({
        team_id: teamId, opponent, home_club: opponent,
      })),
    );

    // Roster: strongest first, subs last.
    const names = [...T.roster].sort((a, b) => {
      const sa = T.subs.includes(a) ? 1 : 0;
      const sb = T.subs.includes(b) ? 1 : 0;
      return sa - sb || ratingOf.get(b) - ratingOf.get(a);
    });
    const playerRows = names.map((name, i) => ({
      team_id: teamId,
      name,
      email: emailOf(name),
      rating: ratingOf.get(name),
      rating_type: 'self',
      gender: T.gender,
      is_sub: T.subs.includes(name),
      sort_order: i + 1,
      notes: null,
    }));
    if (T.demoMember) {
      const acct = ACCOUNTS[T.demoMember];
      playerRows.push({
        team_id: teamId,
        name: acct.name,
        email: acct.email,
        rating: 3.5,
        rating_type: 'self',
        gender: T.gender,
        is_sub: false,
        sort_order: playerRows.length + 1,
        notes: 'Demo login',
      });
    }
    const players = await insMany('captain_players', playerRows);
    const pByName = new Map(players.map((p) => [p.name, p]));

    const matches = await insMany(
      'captain_matches',
      T.matches.map(([date, isHome, opponent]) => ({
        team_id: teamId,
        match_at: pt(date, T.time),
        is_home: isHome,
        opponent,
        location: isHome ? HOME : opponent,
        arrival_note: isHome ? 'Arrive 20 minutes early to warm up. Courts 1–6.' : 'Carpool from the Gateway lot, 45 minutes before start.',
        singles_courts: 0,
        doubles_courts: T.doubles,
        status: 'scheduled',
      })),
    );
    matches.sort((a, b) => a.match_at.localeCompare(b.match_at));
    teamOut[T.key] = { team, players, pByName, matches, T };
  }

  // Availability for each team's next match, about 70% answered.
  const answer = async (key, rows) => {
    const { team, pByName, matches } = teamOut[key];
    const next = matches[0];
    await insMany(
      'captain_availability',
      rows.map(([name, status, note]) => ({
        team_id: team.id,
        match_id: next.id,
        player_id: pByName.get(name).id,
        status,
        note: note ?? null,
      })),
    );
  };

  // SMIL: 14 on the roster, 10 answer. The lineup is built from the yeses; then
  // Dale Whitcombe drops out and a sub request goes up for his seat.
  const SMIL_LINEUP = [
    ['Stanley Okafor', 'Lloyd Nakamura'],
    ['Walter Brandt', 'Gordon Pruitt'],
    ['Frank Delgado', 'Dale Whitcombe'],
    ['Clifford Yee', 'Vernon Castellano'],
  ];
  await answer('smil', [
    ['Stanley Okafor', 'yes'], ['Lloyd Nakamura', 'yes'], ['Walter Brandt', 'yes'],
    ['Gordon Pruitt', 'yes'], ['Frank Delgado', 'yes'], ['Clifford Yee', 'yes'],
    ['Vernon Castellano', 'yes'],
    ['Dale Whitcombe', 'no', 'Knee is acting up — so sorry, need a sub.'],
    ['Raymond Oyelaran', 'no', 'Grandkids in town that week.'],
    ['Lee Demo', 'maybe', 'Should know by Monday.'],
  ]);
  await answer('w65', [
    ['Marjorie Kline', 'yes'], ['Beverly Tran', 'yes'], ['Janet Moriyama', 'yes'],
    ['Dorothy Albrecht', 'yes'], ['Joan Whitaker', 'yes'],
    ['Carol Esposito', 'no', 'Away visiting my sister.'], ['Nancy Liebowitz', 'no'],
    ['Sandra Okonkwo', 'maybe'],
  ]);
  await answer('buckeyes', [
    ['Susan Hargrove', 'yes'], ['Phyllis Tanaka', 'yes'], ['Helen Vukovich', 'yes'],
    ['Roberta Engstrom', 'yes'], ['Kathleen Rourke', 'yes'], ['Pat Demo', 'yes'],
    ['Diane Kaplowitz', 'no', 'Doctor appointment.'], ['Lorraine Bexley', 'maybe'],
  ]);

  // SMIL next match: saved lineup + one open sub request.
  {
    const { team, pByName, matches } = teamOut.smil;
    const next = matches[0];
    const lineup = await insMany(
      'captain_lineups',
      SMIL_LINEUP.map(([a, b], i) => ({
        team_id: team.id,
        match_id: next.id,
        court_number: i + 1,
        court_type: 'doubles',
        player1_id: pByName.get(a).id,
        player2_id: pByName.get(b).id,
      })),
    );
    // What /api/captain/subs does: vacate the seat, then open the request.
    const court3 = lineup.find((l) => l.court_number === 3);
    const dropped = pByName.get('Dale Whitcombe');
    await must(
      db.from('captain_lineups').update({ player2_id: null, player2_confirmed_at: null }).eq('id', court3.id),
      'vacate seat',
    );
    const req = await ins(
      'captain_sub_requests',
      { team_id: team.id, match_id: next.id, lineup_id: court3.id, slot: 2, dropped_player_id: dropped.id, status: 'open' },
      'id, request_token',
    );
    teamOut.smil.subRequest = req;
  }
  console.log('· CaptainMode: 3 teams, rosters, schedules, availability, SMIL lineup + open sub request');

  // ---------------------------------------------------------- court sheet
  const { data: courtRows } = await db.from('courts').select('id, number').eq('club_id', clubId);
  const court = new Map((courtRows ?? []).map((c) => [c.number, c.id]));
  if (court.size < 8) throw new Error(`Rossmoor has ${court.size} courts; expected 8.`);

  const { data: progRows } = await db.from('club_programs').select('id, slug, title').eq('club_id', clubId);
  const prog = new Map((progRows ?? []).map((p) => [p.slug, p]));

  const resRows = [];
  const hold = (ymd, courtNo, start, end, type, title, extra = {}) =>
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
  const fromProgram = (slug) => {
    const p = prog.get(slug);
    return p ? { source: 'programs', source_id: p.id, meta: { program_id: p.id, program_title: p.title } } : {};
  };

  const smil = teamOut.smil;
  const smilHomeDates = new Set(
    smil.T.matches.filter((m) => m[1]).map((m) => m[0]),
  );

  for (let n = 0; n < 21; n += 1) {
    const d = ymdIn(n);
    const w = dow(d);
    if (w === 2 || w === 4) {
      for (const c of [3, 4]) hold(d, c, '09:00', '11:00', 'member', 'Drop-in doubles', fromProgram('drop-in-doubles-weekday'));
    }
    if (w === 0) {
      for (const c of [3, 4]) hold(d, c, '08:30', '10:30', 'member', 'Sunday drop-in', fromProgram('drop-in-doubles-sunday'));
    }
    // The clinic gives way on a home SMIL Wednesday.
    if (w === 3 && !smilHomeDates.has(d)) {
      for (const c of [1, 2]) hold(d, c, '10:00', '11:30', 'lesson', 'Stroke & strategy clinic', fromProgram('wednesday-clinic'));
    }
    if (w === 5) hold(d, 2, '10:00', '11:00', 'member', 'Ball machine drill clinic', fromProgram('ball-machine-drill'));
  }

  // Every SMIL home match holds courts 1–6; 7 and 8 stay open (club rule).
  for (const m of smil.matches.filter((x) => x.is_home)) {
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(m.match_at));
    for (let c = 1; c <= 6; c += 1) {
      hold(ymd, c, smil.T.time, addMin(smil.T.time, 210), 'match', `SMIL vs ${m.opponent}`, {
        meta: { captain_team_id: smil.team.id, captain_match_id: m.id },
      });
    }
  }

  // Two open-play postings looking for players.
  const nextDow = (want) => {
    for (let n = 1; n < 8; n += 1) if (dow(ymdIn(n)) === want) return ymdIn(n);
    return null;
  };
  const OPEN_PLAY = [
    {
      ymd: nextDow(6), court: 5, start: '09:00', end: '10:30',
      title: 'Saturday doubles hit',
      pitch: 'Doubles hit Sat 9am, need 2 more (3.0–3.5)',
      players: ['Warren Ishikawa', 'Howard Brennan'],
    },
    {
      ymd: nextDow(1), court: 6, start: '10:00', end: '11:30',
      title: 'Monday ladies doubles',
      pitch: 'Ladies doubles Mon 10am, need 2 more (3.0–3.5)',
      players: ['Margaret Quill', 'Sharon Wexler'],
    },
  ];
  for (const o of OPEN_PLAY) {
    hold(o.ymd, o.court, o.start, o.end, 'member', o.title, {
      signups: true, capacity: 4, pitch: o.pitch, meta: { open_play: true },
    });
  }

  const reservations = await insMany('reservations', resRows);
  let signupCount = 0;
  for (const o of OPEN_PLAY) {
    const r = reservations.find((x) => x.signups_open && x.signups_pitch === o.pitch);
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
  console.log(`· Court sheet: ${reservations.length} reservations, 2 open-play postings, ${signupCount} signups`);

  // --------------------------------------------------------------- events
  const newCode = async () => {
    for (let i = 0; i < 10; i += 1) {
      const c = code6();
      const { count } = await db.from('events').select('id', { count: 'exact', head: true }).eq('event_code', c);
      if (!count) return c;
    }
    throw new Error('Could not find a free event code.');
  };

  const oktoberfest = await ins('events', {
    user_id: directorId,
    club_id: clubId,
    name: 'Oktoberfest Social',
    event_date: '2026-09-26',
    start_time: '16:00',
    end_time: '19:00',
    duration_minutes: 180,
    event_code: await newCode(),
    num_courts: 8,
    match_format: 'mixed-doubles',
    scoring_format: 'timed',
    round_length_minutes: 25,
    venue: 'Buckeye BBQ area',
    format_notes: 'Mixed doubles round robin on all eight courts, then bratwurst, pretzels and a keg at the Buckeye barbecue. Bring a side dish to share.',
    public_registration: true,
    public_status: 'open',
    entry_fee_cents: 0,
    max_players: 48,
  });

  const halloween = await ins('events', {
    user_id: directorId,
    club_id: clubId,
    name: 'Halloween Tournament',
    event_date: '2026-10-31',
    end_date: '2026-10-31',
    start_time: '09:00',
    daily_start_time: '09:00',
    daily_end_time: '13:00',
    event_code: await newCode(),
    slug: 'rossmoor-halloween-tournament-2026',
    num_courts: 8,
    match_format: 'rr-doubles',
    scoring_format: 'fixed_games',
    event_scoring_format: 'pro8',
    venue: HOME,
    format_notes: 'Round robin doubles, 8-game pro sets. Costumes encouraged — prize for the best one.',
    public_registration: true,
    registration_opens_at: new Date().toISOString(),
    registration_closes_at: pt('2026-10-28', '17:00'),
    public_status: 'open',
    entry_fee_cents: 0,
    max_players: 32,
  });

  // The published club calendar reads calendar_items on a published plan.
  const plan = await ins('calendar_plans', {
    club_id: clubId,
    owner_id: directorId,
    year: 2026,
    name: 'Rossmoor Tennis Club 2026',
    status: 'published',
  });
  await insMany('calendar_items', [
    {
      plan_id: plan.id, club_id: clubId, title: 'Oktoberfest Social', department: 'social',
      description: 'Mixed doubles round robin, then bratwurst and pretzels at the Buckeye BBQ area.',
      status: 'promoted', target_date: '2026-09-26', start_time: '16:00', duration_minutes: 180,
      courts_needed: 8, expected_attendance: 60, entry_fee_cents: 0, event_id: oktoberfest.id,
    },
    {
      plan_id: plan.id, club_id: clubId, title: 'Halloween Tournament', department: 'tennis',
      description: 'Round robin doubles in costume. Prize for the best one.',
      status: 'promoted', target_date: '2026-10-31', start_time: '09:00', duration_minutes: 240,
      courts_needed: 8, expected_attendance: 32, entry_fee_cents: 0, event_id: halloween.id,
    },
  ]);
  console.log('· Events: Oktoberfest Social + Halloween Tournament, on a published 2026 calendar');

  // -------------------------------------------------------------- summary
  const count = async (table, col, val) => {
    const { count: c } = await db.from(table).select('*', { count: 'exact', head: true }).in(col, val);
    return c ?? 0;
  };
  const teamIds = Object.values(teamOut).map((t) => t.team.id);
  const summary = {
    cc_vault_players: vault.length,
    captain_teams: teamIds.length,
    captain_players: await count('captain_players', 'team_id', teamIds),
    captain_matches: await count('captain_matches', 'team_id', teamIds),
    captain_availability: await count('captain_availability', 'team_id', teamIds),
    captain_lineups: await count('captain_lineups', 'team_id', teamIds),
    captain_sub_requests: await count('captain_sub_requests', 'team_id', teamIds),
    reservations: reservations.length,
    reservation_signups: signupCount,
    events: 2,
    calendar_items: 2,
  };
  console.table(summary);

  const base = 'https://clubmode.ai';
  console.log('\nOpen:');
  console.log(`  ${base}/login`);
  console.log(`  ${base}/captain`);
  for (const t of Object.values(teamOut)) console.log(`  ${base}/captain/${t.team.id}   ${t.T.name}`);
  const smilNext = teamOut.smil.matches[0];
  console.log(`  ${base}/captain/${teamOut.smil.team.id}/match/${smilNext.id}   (SMIL next match)`);
  const lee = teamOut.smil.pByName.get('Lee Demo');
  const pat = teamOut.buckeyes.pByName.get('Pat Demo');
  console.log(`  ${base}/captain/availability/${pat.player_token}   (Pat Demo's no-login availability link)`);
  console.log(`  ${base}/captain/claim/${teamOut.smil.subRequest.request_token}/${lee.player_token}   (Lee Demo claims the sub spot)`);
  console.log(`  ${base}/courtsheet/${SLUG}`);
  console.log(`  ${base}/calendar/${SLUG}?year=2026`);
  console.log(`  ${base}/member`);
  // The reset above removed the October "Wild Card" mixer too (same owner + club).
  console.log('\nOctober Wild Card mixer: run node scripts/seed-rossmoor-mixer.mjs to put it back.');

  console.log('\nLogins:');
  for (const [key, acct] of Object.entries(ACCOUNTS)) {
    console.log(`  ${acct.role.padEnd(8)} ${acct.email.padEnd(30)} ${passwords[key] ?? '(password unchanged — pass --reset-passwords to rotate)'}`);
  }
  console.log('');
}

main().catch((e) => {
  console.error('\nFAILED:', e.message || e);
  process.exit(1);
});

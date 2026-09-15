/**
 * seed-lafayette-demo.mjs — demo logins and invented activity at Lafayette
 * Tennis Club, so its one-link demo (/demo/<token>) has something to show.
 *
 *   node scripts/seed-lafayette-demo.mjs [--reset-passwords]
 *   node scripts/demo-link.mjs --club lafayette-tennis-club --label Lafayette --expires 60d
 *
 * Lafayette is in evaluation but it is NOT a blank prospect like Rossmoor: its
 * site is published, its public court booking is on, and Hunter Gallaway owns
 * it and signs in. So, unlike Rossmoor:
 *
 *   - cc_clubs.demo_mode stays OFF. It would hold every email the club sends,
 *     including a real stranger's court-booking confirmation. Visitors on the
 *     demo link are still silent: sends by or to demo logins, to @example.com,
 *     or from a browser carrying the demo cookie are held (src/lib/demo).
 *   - Nothing of Hunter's is touched. Everything written here is either owned
 *     by a demo login or tagged meta.seed = SEED_TAG, and a re-run deletes only
 *     that.
 *
 * Invented people only, all @example.com. Passwords are printed once on
 * creation (or with --reset-passwords), never written to this file.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { randomBytes } from 'crypto';

const SLUG = 'lafayette-tennis-club';
const SEED_TAG = 'lafayette-demo';
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

const ACCOUNTS = {
  director: { email: 'lafayette-demo@clubmode.ai', name: 'Tennis Director (demo)', role: 'director' },
  member: { email: 'lafayette-member@clubmode.ai', name: 'Sam Demo', role: 'member' },
  member2: { email: 'lafayette-member2@clubmode.ai', name: 'Jordan Demo', role: 'member' },
};

// [name, age, NTRP, gender]. Invented adult members and junior-program parents.
const PEOPLE = [
  ['Megan Ashworth', 44, 3.5, 'female'], ['Chris Delaney', 51, 4.0, 'male'], ['Priya Raman', 39, 3.5, 'female'],
  ['Tom Whitfield', 58, 3.5, 'male'], ['Alicia Moreno', 46, 4.0, 'female'], ['Brian Koh', 42, 4.5, 'male'],
  ['Laura Pennington', 55, 3.0, 'female'], ['Greg Sandoval', 49, 3.5, 'male'], ['Nina Feldman', 37, 3.5, 'female'],
  ['Mark Ellison', 61, 3.0, 'male'], ['Rachel Tso', 43, 4.0, 'female'], ['Dave Mulroney', 53, 3.5, 'male'],
  ['Heather Quan', 48, 3.0, 'female'], ['Jason Albright', 40, 4.0, 'male'], ['Kim Oduya', 45, 3.5, 'female'],
  ['Steve Hartman', 57, 3.5, 'male'], ['Julie Brandt', 50, 3.5, 'female'], ['Ravi Menon', 47, 4.0, 'male'],
  ['Colleen Frey', 52, 3.0, 'female'], ['Andrew Pike', 38, 4.5, 'male'], ['Monica Vale', 41, 3.5, 'female'],
  ['Paul Genovese', 63, 3.0, 'male'], ['Erin Castillo', 36, 3.5, 'female'], ['Kevin Lund', 54, 3.5, 'male'],
  ['Tara Whitlock', 44, 4.0, 'female'], ['Ben Okafor', 46, 3.5, 'male'], ['Lisa Marchetti', 59, 3.0, 'female'],
  ['Scott Yamada', 50, 4.0, 'male'], ['Diana Reyes', 42, 3.5, 'female'], ['Neil Barrows', 48, 3.5, 'male'],
];
const emailOf = (name) => `${name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')}@example.com`;

// ------------------------------------------------------------------ helpers
async function must(p, what) {
  const { error, data } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}
const newPassword = () => `Ltc-${randomBytes(12).toString('base64url')}-9`;

/** Club wall-clock → ISO with the zone's real offset on that date. */
function clubTime(ymd, hhmm) {
  const off =
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' })
      .formatToParts(new Date(`${ymd}T12:00:00Z`))
      .find((p) => p.type === 'timeZoneName')
      .value.replace('GMT', '') || '+00:00';
  return new Date(`${ymd}T${hhmm}:00${off}`).toISOString();
}
function ymdIn(n) {
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  return new Date(Date.parse(`${local}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
}
const dow = (ymd) => new Date(`${ymd}T12:00:00Z`).getUTCDay();

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

async function main() {
  const { data: club } = await db.from('cc_clubs').select('id, name, demo_mode').eq('slug', SLUG).maybeSingle();
  if (!club) throw new Error(`No club "${SLUG}".`);
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
      if (RESET_PASSWORDS) patch.password = passwords[key] = newPassword();
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
    // Profile arrives by trigger; UPDATE, never upsert (protect_profile_billing).
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

    await must(db.from('cc_club_members').delete().eq('user_id', ids[key]).neq('club_id', clubId), 'strip other memberships');
    await must(
      db.from('cc_club_members').upsert({ club_id: clubId, user_id: ids[key], role: acct.role }, { onConflict: 'club_id,user_id' }),
      'membership',
    );
    const { count: owns } = await db.from('cc_clubs').select('id', { count: 'exact', head: true }).eq('owner_id', ids[key]);
    if (owns) throw new Error(`${acct.email} owns ${owns} club(s); refusing to continue.`);
  }
  console.log('· 3 demo accounts, seated only at Lafayette');

  // Member levels, so CourtConnect matches them (ratings live on the person).
  for (const [key, ntrp] of [['member', 3.5], ['member2', 3.5]]) {
    const email = ACCOUNTS[key].email;
    const { data: mp } = await db.from('master_players').select('id').ilike('email', email).maybeSingle();
    if (mp) await db.from('master_players').update({ ntrp, ntrp_source: 'self', ntrp_updated_at: new Date().toISOString() }).eq('id', mp.id);
    else await db.from('master_players').insert({ email, full_name: ACCOUNTS[key].name, ntrp, ntrp_source: 'self', ntrp_updated_at: new Date().toISOString() });
  }

  // ---------------------------------------------------------------- reset
  const directorId = ids.director;
  const demoIds = Object.values(ids);
  await must(db.from('pf_games').delete().eq('club_id', clubId).in('posted_by', demoIds), 'reset CourtConnect games');
  {
    const { data: rows } = await db.from('reservations').select('id').eq('club_id', clubId).eq('meta->>seed', SEED_TAG);
    const rowIds = (rows ?? []).map((r) => r.id);
    if (rowIds.length) {
      await db.from('reservation_signups').delete().in('reservation_id', rowIds);
      await must(db.from('reservations').delete().in('id', rowIds), 'reset reservations');
    }
  }
  await must(db.from('cc_vault_players').delete().eq('director_id', directorId), 'reset vault');
  console.log('· wiped prior demo rows');

  // --------------------------------------------------------------- vault
  const vault = await must(
    db
      .from('cc_vault_players')
      .insert(
        PEOPLE.map(([full_name, age, usta, gender]) => ({
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
          notes: 'Fictional demo member.',
        })),
      )
      .select('id, full_name, email'),
    'vault',
  );
  const vaultByName = new Map(vault.map((v) => [v.full_name, v]));
  console.log(`· PlayerVault: ${vault.length} members`);

  // ---------------------------------------------------------- court sheet
  // Hunter's weekly shape on the grid, so the court sheet reads Booked/Open
  // like a real week. Tagged, so a re-run removes exactly these.
  const { data: courtRows } = await db.from('courts').select('id, number').eq('club_id', clubId);
  const court = new Map((courtRows ?? []).map((c) => [c.number, c.id]));
  const resRows = [];
  const hold = (ymd, courtNo, start, end, type, title, extra = {}) => {
    if (!court.get(courtNo)) return;
    resRows.push({
      club_id: clubId,
      court_id: court.get(courtNo),
      starts_at: clubTime(ymd, start),
      ends_at: clubTime(ymd, end),
      type,
      source: 'manual',
      title,
      status: 'confirmed',
      created_by: directorId,
      signups_open: !!extra.signups,
      signups_capacity: extra.signups ? extra.capacity : null,
      signups_pitch: extra.signups ? extra.pitch : null,
      meta: { seed: SEED_TAG, ...(extra.meta ?? {}) },
    });
  };
  for (let n = 0; n < 14; n += 1) {
    const d = ymdIn(n);
    const w = dow(d);
    if (w >= 1 && w <= 5) {
      for (const c of [1, 2]) hold(d, c, '07:00', '08:30', 'member', 'Early doubles');
      hold(d, 9, '12:00', '13:00', 'lesson', 'Private lesson');
    }
    if (w === 1 || w === 3) for (const c of [3, 4, 5]) hold(d, c, '09:00', '10:30', 'lesson', 'Adult clinic');
    if (w === 2 || w === 4) for (const c of [6, 7, 8]) hold(d, c, '15:30', '17:00', 'camp', 'After-school juniors');
    if (w === 6) for (const c of [1, 2, 3, 4]) hold(d, c, '08:00', '10:00', 'member', 'Saturday men’s doubles');
    if (w === 0) for (const c of [5, 6]) hold(d, c, '09:00', '11:00', 'event', 'Sunday mixer');
  }
  const nextDow = (want) => {
    for (let n = 1; n < 8; n += 1) if (dow(ymdIn(n)) === want) return ymdIn(n);
    return null;
  };
  const OPEN_PLAY = [
    { ymd: nextDow(6), court: 7, start: '10:00', end: '11:30', title: 'Saturday doubles', pitch: 'Doubles Sat 10am, need 2 more (3.5–4.0)', players: ['Chris Delaney', 'Rachel Tso'] },
  ];
  for (const o of OPEN_PLAY) hold(o.ymd, o.court, o.start, o.end, 'member', o.title, { signups: true, capacity: 4, pitch: o.pitch });
  const reservations = await must(db.from('reservations').insert(resRows).select('id, signups_open, signups_pitch'), 'reservations');
  for (const o of OPEN_PLAY) {
    const r = reservations.find((x) => x.signups_open && x.signups_pitch === o.pitch);
    if (!r) continue;
    await must(
      db.from('reservation_signups').insert(
        o.players.map((name) => ({
          reservation_id: r.id,
          vault_player_id: vaultByName.get(name).id,
          guest_name: name,
          guest_email: vaultByName.get(name).email,
          status: 'confirmed',
        })),
      ),
      'signups',
    );
  }
  console.log(`· Court sheet: ${reservations.length} reservations, 1 open-play posting`);

  // ---------------------------------------------------------- CourtConnect
  const games = [
    { starts_at: clubTime(ymdIn(1), '18:00'), format: 'doubles', spots_needed: 1, rating_min: 3.5, rating_max: 4.0, include_unrated: false, note: 'After-work doubles under the lights. I have balls.' },
    { starts_at: clubTime(ymdIn(3), '08:00'), format: 'singles', spots_needed: 1, rating_min: null, rating_max: null, include_unrated: true, note: 'Morning singles, happy to just rally too.' },
  ];
  await must(
    db.from('pf_games').insert(games.map((g) => ({ ...g, club_id: clubId, posted_by: ids.member2, duration_min: 90, status: 'open' }))),
    'CourtConnect games',
  );
  console.log(`· CourtConnect: ${games.length} open games posted by ${ACCOUNTS.member2.name}`);

  console.log(`\nDone. demo_mode is ${club.demo_mode ? 'ON' : 'off'} (left as is).`);
  if (Object.keys(passwords).length) {
    console.log('\nPasswords (shown once):');
    for (const [k, p] of Object.entries(passwords)) console.log(`  ${ACCOUNTS[k].email}  ${p}`);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

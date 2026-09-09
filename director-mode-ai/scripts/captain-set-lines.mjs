/**
 * Set a CaptainMode team's lines per match, and carry it onto the schedule.
 *
 *   node scripts/captain-set-lines.mjs --find "megan"
 *   node scripts/captain-set-lines.mjs --team <teamId> --singles 0 --doubles 4
 *   node scripts/captain-set-lines.mjs --team <teamId> --singles 0 --doubles 4 --apply
 *
 * Why this exists: a match keeps its OWN copy of the singles/doubles counts,
 * stamped from the team default when it was created, and the lineup generator
 * reads only that copy. Teams created before the setup form asked for the
 * lines were stamped with their league's default — 2 singles + 3 doubles for
 * USTA Adult — so a doubles-only team kept generating singles lines it does
 * not play. Fixing the team default alone does NOT fix matches already on the
 * schedule; this does both.
 *
 * DRY RUN BY DEFAULT. It prints exactly what it would change and writes
 * nothing until you pass --apply.
 *
 * Two kinds of match are never touched, matching the app's own rule in
 * src/lib/captain/courtBackfill.ts — keep the two in step if either changes:
 *   - matches in the past, which are history
 *   - matches with a saved lineup, whose courts may already be out to players
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

let envFile;
try {
  envFile = readFileSync('.env.local', 'utf8');
} catch {
  console.error('Could not read .env.local — run this from the director-mode-ai/ directory.');
  process.exit(1);
}
const env = Object.fromEntries(
  envFile
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [
      l.slice(0, l.indexOf('=')).trim(),
      l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, ''),
    ]),
);
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('.env.local needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const LEAGUE_DEFAULTS = {
  usta_adult: [2, 3],
  usta_combo: [0, 3],
  usta_mixed: [0, 3],
  usta_trilevel: [0, 3],
  jtt: [4, 4],
  flex: [2, 3],
};

/** Locate a team when you have a name or a captain's email rather than an id. */
async function find(needle) {
  const q = needle.toLowerCase();
  const { data: byName } = await db
    .from('captain_teams')
    .select('id, name, league_type, level, captain_user_id, default_singles_courts, default_doubles_courts')
    .ilike('name', `%${needle}%`);

  // The captain is an auth user, and listUsers is the only lookup the admin
  // API offers — so page it and match on email.
  const captainIds = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    for (const u of data.users) {
      if ((u.email || '').toLowerCase().includes(q)) captainIds.push(u.id);
    }
    if (data.users.length < 200) break;
  }
  let byCaptain = [];
  if (captainIds.length) {
    const { data } = await db
      .from('captain_teams')
      .select('id, name, league_type, level, captain_user_id, default_singles_courts, default_doubles_courts')
      .in('captain_user_id', captainIds);
    byCaptain = data || [];
  }

  const seen = new Set();
  const all = [...(byName || []), ...byCaptain].filter((t) => !seen.has(t.id) && seen.add(t.id));
  if (!all.length) {
    console.log(`No team matched "${needle}" by name or captain email.`);
    return;
  }
  console.log(`${all.length} team(s) matching "${needle}":\n`);
  for (const t of all) {
    const [ds, dd] = LEAGUE_DEFAULTS[t.league_type] || LEAGUE_DEFAULTS.flex;
    const s = t.default_singles_courts ?? ds;
    const d = t.default_doubles_courts ?? dd;
    console.log(`  ${t.id}`);
    console.log(`    ${t.name}${t.level ? ` (${t.level})` : ''} — ${t.league_type}`);
    console.log(`    lines: ${s} singles + ${d} doubles`);
  }
  console.log('\nRe-run with:  --team <id> --singles <n> --doubles <n>   (add --apply to write)');
}

async function setLines(teamId, singles, doubles, apply) {
  const { data: team } = await db
    .from('captain_teams')
    .select('id, name, level, league_type, default_singles_courts, default_doubles_courts')
    .eq('id', teamId)
    .maybeSingle();
  if (!team) {
    console.error('No such team:', teamId);
    process.exit(1);
  }

  const [ds, dd] = LEAGUE_DEFAULTS[team.league_type] || LEAGUE_DEFAULTS.flex;
  console.log(`Team:  ${team.name}${team.level ? ` (${team.level})` : ''} — ${team.league_type}`);
  console.log(`  now:  ${team.default_singles_courts ?? ds} singles + ${team.default_doubles_courts ?? dd} doubles`);
  console.log(`  to:   ${singles} singles + ${doubles} doubles\n`);

  const { data: upcoming } = await db
    .from('captain_matches')
    .select('id, match_at, opponent, singles_courts, doubles_courts')
    .eq('team_id', teamId)
    .gte('match_at', new Date().toISOString())
    .order('match_at');

  const rows = upcoming || [];
  const withLineups = rows.length
    ? await db.from('captain_lineups').select('match_id').in('match_id', rows.map((m) => m.id))
    : { data: [] };
  const locked = new Set((withLineups.data || []).map((r) => r.match_id));

  const stale = rows.filter(
    (m) => !locked.has(m.id) && (m.singles_courts !== singles || m.doubles_courts !== doubles),
  );
  const skipped = rows.filter((m) => locked.has(m.id));

  console.log(`Upcoming matches: ${rows.length}`);
  for (const m of stale) {
    const when = new Date(m.match_at).toISOString().slice(0, 10);
    console.log(`  change  ${when}  vs ${m.opponent || '—'}  ${m.singles_courts}+${m.doubles_courts} -> ${singles}+${doubles}`);
  }
  for (const m of skipped) {
    const when = new Date(m.match_at).toISOString().slice(0, 10);
    console.log(`  SKIP    ${when}  vs ${m.opponent || '—'}  (lineup already saved — change it on the match)`);
  }
  if (!stale.length) console.log('  (nothing to restamp)');

  if (!apply) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to make these changes.');
    return;
  }

  const { error: teamErr } = await db
    .from('captain_teams')
    .update({
      default_singles_courts: singles,
      default_doubles_courts: doubles,
      updated_at: new Date().toISOString(),
    })
    .eq('id', teamId);
  if (teamErr) throw teamErr;

  if (stale.length) {
    const { error: mErr } = await db
      .from('captain_matches')
      .update({ singles_courts: singles, doubles_courts: doubles })
      .in('id', stale.map((m) => m.id));
    if (mErr) throw mErr;
  }

  console.log(`\nDone. Team default set, ${stale.length} scheduled match(es) restamped.`);
  if (skipped.length) {
    console.log(`${skipped.length} match(es) with a saved lineup were left alone.`);
  }
  console.log('Regenerate any lineup already produced in the old shape.');
}

const findArg = flag('find');
const teamArg = flag('team');
if (findArg) {
  await find(findArg);
} else if (teamArg) {
  const singles = Number(flag('singles'));
  const doubles = Number(flag('doubles'));
  const ok = (n) => Number.isInteger(n) && n >= 0 && n <= 8;
  if (!ok(singles) || !ok(doubles)) {
    console.error('--singles and --doubles must each be a whole number between 0 and 8.');
    process.exit(1);
  }
  if (singles + doubles === 0) {
    console.error('A match needs at least one line.');
    process.exit(1);
  }
  await setLines(teamArg, singles, doubles, has('apply'));
} else {
  console.error('usage: node scripts/captain-set-lines.mjs --find "<name or email>"');
  console.error('       node scripts/captain-set-lines.mjs --team <id> --singles <n> --doubles <n> [--apply]');
  process.exit(1);
}

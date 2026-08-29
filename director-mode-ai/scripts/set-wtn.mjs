/**
 * Set a player's World Tennis Number by name, and make it follow them.
 *
 *   node scripts/set-wtn.mjs "Robyn Rogin" --singles 28.5 --doubles 27.1
 *   node scripts/set-wtn.mjs "Nikki Mains" --doubles 31.2
 *   node scripts/set-wtn.mjs --list            # who still has no number
 *
 * Same order the app uses: master_players is the source of truth, then the
 * club-scoped mirrors a browser is actually allowed to read. A player with no
 * identity-hub row yet gets one created and linked first — otherwise the number
 * would live on a single league roster and vanish the moment she turned up
 * anywhere else in ClubMode.
 *
 * WTN runs 1 (pro) to 40 (beginner): LOWER is stronger, the opposite way to
 * NTRP. The band is checked here as well as by the database, because a 3.5
 * typed in by mistake would rank that player near-professional and quietly
 * invert a whole lineup.
 */
import pg from 'pg';
import { readFileSync } from 'fs';

const TEAM_ID = process.env.CAPTAIN_TEAM_ID || '517c278c-3878-49be-83fd-a8faa2ab99d0';
const MIN_WTN = 1;
const MAX_WTN = 40;

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

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : null;
}

function num(v, label) {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${label} "${v}" is not a number.`);
  if (n < MIN_WTN || n > MAX_WTN) {
    throw new Error(
      `${label} ${n} is outside the WTN band ${MIN_WTN}-${MAX_WTN}. ` +
        `Remember WTN is not NTRP — lower is stronger.`,
    );
  }
  return n;
}

await client.connect();

try {
  if (process.argv.includes('--list')) {
    const { rows } = await client.query(
      `select name, wtn, wtn_doubles
         from captain_players
        where team_id = $1 and active
        order by (wtn is null and wtn_doubles is null) desc, name`,
      [TEAM_ID],
    );
    const missing = rows.filter((r) => r.wtn == null && r.wtn_doubles == null);
    const have = rows.filter((r) => r.wtn != null || r.wtn_doubles != null);
    console.log(`\n${have.length} of ${rows.length} have a WTN.\n`);
    if (have.length) {
      console.log('HAVE ONE');
      for (const r of have) {
        console.log(`  ${r.name.padEnd(22)} S ${r.wtn ?? '—'}  D ${r.wtn_doubles ?? '—'}`);
      }
      console.log('');
    }
    console.log('STILL NEEDED');
    for (const r of missing) console.log(`  ${r.name}`);
    console.log('');
    process.exit(0);
  }

  const name = process.argv[2];
  if (!name || name.startsWith('--')) {
    console.error('Usage: node scripts/set-wtn.mjs "Full Name" [--singles N] [--doubles N]');
    process.exit(1);
  }

  const singles = num(arg('--singles'), 'Singles WTN');
  const doubles = num(arg('--doubles'), 'Doubles WTN');
  if (singles == null && doubles == null) {
    console.error('Give at least one of --singles or --doubles.');
    process.exit(1);
  }

  const { rows: found } = await client.query(
    `select id, name, email, phone, master_player_id
       from captain_players
      where team_id = $1 and active and lower(name) = lower($2)`,
    [TEAM_ID, name],
  );

  if (found.length === 0) {
    const { rows: near } = await client.query(
      `select name from captain_players where team_id = $1 and active and name ilike $2`,
      [TEAM_ID, `%${name.split(' ')[0]}%`],
    );
    console.error(`No active player called "${name}" on this team.`);
    if (near.length) console.error(`Did you mean: ${near.map((r) => r.name).join(', ')}?`);
    process.exit(1);
  }
  if (found.length > 1) {
    // Never guess which of two same-named players gets a rating.
    console.error(`"${name}" matches ${found.length} players. Resolve by hand.`);
    process.exit(1);
  }

  const player = found[0];
  let mpid = player.master_player_id;

  // No identity row yet — create the person, exactly as the nightly sync would.
  if (!mpid) {
    const { rows: existing } = await client.query(
      `select id from master_players where email_normalized = lower(trim($1))`,
      [player.email],
    );
    if (existing.length) {
      mpid = existing[0].id;
    } else {
      // email_normalized is generated — never insert into it.
      const { rows: created } = await client.query(
        `insert into master_players (email, phone, full_name, created_at, updated_at)
         values ($1, $2, $3, now(), now()) returning id`,
        [player.email, player.phone, player.name],
      );
      mpid = created[0].id;
      console.log(`  created identity-hub record for ${player.name}`);
    }
    await client.query(
      `update captain_players set master_player_id = $1, updated_at = now() where id = $2`,
      [mpid, player.id],
    );
  }

  // Only overwrite a number that was actually supplied, so a singles-only
  // update never wipes an existing doubles WTN.
  const sets = ['wtn_source = $2', 'wtn_updated_at = now()', 'updated_at = now()'];
  const params = [mpid, 'manual'];
  if (singles != null) { params.push(singles); sets.push(`wtn = $${params.length}`); }
  if (doubles != null) { params.push(doubles); sets.push(`wtn_doubles = $${params.length}`); }

  await client.query(`update master_players set ${sets.join(', ')} where id = $1`, params);

  // Push out to every club-scoped mirror linked to this person.
  const mirrorSets = ['updated_at = now()'];
  const mirrorParams = [mpid];
  if (singles != null) { mirrorParams.push(singles); mirrorSets.push(`wtn = $${mirrorParams.length}`); }
  if (doubles != null) { mirrorParams.push(doubles); mirrorSets.push(`wtn_doubles = $${mirrorParams.length}`); }

  const mirrors = ['captain_players', 'cc_vault_players'];
  const reached = {};
  for (const table of mirrors) {
    const { rowCount } = await client.query(
      `update ${table} set ${mirrorSets.join(', ')} where master_player_id = $1`,
      mirrorParams,
    );
    reached[table] = rowCount;
  }
  // `players` (MixerMode) has no updated_at trigger column in the same shape.
  const playersSets = [];
  const playersParams = [mpid];
  if (singles != null) { playersParams.push(singles); playersSets.push(`wtn = $${playersParams.length}`); }
  if (doubles != null) { playersParams.push(doubles); playersSets.push(`wtn_doubles = $${playersParams.length}`); }
  const { rowCount: mixerRows } = await client.query(
    `update players set ${playersSets.join(', ')} where master_player_id = $1`,
    playersParams,
  );
  reached.players = mixerRows;

  console.log(
    `\n${player.name}: ${singles != null ? `S ${singles}` : 'S —'}  ${doubles != null ? `D ${doubles}` : 'D —'}`,
  );
  console.log(
    `  hub + ${Object.entries(reached).map(([t, n]) => `${t} (${n})`).join(', ')}\n`,
  );

  const { rows: left } = await client.query(
    `select count(*) filter (where wtn is null and wtn_doubles is null) as missing, count(*) as total
       from captain_players where team_id = $1 and active`,
    [TEAM_ID],
  );
  console.log(`  ${left[0].total - left[0].missing} of ${left[0].total} on the roster have one.\n`);
} catch (e) {
  console.error('ERROR:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}

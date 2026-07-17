import pg from 'pg';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')])
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
await client.connect();

const EVENT = 'b8b3fefc-41cb-4575-aa46-2e015003ac42';

try {
  const { rows: players } = await client.query(
    `select ep.player_id, pl.name, ep.strength_order, et.name as team
     from event_players ep
     join players pl on pl.id = ep.player_id
     left join event_teams et on et.id = ep.team_id
     where ep.event_id = $1 and ep.active = true`,
    [EVENT]
  );
  const byStrength = (a, b) => a.strength_order - b.strength_order || a.name.localeCompare(b.name);
  const alc = players.filter((p) => p.team === 'Alcaraz').sort(byStrength);
  const sin = players.filter((p) => p.team === 'Sinner').sort(byStrength);
  console.log(`Alcaraz ${alc.length}, Sinner ${sin.length}`);

  // Ed byed R1; Liz & Allison were added after R1. All three must play R2.
  const byed = new Set(['Ed Moldavsky']);
  const mustPlay = new Set(['Ed Moldavsky', 'Liz Lawrence']); // Alcaraz side (Allison is Sinner, always plays)

  // Bench 1 Alcaraz per round: never someone who must play, never a repeat bye.
  const pickBench = (team) => {
    const elig = team.filter((p) => !byed.has(p.name) && !mustPlay.has(p.name));
    return elig[elig.length - 1]; // weakest eligible; reported so it can be swapped
  };

  // 8 doubles, strength-aligned: pair each team's top-half with its bottom-half
  // ('half') or strongest-with-weakest ('snake'); match pair i vs pair i so both
  // teams field comparable strength on each court.
  const makeMatches = (alcPlay, sinPlay, scheme) => {
    const pairs = (arr) => {
      const out = [];
      for (let i = 0; i < 8; i++) {
        out.push(scheme === 'half' ? [arr[i], arr[i + 8]] : [arr[i], arr[15 - i]]);
      }
      return out;
    };
    const pa = pairs(alcPlay), ps = pairs(sinPlay);
    return pa.map((ap, i) => ({ court: i + 1, p1: ap[0], p3: ap[1], p2: ps[i][0], p4: ps[i][1] }));
  };

  const genRound = async (roundNumber, bench, scheme) => {
    const alcPlay = alc.filter((p) => p.name !== bench.name);
    const sinPlay = [...sin];
    const matches = makeMatches(alcPlay, sinPlay, scheme);
    const { rows: [r] } = await client.query(
      `insert into rounds(event_id, round_number, status) values($1, $2, 'upcoming') returning id`,
      [EVENT, roundNumber]
    );
    for (const m of matches) {
      await client.query(
        `insert into matches(id, round_id, court_number, player1_id, player2_id, player3_id, player4_id, team1_score, team2_score, winner_team)
         values(gen_random_uuid(), $1, $2, $3, $4, $5, $6, 0, 0, null)`,
        [r.id, m.court, m.p1.player_id, m.p2.player_id, m.p3.player_id, m.p4.player_id]
      );
    }
    const playing = new Set([...alcPlay, ...sinPlay].map((p) => p.name));
    return { matches, playing, bench };
  };

  const benchR2 = pickBench(alc); byed.add(benchR2.name);
  const r2 = await genRound(2, benchR2, 'half');
  const benchR3 = pickBench(alc); byed.add(benchR3.name);
  const r3 = await genRound(3, benchR3, 'snake');

  for (const [label, r] of [['ROUND 2', r2], ['ROUND 3', r3]]) {
    console.log(`\n=== ${label} — Alcaraz bench (BYE): ${r.bench.name} ===`);
    r.matches.forEach((m) =>
      console.log(`  Court ${m.court}: ${m.p1.name} / ${m.p3.name}  vs  ${m.p2.name} / ${m.p4.name}`)
    );
  }
  console.log('\n--- guarantee check (Round 2) ---');
  for (const n of ['Ed Moldavsky', 'Liz Lawrence', 'Allison Eddy'])
    console.log(`  ${n}: ${r2.playing.has(n) ? 'PLAYING ✓' : 'BYE ✗'}`);
} catch (e) {
  console.error('ERROR:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}

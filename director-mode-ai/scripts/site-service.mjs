/**
 * Put a club on (or take it off) the $75/mo site-service tier.
 *
 * The tier is sold by conversation and has no LemonSqueezy product, so this is
 * the only thing that marks it. Being on it makes CaptainMode free for every
 * captain at the club (src/lib/captain/access.ts).
 *
 *   node scripts/site-service.mjs --list
 *   node scripts/site-service.mjs "Lafayette Tennis Club" --on
 *   node scripts/site-service.mjs "Lafayette Tennis Club" --off
 */
import pg from 'pg';
import { readFileSync } from 'fs';

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]));
const u = new URL(env.DATABASE_URL);
const db = new pg.Client({ host: u.hostname, port: u.port || 5432, user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1) || 'postgres', ssl: { rejectUnauthorized: false } });
await db.connect();

const args = process.argv.slice(2);
try {
  if (args.includes('--list') || !args.length) {
    const { rows } = await db.query(`select name, site_service_since from cc_clubs where site_service_since is not null order by name`);
    console.log(rows.length ? rows.map((r) => `${r.name} — since ${r.site_service_since.toISOString().slice(0, 10)}`).join('\n') : 'No clubs on the site-service tier.');
  } else {
    const name = args.find((a) => !a.startsWith('--'));
    const on = args.includes('--on');
    if (!on && !args.includes('--off')) throw new Error('Pass --on or --off.');
    const { rows } = await db.query(`select id, name, site_service_since from cc_clubs where name ilike $1`, [`%${name}%`]);
    if (rows.length !== 1) throw new Error(rows.length ? `"${name}" matches ${rows.length} clubs: ${rows.map((r) => r.name).join(', ')}` : `No club matches "${name}".`);
    const club = rows[0];
    await db.query(`update cc_clubs set site_service_since = ${on ? 'coalesce(site_service_since, now())' : 'null'} where id = $1`, [club.id]);
    console.log(`${club.name}: site-service ${on ? 'ON — CaptainMode included for its captains' : 'OFF'}`);
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
await db.end();

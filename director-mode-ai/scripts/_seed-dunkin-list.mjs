// One-off (9/29/26): seed the Dunkin' player list from (1) every Dunkin' quad
// entry, (2) the Sep 19-20 RSPA entrant contact report, (3) the 68 families the
// Sep 3-4 promo reached (recovered from Resend). Idempotent — upsert_promo_contact.
import pg from 'pg';
import { readFileSync } from 'fs';
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim().replace(/^["']|["']$/g,'')]));
const u = new URL(env.DATABASE_URL);
const db = new pg.Client({ host:u.hostname, port:u.port||5432, user:decodeURIComponent(u.username), password:decodeURIComponent(u.password), database:u.pathname.slice(1)||'postgres', ssl:{rejectUnauthorized:false} });
await db.connect();
const q = async (s, a=[]) => (await db.query(s, a)).rows;
const [{ user_id: owner }] = await q(`select user_id from events where slug='dunkin-quads-oct-3'`);
const LIST = 'sponsor:dunkin';
const SKIP = new Set(['darrinjco@gmail.com', 'darrin@sleepyhollowclub.com']);
const add = (email, parent, player, source, div) => {
  if (!email || SKIP.has(email.trim().toLowerCase())) return null;
  return q(`select upsert_promo_contact($1,$2,$3,$4,$5,$6,$7)`, [owner, LIST, email, parent, player, source, div]);
};
let n = { quad: 0, rspa: 0, promo: 0 };

// 1. Every real Dunkin' quad entry (the rehearsal's fake players have no email).
for (const r of await q(`select e.slug, x.* from quad_entries x join events e on e.id = x.event_id
                          where e.sponsor_id = 'dunkin' and e.slug <> 'dunkin-quads-rehearsal'`)) {
  if (await add(r.parent_email || r.player_email, r.parent_name, r.player_name, `quad:${r.slug}`, r.division)) n.quad++;
}

// 2. RSPA Jr Circuit #2 (TopDog 1715) contact report.
const tsv = readFileSync('C:/Users/darri/court-booker/_rspa/rspa-1715-contacts-2026-09.tsv', 'utf8').split('\n').filter((l) => l && !l.startsWith('#') && !l.startsWith('Division'));
for (const line of tsv) {
  const [division, entrant, , , email] = line.split('\t');
  const [last, first] = entrant.split(',');
  const player = `${(first || '').replace(/\s+[A-Z]$/, '').trim()} ${last.trim()}`.trim();
  const div = (division.match(/(\d+)/) || [])[1];
  if (await add(email, null, player, 'rspa:1715', div ? `${div}u` : null)) n.rspa++;
}

// 3. The Sep 3-4 promo recipients, named from wherever we know them.
const promo = JSON.parse(readFileSync('scripts/_dunkin-promo-emails.json', 'utf8'));
for (const email of promo) {
  const [who] = await q(
    `select parent_name, player_name from (
        select parent_name, player_name, 1 o from tournament_entries where lower(parent_email) = $1 or lower(player_email) = $1
        union all
        select parent_name, player_name, 2 from league_team_rosters where lower(parent_email) = $1 or lower(player_email) = $1
     ) t order by o limit 1`, [email]);
  if (await add(email, who?.parent_name ?? null, who?.player_name ?? null, 'promo:2026-09-03', null)) n.promo++;
}
const [tot] = await q(`select count(*)::int families, count(*) filter (where cardinality(sources) > 1)::int multi,
                        count(*) filter (where e.email is not null)::int unsubscribed
                        from promo_contacts c left join email_unsubscribes e on lower(e.email) = c.email
                        where owner_id = $1 and list_key = $2`, [owner, LIST]);
console.log('rows processed', n, '→', tot);
await db.end();

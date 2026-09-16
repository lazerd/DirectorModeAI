/**
 * Stage (and tear down) a deck of FAKE clubs, for testing the swipe path.
 *
 *   node scripts/outreach-fake-deck.mjs seed
 *   node scripts/outreach-fake-deck.mjs clean
 *
 * Every row it creates is slugged `zz-fake-outreach-*` and every address is
 * undeliverable by construction. The swipe path has to be exercised against
 * something, and it must never be a real club from the Directors Club list.
 * `clean` deletes exactly what `seed` made and nothing else.
 *
 * TWO KINDS OF FAKE ADDRESS, and the difference matters:
 *
 *   @example.com  is held by the demo email guard before it reaches Resend
 *                 (`example_recipient`, lib/demo/emailGuard.ts). Useful for
 *                 proving the hold is surfaced as a refusal — useless for
 *                 exercising the rest of the send path, which never runs.
 *   .invalid      is the RFC 2606 reserved TLD: no DNS, no mailbox, nothing
 *                 to deliver to ever. The guard does not claim it, so the
 *                 whole path runs. Card 1 uses this.
 */
import pg from 'pg';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
);
const u = new URL(env.DATABASE_URL);
const db = new pg.Client({
  host: u.hostname,
  port: u.port || 5432,
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.slice(1) || 'postgres',
  ssl: { rejectUnauthorized: false },
});

const PREFIX = 'zz-fake-outreach';
const REP = 'darrinjco@gmail.com';

const CLUBS = [
  { name: 'Zed Valley Racquet Club', region: 'West', who: 'Dana Fake', email: 'dana@zedvalley.invalid' },
  { name: 'Zed Harbor Tennis Center', region: 'Central', who: 'Rene Fake', email: 'rene@zedharbor.invalid' },
  { name: 'Zed Ridge Country Club', region: 'East', who: 'Kim Fake', email: 'kim@example.com' },
];

const BODY = (club, first) =>
  `Hi ${first},\n\n` +
  `I run the tennis program at a club in California. We were paying for software that did about a third of what we needed, so I built our own, and it turned into a product.\n\n` +
  `It is the club's own site, court booking, members finding each other a fourth, and a QR code at the gate for check-in. Two clubs at Rossmoor and Lafayette Tennis Club are on it now.\n\n` +
  `I would rather build ${club} one and send you the link than describe mine.\n\n` +
  `Worth 15 minutes?`;

async function seed() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
  for (const [i, c] of CLUBS.entries()) {
    const slug = `${PREFIX}-${i + 1}`;
    const org = await db.query(
      `INSERT INTO crm_orgs (name, slug, stage, source, region, notes)
       VALUES ($1, $2, 'researching', 'FAKE — outreach deck test', $3, 'Fake row for testing the swipe deck. Safe to delete.')
       ON CONFLICT (slug) DO UPDATE SET stage='researching', region=EXCLUDED.region
       RETURNING id`,
      [c.name, slug, c.region],
    );
    const orgId = org.rows[0].id;
    const contact = await db.query(
      `INSERT INTO crm_contacts (org_id, full_name, email, is_primary, role)
       VALUES ($1, $2, $3, true, 'FAKE')
       ON CONFLICT (org_id, lower(btrim(full_name))) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
      [orgId, c.who, c.email],
    );
    const first = c.who.split(' ')[0];
    await db.query(
      `INSERT INTO crm_outreach_queue
         (org_id, contact_id, rep_email, send_date, subject, body, why, status, kind, generated_by, dedupe_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'planned', 'intro', 'model', $8)
       ON CONFLICT (dedupe_key) DO UPDATE
         SET status='planned', send_date=EXCLUDED.send_date, approved_at=NULL, reject_reason=NULL`,
      [
        orgId,
        contact.rows[0].id,
        REP,
        today,
        `A question about ${c.name}`,
        BODY(c.name, first),
        `${c.region} region, one contact, nobody has ever been written to.`,
        `${orgId}:intro`,
      ],
    );
    console.log(`seeded ${c.name} → ${c.email}`);
  }
}

async function clean() {
  const { rows } = await db.query(`SELECT id, name FROM crm_orgs WHERE slug LIKE $1`, [`${PREFIX}-%`]);
  for (const r of rows) {
    await db.query(`DELETE FROM crm_outreach_suppression WHERE org_id = $1`, [r.id]);
    await db.query(`DELETE FROM crm_outreach_queue WHERE org_id = $1`, [r.id]);
    await db.query(`DELETE FROM crm_email_sends WHERE org_id = $1`, [r.id]);
    await db.query(`DELETE FROM crm_activities WHERE org_id = $1`, [r.id]);
    await db.query(`DELETE FROM crm_contacts WHERE org_id = $1`, [r.id]);
    await db.query(`DELETE FROM crm_orgs WHERE id = $1`, [r.id]);
    console.log(`removed ${r.name}`);
  }
  console.log(`${rows.length} fake clubs gone.`);
}

await db.connect();
try {
  if (process.argv[2] === 'clean') await clean();
  else await seed();
} finally {
  await db.end();
}

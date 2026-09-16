/**
 * crm-user.mjs — who may open the sales CRM.
 *
 *   node scripts/crm-user.mjs --email kevin@example.com --name "Kevin Carey"
 *   node scripts/crm-user.mjs --email kevin@example.com --remove
 *   node scripts/crm-user.mjs --list
 *
 * Optional: --initials KC   two or three characters for a pipeline card.
 *
 * ADDING KEVIN IS THIS ONE COMMAND. His email is not known yet, and nothing in
 * the app or the seed guesses it — the whole point of an email-keyed allowlist
 * is that the row can exist before the account does. He signs up at
 * clubmode.ai with that address and the CRM is simply there; requireCrm()
 * fills in his user_id on first sign-in.
 *
 * --remove deactivates rather than deletes, so the name on old activity rows
 * still resolves and re-adding someone is the same command again. A platform
 * owner (PLATFORM_OWNER_EMAILS) keeps access regardless, which is what stops a
 * mistyped --remove from locking everyone out of their own pipeline.
 *
 * Service role: this table is not writable from a session, by design.
 */

import pg from 'pg';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
}
const has = (name) => process.argv.includes(`--${name}`);

const email = (arg('email') || '').trim().toLowerCase();
const name = arg('name');
const initials = arg('initials');

if (!has('list') && !email) {
  console.error('Usage: node scripts/crm-user.mjs --email <addr> [--name "Kevin Carey"] [--initials KC] [--remove]');
  console.error('       node scripts/crm-user.mjs --list');
  process.exit(1);
}
if (email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) {
  console.error(`Not an email address: ${email}`);
  process.exit(1);
}

/** "Kevin Carey" → "KC". Only used when --initials is not given. */
function derive(fullName) {
  if (!fullName) return null;
  const w = fullName.trim().split(/\s+/).filter(Boolean);
  if (w.length >= 2) return (w[0][0] + w[w.length - 1][0]).toUpperCase();
  return w[0] ? w[0].slice(0, 2).toUpperCase() : null;
}

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

try {
  if (has('list')) {
    const { rows } = await client.query(
      'SELECT email, full_name, initials, active, user_id IS NOT NULL AS linked, created_at FROM crm_users ORDER BY created_at',
    );
    console.table(rows);
  } else if (has('remove')) {
    const { rowCount } = await client.query(
      'UPDATE crm_users SET active = false WHERE email = $1',
      [email],
    );
    console.log(rowCount ? `Deactivated ${email}.` : `${email} was not on the list.`);
  } else {
    /*
     * Link an account that already exists, by email. Harmless when there is
     * none — the row works on the email alone until they sign in, and
     * requireCrm() links it then.
     */
    const { rows: found } = await client.query(
      'SELECT id FROM auth.users WHERE lower(email) = $1 LIMIT 1',
      [email],
    );
    const userId = found[0]?.id ?? null;

    await client.query(
      `INSERT INTO crm_users (email, user_id, full_name, initials, active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (email) DO UPDATE SET
         user_id   = COALESCE(EXCLUDED.user_id, crm_users.user_id),
         full_name = COALESCE(EXCLUDED.full_name, crm_users.full_name),
         initials  = COALESCE(EXCLUDED.initials,  crm_users.initials),
         active    = true`,
      [email, userId, name, initials || derive(name)],
    );
    console.log(
      `${email} can open /crm.` +
        (userId ? ' Linked to their existing account.' : ' No account yet — it links itself when they sign in.'),
    );
  }
} catch (e) {
  console.error('FAILED:', e.message);
  process.exitCode = 1;
}

await client.end();

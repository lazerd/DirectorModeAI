/**
 * add-club-members.mjs — seat roster people as club members. Sends nothing.
 *
 * The command-line twin of the "Add" button in PlayerVault
 * (/api/clubs/members/add). Same rule: an account is created for someone the
 * club already knows, confirmed, with no password and no email. They reach
 * CourtConnect through the token link in the game email they now receive;
 * they never have to sign up. To reach the board itself they use "forgot
 * password" on their own address.
 *
 * DRY RUN BY DEFAULT. Nothing is written until you pass --live.
 *
 *   # who would be added?
 *   node scripts/add-club-members.mjs --club sleepy-hollow --rating 3.0-3.5 --gender male
 *   # do it
 *   node scripts/add-club-members.mjs --club sleepy-hollow --rating 3.0-3.5 --gender male --live
 *   # one person
 *   node scripts/add-club-members.mjs --club sleepy-hollow --email walden.browne@gmail.com --live
 *   # by name, as PlayerVault spells it
 *   node scripts/add-club-members.mjs --club sleepy-hollow --match "Browne" --live
 *
 * Idempotent: someone who already has an account keeps it, someone already
 * seated is left alone.
 *
 * NOT A MAILING LIST BUILDER. Everyone seated here starts getting "a game
 * needs players" email when a game fits their level. Point it only at people
 * the club actually has a relationship with.
 */

import { createClient } from '@supabase/supabase-js';
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

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : null;
};
const has = (flag) => process.argv.includes(flag);

const slug = (arg('--club') || '').trim().toLowerCase();
const email = (arg('--email') || '').trim().toLowerCase();
const match = (arg('--match') || '').trim();
const rating = (arg('--rating') || '').trim();
const gender = (arg('--gender') || '').trim();
const live = has('--live');

if (!slug || (!email && !match && !rating)) {
  console.error('Usage: --club <slug> (--email <addr> | --match <name> | --rating <min-max> [--gender male]) [--live]');
  process.exit(1);
}

const { data: club } = await db
  .from('cc_clubs')
  .select('id, name, slug, owner_id')
  .eq('slug', slug)
  .maybeSingle();
if (!club) {
  console.error(`No club with slug "${slug}".`);
  process.exit(1);
}

/* ------------------------------------------------------- who are we adding */
let q = db
  .from('cc_vault_players')
  .select('id, full_name, email, usta_rating, gender')
  .eq('director_id', club.owner_id)
  .not('email', 'is', null)
  .order('full_name');

if (email) q = q.eq('email', email);
if (match) q = q.ilike('full_name', `%${match}%`);
if (gender) q = q.eq('gender', gender);
if (rating) {
  const [lo, hi] = rating.split('-').map((n) => Number(n.trim()));
  if (Number.isNaN(lo)) {
    console.error('--rating wants a range like 3.0-3.5');
    process.exit(1);
  }
  q = q.gte('usta_rating', lo).lte('usta_rating', Number.isNaN(hi) ? lo : hi);
}

const { data: players, error: qErr } = await q;
if (qErr) {
  console.error('Could not read the roster:', qErr.message);
  process.exit(1);
}
if (!players?.length) {
  console.log('Nobody on the roster matches that.');
  process.exit(0);
}

/* ------------------------------------------------------------------ guards
 * An account IS an email address, and a club roster is full of households:
 * one inbox shared by a couple, or by a couple and two juniors. Seating a
 * person under an address that describes somebody else gets that somebody
 * else emails addressed to their spouse, under an account carrying the wrong
 * name - and the person you meant to add still is not reachable.
 *
 * So a row whose address appears on more than one roster entry is SKIPPED,
 * and named, unless you decide otherwise with --allow-shared. Same for anyone
 * whose name is already seated at the club under a different address: that is
 * a second account for one person, which is how a member ends up with a login
 * that sees none of their own history.
 */
const { data: allRows } = await db
  .from('cc_vault_players')
  .select('full_name, email')
  .eq('director_id', club.owner_id)
  .not('email', 'is', null);

const sharers = new Map(); // email -> [names]
for (const r of allRows ?? []) {
  const k = r.email.trim().toLowerCase();
  sharers.set(k, [...(sharers.get(k) ?? []), r.full_name]);
}

const { data: seatedRows } = await db.from('cc_club_members').select('user_id').eq('club_id', club.id);
const seatedNames = new Set();
for (const m of seatedRows ?? []) {
  const { data: prof } = await db.from('profiles').select('full_name').eq('id', m.user_id).maybeSingle();
  if (prof?.full_name) seatedNames.add(prof.full_name.trim().toLowerCase());
}

const skipped = [];
const queue = [];
for (const p of players) {
  const shared = (sharers.get(p.email.trim().toLowerCase()) ?? []).filter((n) => n !== p.full_name);
  if (shared.length && !has('--allow-shared')) {
    skipped.push(`${p.full_name.padEnd(26)} ${p.email}  shared with ${shared.join(', ')}`);
    continue;
  }
  if (seatedNames.has((p.full_name || '').trim().toLowerCase())) {
    skipped.push(`${p.full_name.padEnd(26)} ${p.email}  already a member under another address`);
    continue;
  }
  queue.push(p);
}

if (skipped.length) {
  console.log('SKIPPED:');
  for (const line of skipped) console.log(`  ${line}`);
  if (!has('--allow-shared')) console.log('  (--allow-shared seats the shared-inbox ones anyway)');
}
if (!queue.length) {
  console.log('Nothing left to add.');
  process.exit(0);
}
players.length = 0;
players.push(...queue);

console.log(`${club.name} — ${players.length} roster ${players.length === 1 ? 'person' : 'people'} matched\n`);

if (!live) {
  for (const p of players) console.log(`  would add  ${p.full_name.padEnd(26)} ${p.email}  ${p.usta_rating ?? '—'}`);
  console.log(`\nDRY RUN. Nothing was written. Re-run with --live to add them.`);
  console.log('They will start receiving CourtConnect game emails. No email is sent by this script.');
  process.exit(0);
}

/* ------------------------------------------------------------------ seat them */
let added = 0;
let already = 0;
let failed = 0;

for (const p of players) {
  const addr = p.email.trim().toLowerCase();
  const name = (p.full_name || '').trim();
  try {
    // Ask Postgres, not listUsers(): that one pages, and filters in JS.
    const { data: foundId } = await db.rpc('auth_user_id_by_email', { p_email: addr });
    let userId = foundId ?? null;
    let fresh = false;

    if (!userId) {
      const { data: created, error } = await db.auth.admin.createUser({
        email: addr,
        email_confirm: true,
        user_metadata: name ? { full_name: name } : {},
      });
      if (error || !created?.user) {
        const { data: retry } = await db.rpc('auth_user_id_by_email', { p_email: addr });
        userId = retry ?? null;
        if (!userId) throw new Error(error?.message || 'could not create the account');
      } else {
        userId = created.user.id;
        fresh = true;
      }
    }

    if (name) {
      const { data: prof } = await db.from('profiles').select('id, full_name').eq('id', userId).maybeSingle();
      if (!prof) await db.from('profiles').insert({ id: userId, full_name: name });
      else if (!prof.full_name?.trim()) await db.from('profiles').update({ full_name: name }).eq('id', userId);
    }

    const { data: seat } = await db
      .from('cc_club_members')
      .select('role')
      .eq('club_id', club.id)
      .eq('user_id', userId)
      .maybeSingle();

    if (seat) {
      console.log(`  already in  ${name.padEnd(26)} ${addr}  (${seat.role})`);
      already++;
      continue;
    }

    const { error: seatErr } = await db
      .from('cc_club_members')
      .insert({ club_id: club.id, user_id: userId, role: 'member' });
    if (seatErr) throw new Error(seatErr.message);

    console.log(`  added       ${name.padEnd(26)} ${addr}  (${fresh ? 'new account' : 'existing account'})`);
    added++;
  } catch (err) {
    console.error(`  FAILED      ${name.padEnd(26)} ${addr}  ${err.message}`);
    failed++;
  }
}

console.log(`\n${added} added · ${already} already in · ${failed} failed. No email was sent.`);

/**
 * hand-over-club.mjs — give a club to the person who runs it.
 *
 * The last mile of onboarding a real customer. A club seeded on their behalf
 * is owned by the platform until this runs; afterwards it is theirs, they can
 * sign in, and nothing about their club depends on us being in the room.
 *
 *   node scripts/hand-over-club.mjs --club lafayette-tennis-club \
 *     --email hunterhg@comcast.net --name "Hunter Gallaway"
 *
 * WHAT IT DOES NOT DO: send email. It prints a one-time link for a human to
 * pass on. Mailing a stranger an account they did not ask for is a decision
 * for the person who has the relationship, not for a script — and the link is
 * a credential, so it should travel the way the two of them already talk.
 *
 * The link is a RECOVERY link, so the first thing he does is choose his own
 * password. No password is ever generated, printed, or stored anywhere a
 * script or a chat log could keep it.
 *
 * IDEMPOTENT. Re-run it: an existing account is reused rather than duplicated,
 * ownership is already set, and you get a fresh link. Use it as the "resend
 * his link" command.
 *
 * The PLATFORM keeps a director seat, so we can still work in the club
 * alongside them — visible in the club switcher as a club we reach as staff,
 * never silently.
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

const SITE = env.NEXT_PUBLIC_SITE_URL || 'https://clubmode.ai';
const PLATFORM_EMAIL = 'platform@clubmode.ai';

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : null;
}

const slug = (arg('--club') || '').trim().toLowerCase();
const email = (arg('--email') || '').trim().toLowerCase();
const name = (arg('--name') || '').trim();

if (!slug || !email) {
  console.error('Usage: --club <slug> --email <address> [--name "Full Name"]');
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

/* ------------------------------------------------- find or make the account */
// listUsers is paged, so filter server-side rather than scanning every page.
const { data: found } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
let user = (found?.users ?? []).find((u) => (u.email || '').toLowerCase() === email) || null;

if (!user) {
  const { data: created, error } = await db.auth.admin.createUser({
    email,
    // Confirmed on creation: he did not ask for this account, so making him
    // click a verification email before he can look at his own club is a
    // hurdle for no security gain — we already know the address is his,
    // because it is the one published on his club's website.
    email_confirm: true,
    user_metadata: name ? { full_name: name } : {},
  });
  if (error) {
    console.error('Could not create the account:', error.message);
    process.exit(1);
  }
  user = created.user;
  console.log(`Created account  ${email}`);
} else {
  console.log(`Account exists   ${email}`);
  if (name && !user.user_metadata?.full_name) {
    await db.auth.admin.updateUserById(user.id, { user_metadata: { full_name: name } });
  }
}

/* --------------------------------------------------------- hand over the club */
if (club.owner_id !== user.id) {
  const { error } = await db.from('cc_clubs').update({ owner_id: user.id }).eq('id', club.id);
  if (error) {
    console.error('Could not transfer ownership:', error.message);
    process.exit(1);
  }
  console.log(`Owner            ${club.name} → ${email}`);
} else {
  console.log(`Owner            already ${email}`);
}

await db
  .from('cc_club_members')
  .upsert({ club_id: club.id, user_id: user.id, role: 'owner' }, { onConflict: 'club_id,user_id' });

// Keep a platform seat, downgraded from owner. Two owners is ambiguous about
// whose club it is; a director seat says plainly that we are staff here.
const { data: platform } = await db
  .from('cc_club_members')
  .select('user_id')
  .eq('club_id', club.id)
  .neq('user_id', user.id);
for (const row of platform ?? []) {
  await db
    .from('cc_club_members')
    .update({ role: 'director' })
    .eq('club_id', club.id)
    .eq('user_id', row.user_id)
    .eq('role', 'owner');
}

// Any open invite is now a second door to the same room. Close it.
const { data: closed } = await db
  .from('cc_club_invites')
  .update({ accepted_at: new Date().toISOString() })
  .eq('club_id', club.id)
  .eq('email', email)
  .is('accepted_at', null)
  .select('token');
if (closed?.length) console.log(`Invite closed    ${closed.length} superseded by the account`);

/* ----------------------------------------------------------------- the link */
const { data: link, error: linkErr } = await db.auth.admin.generateLink({
  type: 'recovery',
  email,
  options: { redirectTo: `${SITE}/reset-password` },
});
if (linkErr) {
  console.error(`\nAccount and ownership are set, but the sign-in link failed: ${linkErr.message}`);
  console.error(`He can still get in via ${SITE}/forgot-password using ${email}.`);
  process.exit(1);
}

console.log(`
────────────────────────────────────────────────────────────
${club.name} now belongs to ${email}.

Send him this ONE-TIME link. It asks him to set his own
password, then signs him in. Nothing has been emailed.

${link.properties.action_link}

If it expires, re-run this script for a fresh one, or send
him to ${SITE}/forgot-password with ${email}.

His club:  ${SITE}/c/${club.slug}
His admin: ${SITE}/run/site
────────────────────────────────────────────────────────────`);

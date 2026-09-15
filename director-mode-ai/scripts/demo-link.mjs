/**
 * demo-link.mjs — create, show and revoke a club's one-link demo.
 *
 *   node scripts/demo-link.mjs --club rossmoor-tennis-club \
 *        --label Rossmoor --director-label "board member" --expires 60d
 *   node scripts/demo-link.mjs --club rossmoor-tennis-club            # show it
 *   node scripts/demo-link.mjs --club rossmoor-tennis-club --revoke   # switch it off
 *   node scripts/demo-link.mjs --club rossmoor-tennis-club --new      # fresh token
 *
 * Options
 *   --club <slug>             required
 *   --member <email>          the demo member login   (default: see below)
 *   --director <email>        the demo staff login    (default: see below)
 *   --label <text>            how the banner names the club ("the Rossmoor demo")
 *   --director-label <text>   what the staff login is called on the tour and
 *                             banner (default "tennis director"). Wording only;
 *                             the account's club role stays `director`.
 *   --expires <n>d|<n>h|never how long from now (default: unchanged, or 60d on create)
 *   --revoke                  deactivate every link for the club
 *   --new                     deactivate the current link and issue a new token
 *
 * ONE LINK PER CLUB, and the token is STABLE: re-running updates the existing
 * active link in place, so the nightly reset and a changed label never break
 * the URL a prospect already has. Only --new rotates it.
 *
 * DEMO ACCOUNTS ONLY. A demo link mints a session with no password, so it is
 * refused for any account that is a platform owner, owns a club, or holds the
 * `owner` role anywhere. The app checks the same rules again on every entry
 * (src/lib/demo/session.ts).
 *
 * Default accounts: the club's `member` and `director` memberships whose login
 * is a ClubMode demo address (@clubmode.ai) seated at this club and no other.
 * Pass --member / --director to choose explicitly.
 *
 * This script does NOT switch on cc_clubs.demo_mode (email suppression for the
 * whole club). That is a separate, deliberate decision per club; a club still
 * in evaluation may have real people receiving real email. See
 * supabase/migrations/demo_links.sql and seed-rossmoor.mjs.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { randomBytes } from 'crypto';

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

const APP_URL = (env.NEXT_PUBLIC_APP_URL || 'https://clubmode.ai').replace(/\/$/, '');
// Mirrors src/lib/platformOwner.ts.
const PLATFORM_OWNERS = (env.PLATFORM_OWNER_EMAILS || process.env.PLATFORM_OWNER_EMAILS || 'darrinjco@gmail.com')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const flag = (name) => process.argv.includes(`--${name}`);

function parseExpiry(raw) {
  if (raw === undefined) return undefined;
  if (raw === 'never') return null;
  const m = /^(\d+)([dh])$/.exec(raw);
  if (!m) throw new Error(`--expires takes 60d, 12h or never (got "${raw}")`);
  const ms = Number(m[1]) * (m[2] === 'd' ? 864e5 : 36e5);
  return new Date(Date.now() + ms).toISOString();
}

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

/** Why this account may not be a demo login, or null if it may. */
async function refusal(user) {
  const email = (user.email || '').toLowerCase();
  if (PLATFORM_OWNERS.includes(email)) return 'is a platform owner';
  const { count: owns } = await db.from('cc_clubs').select('id', { count: 'exact', head: true }).eq('owner_id', user.id);
  if (owns) return `owns ${owns} club(s)`;
  const { count: ownerRole } = await db
    .from('cc_club_members')
    .select('club_id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('role', 'owner');
  if (ownerRole) return 'holds the owner role at a club';
  return null;
}

async function pickDefault(club, role, users) {
  const { data: seats } = await db.from('cc_club_members').select('user_id, created_at').eq('club_id', club.id).eq('role', role).order('created_at');
  for (const s of seats ?? []) {
    const u = users.find((x) => x.id === s.user_id);
    if (!u || !/@clubmode\.ai$/i.test(u.email || '')) continue;
    const { count } = await db.from('cc_club_members').select('club_id', { count: 'exact', head: true }).eq('user_id', u.id);
    if (count === 1) return u;
  }
  return null;
}

async function resolveAccount(club, role, email, users) {
  let user;
  if (email) {
    user = users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
    if (!user) throw new Error(`No account for ${email}.`);
  } else {
    user = await pickDefault(club, role, users);
    if (!user) return null;
  }
  const why = await refusal(user);
  if (why) throw new Error(`Refusing ${user.email} as the demo ${role}: it ${why}. Demo accounts only.`);
  return user;
}

async function main() {
  const slug = arg('club');
  if (!slug) throw new Error('Pass --club <slug>.');
  const { data: club } = await db.from('cc_clubs').select('id, name, slug, demo_mode').eq('slug', slug).maybeSingle();
  if (!club) throw new Error(`No club "${slug}".`);

  const { data: links } = await db
    .from('demo_links')
    .select('*')
    .eq('club_id', club.id)
    .order('created_at', { ascending: false });
  const current = (links ?? []).find((l) => l.active) ?? null;

  if (flag('revoke')) {
    const { error } = await db.from('demo_links').update({ active: false }).eq('club_id', club.id).eq('active', true);
    if (error) throw error;
    console.log(`Revoked ${(links ?? []).filter((l) => l.active).length} link(s) for ${club.name}.`);
    return;
  }

  const expires = parseExpiry(arg('expires'));
  const wantsChange =
    flag('new') || !current || ['member', 'director', 'label', 'director-label', 'expires'].some((k) => arg(k) !== undefined);

  let link = current;
  if (wantsChange) {
    const users = await allUsers();
    const needAccounts = !current || flag('new') || arg('member') || arg('director');
    const patch = {};
    if (needAccounts) {
      const member = await resolveAccount(club, 'member', arg('member'), users);
      const director = await resolveAccount(club, 'director', arg('director'), users);
      if (!member && !director) throw new Error('No demo accounts found; pass --member and/or --director.');
      if (!current || flag('new') || arg('member')) patch.member_user_id = member?.id ?? null;
      if (!current || flag('new') || arg('director')) patch.director_user_id = director?.id ?? null;
    }
    if (arg('label') !== undefined) patch.label = arg('label');
    if (arg('director-label') !== undefined) patch.director_label = arg('director-label');
    if (expires !== undefined) patch.expires_at = expires;

    if (!current || flag('new')) {
      if (current) await db.from('demo_links').update({ active: false }).eq('token', current.token);
      const row = {
        token: randomBytes(24).toString('base64url'),
        club_id: club.id,
        label: patch.label ?? current?.label ?? club.name,
        director_label: patch.director_label ?? current?.director_label ?? 'tennis director',
        member_user_id: patch.member_user_id ?? null,
        director_user_id: patch.director_user_id ?? null,
        expires_at: expires === undefined ? parseExpiry('60d') : expires,
        active: true,
      };
      const { data, error } = await db.from('demo_links').insert(row).select('*').single();
      if (error) throw error;
      link = data;
      console.log(current ? 'Issued a new token (the old link is revoked).' : 'Created a demo link.');
    } else {
      const { data, error } = await db.from('demo_links').update(patch).eq('token', current.token).select('*').single();
      if (error) throw error;
      link = data;
      console.log('Updated the demo link (same token).');
    }
  }

  const name = async (id) => {
    if (!id) return '(none)';
    const { data } = await db.auth.admin.getUserById(id);
    return data?.user?.email ?? id;
  };
  console.log(`
  Club            ${club.name}${club.demo_mode ? '  (demo_mode on: club emails are held)' : '  (demo_mode OFF)'}
  Label           ${link.label ?? '(club name)'}
  Staff login is  "${link.director_label}"
  Member          ${await name(link.member_user_id)}
  Staff           ${await name(link.director_user_id)}
  Expires         ${link.expires_at ?? 'never'}
  Used            ${link.use_count} time(s)${link.last_used_at ? `, last ${link.last_used_at}` : ''}

  ${APP_URL}/demo/${link.token}
`);
}

main().catch((e) => {
  console.error('\nFAILED:', e.message || e);
  process.exit(1);
});

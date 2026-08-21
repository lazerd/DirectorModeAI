/**
 * Add a co-captain to a CaptainMode team.
 *
 *   node scripts/captain-add-cocaptain.mjs <teamId> <email> "<Full Name>"
 *
 * Creates the ClubMode login if the person doesn't have one (co-captains are
 * free — no subscription is created, they ride on the team owner's), then adds
 * the captain_team_staff row. Safe to re-run: it never resets an existing
 * account's password and the staff row is upserted.
 *
 * Prints a temp password only for accounts it just created.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { randomBytes } from 'crypto';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
);

const [teamId, email, fullName] = process.argv.slice(2);
if (!teamId || !email) {
  console.error('usage: node scripts/captain-add-cocaptain.mjs <teamId> <email> "<Full Name>"');
  process.exit(1);
}

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: team } = await db
  .from('captain_teams')
  .select('id, name, captain_user_id')
  .eq('id', teamId)
  .maybeSingle();
if (!team) {
  console.error('No such team:', teamId);
  process.exit(1);
}

// Find an existing auth user by email (listUsers is the only lookup the admin API gives us).
let user = null;
for (let page = 1; page <= 20 && !user; page++) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw error;
  user = data.users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase()) || null;
  if (data.users.length < 200) break;
}

let tempPassword = null;
if (!user) {
  tempPassword = `Tennis-${randomBytes(4).toString('hex')}`;
  const { data, error } = await db.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName || null },
  });
  if (error) throw error;
  user = data.user;
  await db.from('profiles').upsert({ id: user.id, full_name: fullName || null }, { onConflict: 'id' });
}

const { error: staffErr } = await db
  .from('captain_team_staff')
  .upsert({ team_id: team.id, user_id: user.id, role: 'co_captain' }, { onConflict: 'team_id,user_id' });
if (staffErr) throw staffErr;

console.log(`${email} is now a co-captain of "${team.name}".`);
console.log(`  user_id: ${user.id}`);
console.log(`  team:    ${env.NEXT_PUBLIC_APP_URL || 'https://club.coachmode.ai'}/captain/${team.id}`);
if (tempPassword) console.log(`  TEMP PASSWORD (new account): ${tempPassword}`);
else console.log('  (existing account — password unchanged)');

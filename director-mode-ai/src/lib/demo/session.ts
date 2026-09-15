/**
 * Signing a browser into a demo account from a link, with no password.
 *
 * Same technique as "view as" (app/api/admin/view-as/route.ts): mint a
 * one-time magic-link token admin-side, spend it on a detached client, and
 * hand the resulting session to the SSR client so cookie names and chunking
 * stay Supabase's business. generateLink creates the token only; nothing is
 * emailed.
 *
 * The account is checked AGAIN here, not just when the link was created. A
 * URL that yields a session must never yield one for a real person, even if
 * someone later makes a demo login an owner or edits demo_links by hand.
 */

import { createClient } from '@supabase/supabase-js';
import { createClient as createSsrClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { isPlatformOwnerEmail } from '@/lib/platformOwner';

function detachedAnon() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** The account's email if it may be a demo login, or why not. */
export async function demoAccountEmail(userId: string): Promise<{ email: string } | { refused: string }> {
  const db = getSupabaseAdmin();
  const { data, error } = await db.auth.admin.getUserById(userId);
  const email = data?.user?.email;
  if (error || !email) return { refused: 'no such account' };
  if (isPlatformOwnerEmail(email)) return { refused: 'platform owner' };

  const [{ count: owns }, { count: ownerRole }] = await Promise.all([
    db.from('cc_clubs').select('id', { count: 'exact', head: true }).eq('owner_id', userId),
    db.from('cc_club_members').select('club_id', { count: 'exact', head: true }).eq('user_id', userId).eq('role', 'owner'),
  ]);
  if (owns) return { refused: 'owns a club' };
  if (ownerRole) return { refused: 'holds the owner role' };
  return { email };
}

/** Replace this browser's session with the account's. Returns an error message or null. */
export async function signInAs(email: string): Promise<string | null> {
  const { data: link, error: linkErr } = await getSupabaseAdmin().auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (linkErr || !tokenHash) return linkErr?.message ?? 'no token returned';

  const { data: exchanged, error: otpErr } = await detachedAnon().auth.verifyOtp({
    type: 'magiclink',
    token_hash: tokenHash,
  });
  if (otpErr || !exchanged?.session) return otpErr?.message ?? 'no session returned';

  const supabase = await createSsrClient();
  const { error } = await supabase.auth.setSession({
    access_token: exchanged.session.access_token,
    refresh_token: exchanged.session.refresh_token,
  });
  return error?.message ?? null;
}

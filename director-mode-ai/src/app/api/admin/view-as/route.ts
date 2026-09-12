/**
 * Start and stop "view as".
 *
 *   POST { user_id } — swap this browser onto that user's session
 *   DELETE           — put the owner's own session back
 *
 * The swap is a real Supabase session, minted admin-side with a one-time
 * magic-link token that is verified here and never emailed. See
 * lib/impersonation.ts for why it has to be a real session rather than a
 * pretend "current user" held in a cookie.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createSsrClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { isPlatformOwnerEmail } from '@/lib/platformOwner';
import {
  clearViewAs,
  readReturnToken,
  readViewAs,
  writeReturnToken,
  writeViewAs,
} from '@/lib/impersonation';

export const dynamic = 'force-dynamic';

/**
 * A plain anon client with no cookie wiring.
 *
 * verifyOtp and refreshSession on the SSR client would write their result
 * straight into the response cookies. We do want that eventually, but not
 * before the owner's own refresh token has been parked — so the token exchange
 * happens on a detached client and the cookies are written deliberately.
 */
function detachedAnon() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

/**
 * Put a session into this browser's Supabase cookies. setSession triggers the
 * SSR client's own setAll, so cookie names and chunking stay its business.
 */
async function adoptSession(accessToken: string, refreshToken: string) {
  const supabase = await createSsrClient();
  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  return error;
}

/**
 * Is this browser borrowing a session, and whose?
 *
 * The banner asks on mount rather than being rendered from the cookie in the
 * root layout: reading a cookie up there would make every static marketing
 * page dynamic to serve a bar that is off almost all of the time.
 */
export async function GET() {
  const state = await readViewAs();
  if (state) return NextResponse.json({ viewing: true, label: state.targetLabel, allowed: false });

  // Also answers "may I use this at all", so the nav rail can show the entry
  // point to the one account that has it and to nobody else.
  const supabase = await createSsrClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return NextResponse.json({
    viewing: false,
    allowed: isPlatformOwnerEmail(user?.email),
  });
}

export async function POST(req: Request) {
  // Already viewing as someone? The session in hand is the TARGET's, so the
  // owner check below would fail and say something misleading. Say the real
  // thing instead: exit first.
  const already = await readViewAs();
  if (already) {
    return NextResponse.json(
      { error: `Already viewing as ${already.targetLabel}. Exit that first.` },
      { status: 409 },
    );
  }

  const supabase = await createSsrClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  if (!isPlatformOwnerEmail(user.email)) {
    return NextResponse.json({ error: 'Not available on this account.' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { user_id?: string; reason?: string };
  const targetId = (body.user_id || '').trim();
  if (!targetId) return NextResponse.json({ error: 'Pick someone to view as.' }, { status: 400 });
  if (targetId === user.id) {
    return NextResponse.json({ error: 'That is already your own account.' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data: target, error: targetErr } = await admin.auth.admin.getUserById(targetId);
  const targetEmail = target?.user?.email;
  if (targetErr || !targetEmail) {
    return NextResponse.json({ error: 'No account with that id.' }, { status: 404 });
  }

  // Never let one owner borrow another's session. An audit trail that can be
  // laundered through a second admin account is not an audit trail.
  if (isPlatformOwnerEmail(targetEmail)) {
    return NextResponse.json(
      { error: 'That account is a platform owner — view as is not available for it.' },
      { status: 403 },
    );
  }

  // The owner's own refresh token, read before anything replaces it. Without
  // it there is no way back except signing in again.
  const {
    data: { session: mine },
  } = await supabase.auth.getSession();
  if (!mine?.refresh_token) {
    return NextResponse.json(
      { error: 'Could not read your own session — sign out, sign in, and try again.' },
      { status: 500 },
    );
  }

  // A magic link we mint and spend ourselves. generateLink only creates the
  // token; nothing reaches the target's inbox.
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: targetEmail,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (linkErr || !tokenHash) {
    return NextResponse.json(
      { error: `Could not open that account: ${linkErr?.message ?? 'no token returned'}` },
      { status: 500 },
    );
  }

  const { data: exchanged, error: otpErr } = await detachedAnon().auth.verifyOtp({
    type: 'magiclink',
    token_hash: tokenHash,
  });
  if (otpErr || !exchanged?.session) {
    return NextResponse.json(
      { error: `Could not open that account: ${otpErr?.message ?? 'no session returned'}` },
      { status: 500 },
    );
  }

  const { data: logged } = await admin
    .from('impersonation_log')
    .insert({
      admin_user_id: user.id,
      admin_email: user.email,
      target_user_id: targetId,
      target_email: targetEmail,
      reason: (body.reason || '').trim() || null,
    })
    .select('id')
    .maybeSingle();

  const { data: profile } = await admin
    .from('profiles')
    .select('full_name')
    .eq('id', targetId)
    .maybeSingle();

  // Order matters: park the way back and mark the session as borrowed BEFORE
  // handing the browser the other person's tokens, so a failure halfway
  // through never leaves a swapped session with no banner and no exit.
  await writeReturnToken(mine.refresh_token);
  await writeViewAs({
    targetUserId: targetId,
    targetLabel: (profile as { full_name?: string } | null)?.full_name || targetEmail,
    adminEmail: user.email ?? '',
    logId: (logged as { id?: string } | null)?.id ?? '',
  });

  const adoptErr = await adoptSession(
    exchanged.session.access_token,
    exchanged.session.refresh_token,
  );
  if (adoptErr) {
    await clearViewAs();
    return NextResponse.json({ error: `Could not switch: ${adoptErr.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, viewing_as: targetEmail });
}

export async function DELETE() {
  const state = await readViewAs();
  const back = await readReturnToken();

  if (state?.logId) {
    await getSupabaseAdmin()
      .from('impersonation_log')
      .update({ ended_at: new Date().toISOString() })
      .eq('id', state.logId);
  }

  /** Ending up signed out beats being left silently holding someone else's session. */
  async function bailToSignedOut() {
    const supabase = await createSsrClient();
    await supabase.auth.signOut();
    await clearViewAs();
    return NextResponse.json({ ok: true, signed_out: true });
  }

  if (!back) return bailToSignedOut();

  const { data, error } = await detachedAnon().auth.refreshSession({ refresh_token: back });
  if (error || !data.session) return bailToSignedOut();

  const adoptErr = await adoptSession(data.session.access_token, data.session.refresh_token);
  await clearViewAs();
  if (adoptErr) return NextResponse.json({ error: adoptErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

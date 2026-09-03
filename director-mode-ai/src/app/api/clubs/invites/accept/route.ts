/**
 * Accepting a club invitation.
 *   GET  ?token=…   — what this invite is for (before asking anyone to sign in)
 *   POST { token }  — redeem it as the signed-in user
 *
 * The token is bound to one email address and one use. It is checked against
 * the signed-in account's email rather than trusted on its own, so forwarding
 * an invitation does not hand someone else a staff role.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { ROLE_LABEL } from '@/lib/clubRoles';
import { attachByEmail } from '@/lib/clubAutoJoin';

export const dynamic = 'force-dynamic';

type Invite = {
  id: string;
  club_id: string;
  email: string;
  role: string;
  invited_name: string | null;
  note: string | null;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
};

async function loadInvite(token: string) {
  const db = getSupabaseAdmin();
  const { data } = await db
    .from('cc_club_invites')
    .select('id, club_id, email, role, invited_name, note, expires_at, accepted_at, revoked_at')
    .eq('token', token)
    .maybeSingle();
  return { db, invite: (data as Invite) || null };
}

/** One place decides whether an invite is usable, so GET and POST agree. */
function invalidReason(invite: Invite | null): string | null {
  if (!invite) return 'That invitation link is not valid.';
  if (invite.revoked_at) return 'That invitation was withdrawn.';
  if (invite.accepted_at) return 'That invitation has already been used.';
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return 'That invitation has expired — ask for a new one.';
  }
  return null;
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token') || '';
  const { db, invite } = await loadInvite(token);

  const reason = invalidReason(invite);
  if (reason || !invite) return NextResponse.json({ error: reason }, { status: 404 });

  const { data: club } = await db
    .from('cc_clubs')
    .select('name')
    .eq('id', invite.club_id)
    .maybeSingle();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return NextResponse.json({
    club_name: (club?.name as string) || 'the club',
    role: invite.role,
    role_label: ROLE_LABEL[invite.role] || invite.role,
    invited_name: invite.invited_name,
    invited_email: invite.email,
    note: invite.note,
    signed_in_as: user?.email || null,
    /** Same person? Decided here so the page can say so before they try. */
    email_matches: !!user?.email && user.email.toLowerCase() === invite.email.toLowerCase(),
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { token?: string };
  const { db, invite } = await loadInvite(body.token || '');

  const reason = invalidReason(invite);
  if (reason || !invite) return NextResponse.json({ error: reason }, { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  /**
   * The check that makes a forwarded invitation useless. A staff role is not
   * something a link should be able to hand to whoever opens it.
   */
  if ((user.email || '').toLowerCase() !== invite.email.toLowerCase()) {
    return NextResponse.json(
      {
        error: `This invitation was sent to ${invite.email}. Sign in with that address to accept it.`,
        code: 'wrong_account',
      },
      { status: 403 },
    );
  }

  const { data: existing } = await db
    .from('cc_club_members')
    .select('role')
    .eq('club_id', invite.club_id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (existing) {
    // Already in the club: an invite may promote, never demote.
    const RANK: Record<string, number> = { owner: 0, director: 1, coach: 2, front_desk: 3, member: 4 };
    const better = (RANK[invite.role] ?? 9) < (RANK[existing.role] ?? 9);
    if (better) {
      await db
        .from('cc_club_members')
        .update({ role: invite.role })
        .eq('club_id', invite.club_id)
        .eq('user_id', user.id);
    }
  } else {
    const { error } = await db
      .from('cc_club_members')
      .insert({ club_id: invite.club_id, user_id: user.id, role: invite.role });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await db
    .from('cc_club_invites')
    .update({ accepted_at: new Date().toISOString(), accepted_by: user.id })
    .eq('id', invite.id);

  // They may also be on another club's roster already; that is not this
  // invitation's business, but it is theirs.
  await attachByEmail(db, user.id, user.email);

  /**
   * Teaching staff get their coach record made here, attached to this club, so
   * the calendar setup page is ready the moment they land on it.
   */
  if (invite.role === 'coach' || invite.role === 'director') {
    const { data: coach } = await db
      .from('lesson_coaches')
      .select('id, club_id')
      .eq('profile_id', user.id)
      .maybeSingle();
    if (!coach) {
      const { data: profile } = await db
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .maybeSingle();
      await db.from('lesson_coaches').insert({
        profile_id: user.id,
        display_name:
          (profile?.full_name as string) || invite.invited_name || user.email?.split('@')[0] || 'Instructor',
        email: user.email,
        club_id: invite.club_id,
      });
    } else if (!coach.club_id) {
      await db.from('lesson_coaches').update({ club_id: invite.club_id }).eq('id', coach.id as string);
    }
  }

  // Land them where their role actually starts.
  const next =
    invite.role === 'coach' ? '/lessons/open' : invite.role === 'member' ? '/member' : '/';

  return NextResponse.json({ ok: true, role: invite.role, next });
}

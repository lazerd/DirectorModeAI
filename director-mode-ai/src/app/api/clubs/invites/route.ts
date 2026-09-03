/**
 * Club invites — the staff door, and the tidy version of the member door.
 *   GET                                  — everyone at the club + open invites
 *   POST   { email, role, name?, note? } — invite one person, by role
 *   PATCH  { user_id, role }             — change someone's role
 *   DELETE ?invite_id=…                  — revoke an unaccepted invite
 *
 * Directors and owners only. The invite carries the role, so a pro arrives as a
 * pro instead of arriving as a member and waiting to be found and promoted —
 * and because it is bound to one email address and one use, it is not a
 * credential that survives being forwarded.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { sendBilledEmails } from '@/lib/email';
import { APP_URL } from '@/lib/appUrl';
import { CLUB_ROLES, ROLE_LABEL, type ClubRole } from '@/lib/clubRoles';
import { randomBytes } from 'crypto';

export const dynamic = 'force-dynamic';

/** Roles a director may hand out. Nobody invites an owner. */
const INVITABLE: ClubRole[] = ['director', 'coach', 'front_desk', 'member'];

/** Who may manage people at a club. */
const CAN_MANAGE = ['owner', 'director'];

type Ctx = { userId: string; clubId: string; clubName: string; db: ReturnType<typeof getSupabaseAdmin> };

async function requireClubManager(): Promise<Ctx | { error: NextResponse }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Not signed in.' }, { status: 401 }) };

  const db = getSupabaseAdmin();

  const { data: owned } = await db
    .from('cc_clubs')
    .select('id, name')
    .eq('owner_id', user.id)
    .order('created_at')
    .limit(1)
    .maybeSingle();
  if (owned) {
    return { userId: user.id, clubId: owned.id as string, clubName: owned.name as string, db };
  }

  const { data: staff } = await db
    .from('cc_club_members')
    .select('club_id, role, cc_clubs(name)')
    .eq('user_id', user.id)
    .in('role', CAN_MANAGE)
    .limit(1)
    .maybeSingle();
  if (!staff) {
    return {
      error: NextResponse.json(
        { error: 'Only a club owner or director can manage people.' },
        { status: 403 },
      ),
    };
  }
  return {
    userId: user.id,
    clubId: staff.club_id as string,
    clubName: ((staff as unknown as { cc_clubs: { name: string } | null }).cc_clubs?.name) || 'your club',
    db,
  };
}

export async function GET() {
  const ctx = await requireClubManager();
  if ('error' in ctx) return ctx.error;
  const { db, clubId, clubName } = ctx;

  const [{ data: members }, { data: invites }] = await Promise.all([
    db.from('cc_club_members').select('user_id, role, created_at').eq('club_id', clubId),
    db
      .from('cc_club_invites')
      .select('id, email, role, invited_name, created_at, expires_at, accepted_at')
      .eq('club_id', clubId)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .order('created_at', { ascending: false }),
  ]);

  const rows = (members as { user_id: string; role: string; created_at: string }[]) || [];

  /**
   * Names and emails come from profiles, and whether they have set up a
   * booking page comes from lesson_coaches — a director looking at this list
   * wants to know who is stuck, not just who exists.
   */
  const ids = rows.map((r) => r.user_id);
  const [{ data: profiles }, { data: coaches }, { data: subs }] = ids.length
    ? await Promise.all([
        db.from('profiles').select('id, full_name').in('id', ids),
        db
          .from('lesson_coaches')
          .select('profile_id, open_page_enabled, google_calendar_id, ics_url, calendar_kind')
          .in('profile_id', ids),
        // CaptainMode is a per-captain subscription, so a director needs to see
        // who is paying, who is comped, and who is on neither.
        db
          .from('captain_subscriptions')
          .select('user_id, status, stripe_subscription_id')
          .in('user_id', ids),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  const nameOf = new Map(
    ((profiles as { id: string; full_name: string | null }[]) || []).map((p) => [p.id, p.full_name]),
  );
  const subOf = new Map(
    ((subs as { user_id: string; status: string; stripe_subscription_id: string | null }[]) || []).map(
      (r) => [r.user_id, r],
    ),
  );
  const coachOf = new Map(
    ((coaches as {
      profile_id: string;
      open_page_enabled: boolean;
      google_calendar_id: string | null;
      ics_url: string | null;
      calendar_kind: string | null;
    }[]) || []).map((c) => [c.profile_id, c]),
  );

  /**
   * Captains are people at this club who may never appear in cc_club_members.
   *
   * CaptainMode has its own person model — captain_teams.captain_user_id and
   * captain_team_staff — and a team carries the club it plays for. So a captain
   * running her team out of your club can be entirely absent from your people
   * list, which is how Robyn Rogin was invisible here while actively using the
   * product. They are listed separately, with a way to fold them into the club
   * properly.
   */
  const { data: teams } = await db
    .from('captain_teams')
    .select('id, name, captain_user_id')
    .eq('club_id', clubId);
  const teamRows = (teams as { id: string; name: string; captain_user_id: string }[]) || [];

  const { data: teamStaff } = teamRows.length
    ? await db
        .from('captain_team_staff')
        .select('user_id, role, team_id')
        .in('team_id', teamRows.map((t) => t.id))
    : { data: [] };

  const captainRoles = new Map<string, { role: string; teams: string[] }>();
  for (const t of teamRows) {
    const cur = captainRoles.get(t.captain_user_id) || { role: 'captain', teams: [] };
    cur.role = 'captain';
    cur.teams.push(t.name);
    captainRoles.set(t.captain_user_id, cur);
  }
  for (const st of ((teamStaff as { user_id: string; role: string; team_id: string }[]) || [])) {
    const team = teamRows.find((t) => t.id === st.team_id);
    const cur = captainRoles.get(st.user_id) || { role: st.role, teams: [] };
    if (cur.role !== 'captain') cur.role = st.role;
    if (team && !cur.teams.includes(team.name)) cur.teams.push(team.name);
    captainRoles.set(st.user_id, cur);
  }

  const captainIds = [...captainRoles.keys()];
  const [{ data: capProfiles }, { data: capSubs }] = captainIds.length
    ? await Promise.all([
        db.from('profiles').select('id, full_name').in('id', captainIds),
        db
          .from('captain_subscriptions')
          .select('user_id, status, stripe_subscription_id')
          .in('user_id', captainIds),
      ])
    : [{ data: [] }, { data: [] }];

  const capNameOf = new Map(
    ((capProfiles as { id: string; full_name: string | null }[]) || []).map((p) => [p.id, p.full_name]),
  );
  const capSubOf = new Map(
    ((capSubs as { user_id: string; status: string; stripe_subscription_id: string | null }[]) || []).map(
      (r) => [r.user_id, r],
    ),
  );
  const memberIds = new Set(rows.map((r) => r.user_id));

  const captains = captainIds.map((id) => {
    const info = captainRoles.get(id)!;
    const sub = capSubOf.get(id);
    return {
      user_id: id,
      name: capNameOf.get(id) || 'Captain',
      captain_role: info.role === 'co_captain' ? 'Co-captain' : 'Captain',
      teams: info.teams,
      in_club: memberIds.has(id),
      captainmode: !sub
        ? 'none'
        : sub.status === 'comped'
          ? 'comped'
          : sub.stripe_subscription_id
            ? 'paying'
            : ['active', 'trialing', 'past_due'].includes(sub.status)
              ? 'active'
              : 'none',
    };
  });

  return NextResponse.json({
    captains,
    club: { id: clubId, name: clubName },
    roles: CLUB_ROLES.filter((r) => r !== 'owner' || true),
    invitable_roles: INVITABLE,
    people: rows
      .map((r) => {
        const c = coachOf.get(r.user_id);
        return {
          user_id: r.user_id,
          name: nameOf.get(r.user_id) || 'Member',
          role: r.role,
          role_label: ROLE_LABEL[r.role] || r.role,
          joined_at: r.created_at,
          // Only meaningful for teaching staff, harmless for everyone else.
          booking_page: c
            ? {
                connected: c.calendar_kind === 'ics' ? !!c.ics_url : !!c.google_calendar_id,
                live: !!c.open_page_enabled,
              }
            : null,
          captainmode: (() => {
            const sub = subOf.get(r.user_id);
            if (!sub) return 'none';
            if (sub.status === 'comped') return 'comped';
            if (sub.stripe_subscription_id) return 'paying';
            return ['active', 'trialing', 'past_due'].includes(sub.status) ? 'active' : 'none';
          })(),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
    invites: (invites as unknown[]) || [],
  });
}

export async function POST(req: Request) {
  const ctx = await requireClubManager();
  if ('error' in ctx) return ctx.error;
  const { db, clubId, clubName, userId } = ctx;

  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    role?: ClubRole;
    name?: string;
    note?: string;
  };

  const email = (body.email || '').trim().toLowerCase();
  const role = body.role as ClubRole;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }
  if (!INVITABLE.includes(role)) {
    return NextResponse.json({ error: 'Pick a role to invite them as.' }, { status: 400 });
  }

  const token = randomBytes(24).toString('base64url');

  /**
   * Re-inviting the same person replaces their open invite rather than adding
   * a second one — two live tokens for one person is a leak waiting to happen.
   */
  await db
    .from('cc_club_invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('club_id', clubId)
    .ilike('email', email)
    .is('accepted_at', null)
    .is('revoked_at', null);

  const { error } = await db.from('cc_club_invites').insert({
    club_id: clubId,
    email,
    role,
    token,
    invited_by: userId,
    invited_name: (body.name || '').trim() || null,
    note: (body.note || '').trim() || null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const link = `${APP_URL}/invite/${token}`;
  const isStaff = role !== 'member';
  const roleWord = ROLE_LABEL[role]?.toLowerCase() || role;

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a">
      <h1 style="font-size:20px;margin:0 0 14px">You're invited to ${clubName}</h1>
      <p style="font-size:16px;line-height:1.5;margin:0 0 8px">
        ${body.name ? `${body.name.trim()}, y` : 'Y'}ou've been added to ${clubName} on ClubMode as
        <strong>${roleWord}</strong>.
      </p>
      ${body.note ? `<p style="font-size:15px;margin:0 0 12px;padding:10px 12px;background:#f8fafc;border-left:3px solid #D3FB52;border-radius:4px">${body.note.trim()}</p>` : ''}
      <div style="margin:20px 0">
        <a href="${link}" style="display:inline-block;padding:14px 22px;background:#D3FB52;color:#0f172a;text-decoration:none;border-radius:10px;font-weight:600;font-size:16px">Accept your invitation</a>
      </div>
      ${
        isStaff
          ? `<p style="font-size:14px;color:#475569;margin:0 0 8px">
               Once you're in, ${role === 'coach' ? 'set up your lesson booking page so members can book your open times' : 'you will have access to the club tools'}.
             </p>`
          : `<p style="font-size:14px;color:#475569;margin:0 0 8px">
               You'll be able to book courts, sign up for events and follow your club.
             </p>`
      }
      <p style="font-size:13px;color:#94a3b8;margin:16px 0 0">
        This invitation is for ${email} and expires in 30 days. If you weren't expecting it, ignore it.
      </p>
    </div>`;

  const [result] = await sendBilledEmails(userId, [
    { to: email, subject: `You're invited to ${clubName}`, html },
  ]);

  return NextResponse.json({
    ok: true,
    link,
    emailed: result?.sent === true,
  });
}

export async function PATCH(req: Request) {
  const ctx = await requireClubManager();
  if ('error' in ctx) return ctx.error;
  const { db, clubId, userId } = ctx;

  const body = (await req.json().catch(() => ({}))) as {
    user_id?: string;
    role?: ClubRole;
    /** Add someone who is at the club through a team but has no membership row. */
    add?: boolean;
  };
  if (!body.user_id || !body.role || !CLUB_ROLES.includes(body.role)) {
    return NextResponse.json({ error: 'Pick a person and a role.' }, { status: 400 });
  }

  if (body.add) {
    // Only for someone who genuinely belongs here already: a captain of one of
    // this club's teams. Not a way to add arbitrary user ids to a club.
    const { data: teams } = await db
      .from('captain_teams')
      .select('id')
      .eq('club_id', clubId);
    const teamIds = ((teams as { id: string }[]) || []).map((t) => t.id);
    const { data: isCaptain } = await db
      .from('captain_teams')
      .select('id')
      .eq('club_id', clubId)
      .eq('captain_user_id', body.user_id)
      .maybeSingle();
    const { data: isStaff } = teamIds.length
      ? await db
          .from('captain_team_staff')
          .select('id')
          .eq('user_id', body.user_id)
          .in('team_id', teamIds)
          .maybeSingle()
      : { data: null };
    if (!isCaptain && !isStaff) {
      return NextResponse.json(
        { error: 'They are not a captain at this club — invite them by email instead.' },
        { status: 400 },
      );
    }
    const { error } = await db
      .from('cc_club_members')
      .upsert({ club_id: clubId, user_id: body.user_id, role: body.role }, { onConflict: 'club_id,user_id' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, added: true });
  }
  if (body.role === 'owner') {
    return NextResponse.json({ error: 'A club has one owner; that is not changed here.' }, { status: 400 });
  }
  if (body.user_id === userId) {
    return NextResponse.json({ error: 'You cannot change your own role.' }, { status: 400 });
  }

  const { data: target } = await db
    .from('cc_club_members')
    .select('role')
    .eq('club_id', clubId)
    .eq('user_id', body.user_id)
    .maybeSingle();
  if (target?.role === 'owner') {
    return NextResponse.json({ error: "You cannot change the owner's role." }, { status: 400 });
  }

  const { error } = await db
    .from('cc_club_members')
    .update({ role: body.role })
    .eq('club_id', clubId)
    .eq('user_id', body.user_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const ctx = await requireClubManager();
  if ('error' in ctx) return ctx.error;
  const { db, clubId } = ctx;

  const inviteId = new URL(req.url).searchParams.get('invite_id') || '';
  if (!inviteId) return NextResponse.json({ error: 'Missing invite.' }, { status: 400 });

  const { error } = await db
    .from('cc_club_invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', inviteId)
    .eq('club_id', clubId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

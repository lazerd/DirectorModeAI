/**
 * CaptainMode access.
 *
 * CaptainMode is free (Darrin, 2026-10-21), like the rest of ClubMode: any
 * signed-in captain has full access, with no subscription, trial or rate. What
 * a captain sends is metered by sendSms / sendBilledEmail against their club's
 * card (or their own, with no club) — nothing here decides that.
 *
 * The one limit left is CAPTAIN_MAX_TEAMS on OWNED teams, enforced by the
 * teams route. captain_subscriptions and the captain LemonSqueezy products are
 * legacy: the webhook still writes them, nothing reads them to gate access.
 */
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { CAPTAIN_MAX_TEAMS } from '@/config/pricing';

/**
 * Authorization reads run on the real service-role client, NOT
 * createServiceClient(): that one forwards the caller's auth cookie, so
 * @supabase/ssr sends the user's JWT and RLS applies despite the service key.
 * gateTeam has to see a team the viewer co-captains but does not own, and does
 * its own membership test below.
 */
const adminDb = () => getSupabaseAdmin();

/**
 * Owned teams per captain. Raised from 3 to 6 on 2026-09-04: a junior coach
 * commonly captains one team per age division (10U / 12U / 14U) on top of an
 * adult team, which is four before anyone has done anything unusual.
 * Co-captained teams do not count — only teams this user owns. The number lives
 * in config/pricing so the public pages advertise the enforced limit.
 */
export const MAX_TEAMS_PER_CAPTAIN = CAPTAIN_MAX_TEAMS;

export type CaptainAccess = {
  /** Always true: CaptainMode is free. Kept so callers read one shape. */
  active: boolean;
  /** Legacy site-service note; never set now that CaptainMode is free for all. */
  includedBy: { clubId: string; clubName: string } | null;
};

/** True when this club is on the site-service tier (legacy CaptainMode "included"). */
export async function clubIncludesCaptainMode(clubId: string | null): Promise<boolean> {
  if (!clubId) return false;
  const { data } = await adminDb()
    .from('cc_clubs')
    .select('site_service_since')
    .eq('id', clubId)
    .maybeSingle();
  return !!(data as { site_service_since: string | null } | null)?.site_service_since;
}

/** Every signed-in captain has full access. Async so callers need not change. */
export async function getCaptainAccess(_userId: string): Promise<CaptainAccess> {
  return { active: true, includedBy: null };
}

export async function hasCaptainAccess(userId: string): Promise<boolean> {
  return (await getCaptainAccess(userId)).active;
}

/** Teams this user captains or co-captains, newest first. */
export async function listCaptainTeams(userId: string) {
  const supabase = await createClient();
  const { data: staffRows } = await supabase
    .from('captain_team_staff')
    .select('team_id')
    .eq('user_id', userId);
  const staffIds = ((staffRows as { team_id: string }[]) || []).map((r) => r.team_id);

  const filter = staffIds.length
    ? `captain_user_id.eq.${userId},id.in.(${staffIds.join(',')})`
    : `captain_user_id.eq.${userId}`;

  const { data } = await supabase
    .from('captain_teams')
    .select('*')
    .or(filter)
    .eq('archived', false)
    .order('created_at', { ascending: false });

  return (data as Record<string, unknown>[]) || [];
}

/** Only teams the captain OWNS count toward the team limit; co-captaining is free. */
export async function ownedTeamCount(userId: string): Promise<number> {
  const db = adminDb();
  const { count } = await db
    .from('captain_teams')
    .select('id', { count: 'exact', head: true })
    .eq('captain_user_id', userId)
    .eq('archived', false);
  return count ?? 0;
}

export async function canAccessTeam(userId: string, teamId: string): Promise<boolean> {
  const db = adminDb();
  const { data: team } = await db
    .from('captain_teams')
    .select('captain_user_id')
    .eq('id', teamId)
    .maybeSingle();
  if (!team) return false;
  if ((team as { captain_user_id: string }).captain_user_id === userId) return true;

  const { data: staff } = await db
    .from('captain_team_staff')
    .select('id')
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .maybeSingle();
  return !!staff;
}

/**
 * 'needs_subscription' is legacy: gateTeam never returns it now that CaptainMode
 * is free. It stays in the union so older callers still type-check.
 */
export type TeamGate = 'ok' | 'not_member' | 'needs_subscription';

/** Team-scoped access: the owner or a co-captain. Nobody pays to get in. */
export async function gateTeam(userId: string, teamId: string): Promise<TeamGate> {
  return (await canAccessTeam(userId, teamId)) ? 'ok' : 'not_member';
}

/**
 * CaptainMode access + rate resolution.
 *
 * CaptainMode is NOT a ClubMode Pro feature — it is a separate per-captain
 * subscription, so it deliberately does not go through hasFeature(). A captain
 * may be on ClubMode free and still pay for CaptainMode; the club's Pro status
 * only decides the price:
 *
 *   club on ClubMode Pro -> $10/mo  (rate_type 'club_linked')
 *   otherwise            -> $20/mo  (rate_type 'standalone')
 */
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { getPlanContext } from '@/lib/billing';

export const MAX_TEAMS_PER_CAPTAIN = 3;

export type CaptainRate = 'club_linked' | 'standalone';

export type CaptainAccess = {
  active: boolean;
  rateType: CaptainRate | null;
  status: string | null;
  currentPeriodEnd: string | null;
  clubId: string | null;
};

const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

export async function getCaptainAccess(userId: string): Promise<CaptainAccess> {
  const db = await createServiceClient();
  const { data } = await db
    .from('captain_subscriptions')
    .select('status, rate_type, current_period_end, club_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (!data) {
    return { active: false, rateType: null, status: null, currentPeriodEnd: null, clubId: null };
  }
  const row = data as {
    status: string;
    rate_type: CaptainRate;
    current_period_end: string | null;
    club_id: string | null;
  };
  return {
    active: ACTIVE_STATUSES.has(row.status),
    rateType: row.rate_type,
    status: row.status,
    currentPeriodEnd: row.current_period_end,
    clubId: row.club_id,
  };
}

export async function hasCaptainAccess(userId: string): Promise<boolean> {
  return (await getCaptainAccess(userId)).active;
}

/**
 * $10 or $20 — decided by whether the captain's club owner has ClubMode Pro.
 * Called at checkout and re-evaluated at renewal; an existing subscriber keeps
 * their rate until the current period ends.
 */
export async function resolveCaptainRate(clubId: string | null): Promise<CaptainRate> {
  if (!clubId) return 'standalone';
  const db = await createServiceClient();
  const { data: club } = await db
    .from('cc_clubs')
    .select('owner_id')
    .eq('id', clubId)
    .maybeSingle();
  const ownerId = (club as { owner_id: string } | null)?.owner_id;
  if (!ownerId) return 'standalone';

  const plan = await getPlanContext(ownerId);
  return plan.effectiveTier === 'pro' ? 'club_linked' : 'standalone';
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

/** Only teams the captain OWNS count toward the 3-team limit; co-captaining is free. */
export async function ownedTeamCount(userId: string): Promise<number> {
  const db = await createServiceClient();
  const { count } = await db
    .from('captain_teams')
    .select('id', { count: 'exact', head: true })
    .eq('captain_user_id', userId)
    .eq('archived', false);
  return count ?? 0;
}

export async function canAccessTeam(userId: string, teamId: string): Promise<boolean> {
  const db = await createServiceClient();
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

export type TeamGate = 'ok' | 'not_member' | 'needs_subscription';

/**
 * Team-scoped entitlement. Co-captains are free (spec §2), so the subscription
 * that matters for a co-captain is the TEAM OWNER's, not their own — checking
 * the viewer's own sub would push every co-captain to the paywall.
 */
export async function gateTeam(userId: string, teamId: string): Promise<TeamGate> {
  const db = await createServiceClient();
  const { data: team } = await db
    .from('captain_teams')
    .select('captain_user_id')
    .eq('id', teamId)
    .maybeSingle();
  const ownerId = (team as { captain_user_id: string } | null)?.captain_user_id;
  if (!ownerId) return 'not_member';

  if (ownerId !== userId) {
    const { data: staff } = await db
      .from('captain_team_staff')
      .select('id')
      .eq('team_id', teamId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!staff) return 'not_member';
    if ((await getCaptainAccess(ownerId)).active) return 'ok';
  }

  return (await getCaptainAccess(userId)).active ? 'ok' : 'needs_subscription';
}

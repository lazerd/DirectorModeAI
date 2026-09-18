/**
 * CaptainMode access + rate resolution.
 *
 * CaptainMode is NOT a ClubMode Pro feature — it is a separate per-captain
 * subscription, so it deliberately does not go through hasFeature(). A captain
 * may be on ClubMode free and still pay for CaptainMode; the club's Pro status
 * only decides the price (amounts in config/pricing):
 *
 *   club on ClubMode Pro -> CAPTAIN_CLUB_PRICE_USD  (rate_type 'club_linked')
 *     (any ClubMode club while FOUNDING_MODE is on)
 *   otherwise            -> CAPTAIN_SOLO_PRICE_USD  (rate_type 'standalone')
 *
 * One exception: a club on the $75 site-service tier (cc_clubs.site_service_since)
 * gets CaptainMode INCLUDED for every captain who plays out of it. That is
 * computed here, never written to captain_subscriptions, so it switches off by
 * itself the day the club leaves the tier.
 */
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { getPlanContext, FOUNDING_MODE } from '@/lib/billing';
import { CAPTAIN_MAX_TEAMS } from '@/config/pricing';
import { captainCheckoutConfigured } from '@/lib/lemonsqueezy';

/**
 * Authorization reads run on the real service-role client, NOT
 * createServiceClient(): that one forwards the caller's auth cookie, so
 * @supabase/ssr sends the user's JWT and RLS applies despite the service key.
 * captain_subscriptions only exposes `user_id = auth.uid()`, which meant a
 * co-captain checking whether the TEAM OWNER pays read nothing back and was
 * bounced to the paywall. These checks decide access, so they must see the
 * whole table and do their own membership test — which gateTeam does below.
 */
const adminDb = () => getSupabaseAdmin();

/**
 * Owned teams per subscription. Raised from 3 to 6 on 2026-09-04: a junior
 * coach commonly captains one team per age division (10U / 12U / 14U) on top
 * of an adult team, which is four before anyone has done anything unusual.
 * Co-captained teams do not count — only teams this user owns. The number lives
 * in config/pricing so the client pricing pages advertise the enforced limit.
 */
export const MAX_TEAMS_PER_CAPTAIN = CAPTAIN_MAX_TEAMS;

export type CaptainRate = 'club_linked' | 'standalone';

export type CaptainAccess = {
  active: boolean;
  rateType: CaptainRate | null;
  status: string | null;
  currentPeriodEnd: string | null;
  clubId: string | null;
  /** Set while a trial is running or has just lapsed. */
  trialEndsAt: string | null;
  /** Whole days left on the trial; 0 once it has run out. */
  trialDaysLeft: number;
  /** True when the ONLY reason this captain has access is an unexpired trial. */
  onTrial: boolean;
  /** True when a trial was started and has since run out. */
  trialExpired: boolean;
  /**
   * The trial has run out but CaptainMode can't be bought yet (no buy links),
   * so access continues. Pages say "Paid plans are coming soon".
   */
  paidPlansComingSoon: boolean;
  /**
   * Set when access comes from the captain's club being on the site-service
   * tier rather than from anything the captain bought. Pages say "Included with
   * <club>" instead of quoting a price.
   */
  includedBy: { clubId: string; clubName: string } | null;
};

/**
 * The site-service club this user captains or belongs to, if any.
 *
 * Three ways to be one of a club's people, same as the comp route: a
 * cc_club_members row, owning the club, or running (or co-running) a team that
 * plays for it. A captain is often in only the last group.
 */
export async function siteServiceClubFor(
  userId: string,
): Promise<{ clubId: string; clubName: string } | null> {
  const db = adminDb();
  const [{ data: members }, { data: owned }, { data: ownTeams }, { data: staffRows }] =
    await Promise.all([
      db.from('cc_club_members').select('club_id').eq('user_id', userId),
      db.from('cc_clubs').select('id').eq('owner_id', userId),
      db.from('captain_teams').select('club_id').eq('captain_user_id', userId),
      db.from('captain_team_staff').select('captain_teams(club_id)').eq('user_id', userId),
    ]);

  const ids = new Set<string>();
  for (const r of (members as { club_id: string | null }[]) || []) if (r.club_id) ids.add(r.club_id);
  for (const r of (owned as { id: string }[]) || []) ids.add(r.id);
  for (const r of (ownTeams as { club_id: string | null }[]) || []) if (r.club_id) ids.add(r.club_id);
  for (const r of (staffRows as unknown as { captain_teams: { club_id: string | null } | null }[]) ||
    [])
    if (r.captain_teams?.club_id) ids.add(r.captain_teams.club_id);
  if (!ids.size) return null;

  const { data: club } = await db
    .from('cc_clubs')
    .select('id, name')
    .in('id', [...ids])
    .not('site_service_since', 'is', null)
    .limit(1)
    .maybeSingle();
  const c = club as { id: string; name: string } | null;
  return c ? { clubId: c.id, clubName: c.name } : null;
}

/** True when this club is on the site-service tier (CaptainMode included). */
export async function clubIncludesCaptainMode(clubId: string | null): Promise<boolean> {
  if (!clubId) return false;
  const { data } = await adminDb()
    .from('cc_clubs')
    .select('site_service_since')
    .eq('id', clubId)
    .maybeSingle();
  return !!(data as { site_service_since: string | null } | null)?.site_service_since;
}

/**
 * 'comped' is a club giving one of its own captains the product for nothing —
 * granted by a director, never written by the billing webhook, and kept
 * distinct from 'active' so a comp is never mistaken for revenue.
 */
const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due', 'comped']);

/** How long a self-serve trial runs. Advertised in the season-opener email. */
export const TRIAL_DAYS = 14;

export async function getCaptainAccess(userId: string): Promise<CaptainAccess> {
  const sub = await subscriptionAccess(userId);
  // Someone paying keeps reading as paying; the site tier only fills the gap.
  if (sub.active) return sub;
  const includedBy = await siteServiceClubFor(userId);
  if (!includedBy) return sub;
  return { ...sub, active: true, clubId: sub.clubId ?? includedBy.clubId, includedBy };
}

async function subscriptionAccess(userId: string): Promise<CaptainAccess> {
  const db = adminDb();
  const { data } = await db
    .from('captain_subscriptions')
    .select('status, rate_type, current_period_end, club_id, trial_ends_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (!data) {
    return {
      active: false,
      rateType: null,
      status: null,
      currentPeriodEnd: null,
      clubId: null,
      trialEndsAt: null,
      trialDaysLeft: 0,
      onTrial: false,
      trialExpired: false,
      paidPlansComingSoon: false,
      includedBy: null,
    };
  }
  const row = data as {
    status: string;
    rate_type: CaptainRate;
    current_period_end: string | null;
    club_id: string | null;
    trial_ends_at: string | null;
  };

  /*
   * A trial has to actually end.
   *
   * 'trialing' was in ACTIVE_STATUSES from the beginning and nothing ever
   * checked a date, so the first signup button would have handed out
   * CaptainMode free forever. Expiry is enforced here, at the one place every
   * gate reads, rather than in a nightly job that can silently stop running.
   */
  const trialEndsAt = row.trial_ends_at;
  const msLeft = trialEndsAt ? new Date(trialEndsAt).getTime() - Date.now() : 0;
  const trialLive = row.status === 'trialing' && !!trialEndsAt && msLeft > 0;
  const trialExpired = row.status === 'trialing' && (!trialEndsAt || msLeft <= 0);
  // A lapsed trial only walls the captain once there is something to buy.
  // Until the CaptainMode buy links exist the wall could only say "checkout
  // isn't configured" and 402 every route, so access simply continues.
  const paidPlansComingSoon = trialExpired && !captainCheckoutConfigured();

  return {
    active:
      row.status === 'trialing'
        ? trialLive || paidPlansComingSoon
        : ACTIVE_STATUSES.has(row.status),
    rateType: row.rate_type,
    status: row.status,
    currentPeriodEnd: row.current_period_end,
    clubId: row.club_id,
    trialEndsAt,
    trialDaysLeft: trialLive ? Math.max(0, Math.ceil(msLeft / 86_400_000)) : 0,
    onTrial: trialLive,
    trialExpired,
    paidPlansComingSoon,
    includedBy: null,
  };
}

export async function hasCaptainAccess(userId: string): Promise<boolean> {
  return (await getCaptainAccess(userId)).active;
}

/**
 * Club or standalone rate — decided by whether the captain's club owner has
 * ClubMode Pro. While FOUNDING_MODE is on every club is effectively Pro (it has
 * everything unlocked), so a captain at a founding club is never quoted the
 * higher standalone price. Called at checkout and re-evaluated at renewal; an
 * existing subscriber keeps their rate until the current period ends.
 */
export async function resolveCaptainRate(clubId: string | null): Promise<CaptainRate> {
  if (!clubId) return 'standalone';
  const db = adminDb();
  const { data: club } = await db
    .from('cc_clubs')
    .select('owner_id')
    .eq('id', clubId)
    .maybeSingle();
  const ownerId = (club as { owner_id: string } | null)?.owner_id;
  if (!ownerId) return 'standalone';
  if (FOUNDING_MODE) return 'club_linked';

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

export type TeamGate = 'ok' | 'not_member' | 'needs_subscription';

/**
 * Team-scoped entitlement. Co-captains are free (spec §2), so the subscription
 * that matters for a co-captain is the TEAM OWNER's, not their own — checking
 * the viewer's own sub would push every co-captain to the paywall.
 */
export async function gateTeam(userId: string, teamId: string): Promise<TeamGate> {
  const db = adminDb();
  const { data: team } = await db
    .from('captain_teams')
    .select('captain_user_id, club_id')
    .eq('id', teamId)
    .maybeSingle();
  const t = team as { captain_user_id: string; club_id: string | null } | null;
  const ownerId = t?.captain_user_id;
  if (!ownerId) return 'not_member';

  if (ownerId !== userId) {
    const { data: staff } = await db
      .from('captain_team_staff')
      .select('id')
      .eq('team_id', teamId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!staff) return 'not_member';
  }

  // A team playing for a site-service club is covered, whoever runs it.
  if (await clubIncludesCaptainMode(t.club_id)) return 'ok';

  if (ownerId !== userId && (await getCaptainAccess(ownerId)).active) return 'ok';

  return (await getCaptainAccess(userId)).active ? 'ok' : 'needs_subscription';
}

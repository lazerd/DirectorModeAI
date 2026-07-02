import { createClient, createServiceClient } from '@/lib/supabase/server';

export type PlanTier = 'free' | 'pro';
export type RawPlanTier = PlanTier | 'grandfathered';

export type Feature =
  | 'dj_console'
  | 'ai_recommendations'
  | 'custom_branding'
  | 'tournament_optimizer'
  | 'lesson_reminders'
  | 'csv_vault_import'
  | 'unlimited_photos'
  | 'multi_coach_org'
  | 'custom_subdomain'
  | 'multi_day_tournament'
  | 'advanced_analytics'
  | 'sms'
  // Pro full-access CourtSheet (grid editing, AI command, signups, multi-day).
  // Free tier still sees today's sheet read-only — gated at the route/UI, not
  // by removing this from PRO_FEATURES. See /courtsheet for the implementation.
  | 'court_sheet';

export const TIER_LIMITS = {
  free: { emails: 25, sms: 0, photos_per_event: 5, vault_size: 25 },
  pro: { emails: 1000, sms: 200, photos_per_event: -1, vault_size: -1 },
} as const;

const PRO_FEATURES: ReadonlyArray<Feature> = [
  'dj_console',
  'ai_recommendations',
  'custom_branding',
  'tournament_optimizer',
  'lesson_reminders',
  'csv_vault_import',
  'unlimited_photos',
  'multi_coach_org',
  'custom_subdomain',
  'multi_day_tournament',
  'advanced_analytics',
  'sms',
  'court_sheet',
];

const FEATURES_BY_TIER: Record<PlanTier, ReadonlyArray<Feature>> = {
  free: [],
  pro: PRO_FEATURES,
};

export interface PlanContext {
  userId: string;
  /** The club owner whose subscription + usage pool this user draws from. */
  billingUserId: string;
  /** True when this user IS the payer (club owner / solo). Only they see billing UI. */
  isBillingOwner: boolean;
  rawTier: RawPlanTier;
  effectiveTier: PlanTier;
  grandfatheredTrialEndsAt: string | null;
  grandfatheredDaysRemaining: number | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  freeDjEventId: string | null;
}

/**
 * Billing is CLUB-LEVEL: the club owner pays one subscription, and every
 * member / coach / admin inherits the club's tier and draws from the club's
 * shared usage pool. The "billing user" for any user is therefore their club's
 * owner. Owners (and solo/independent users) resolve to their own id, so this
 * is a no-op for them — no regression to the existing per-owner Stripe flow.
 *
 * Falls back to the user's own id when they have no club membership yet (e.g.
 * before the membership backfill runs), so it is always safe.
 */
export async function resolveBillingUserId(userId: string): Promise<string> {
  try {
    const supabase = await createServiceClient();
    const { data: memberships } = await supabase
      .from('cc_club_members')
      .select('club_id, role')
      .eq('user_id', userId);
    if (!memberships || memberships.length === 0) return userId;
    // Prefer a club the user OWNS (they're the payer), else their first club.
    const owned = memberships.find((m) => m.role === 'owner');
    const clubId = owned?.club_id ?? memberships[0].club_id;
    const { data: club } = await supabase
      .from('cc_clubs')
      .select('owner_id')
      .eq('id', clubId)
      .single();
    return club?.owner_id || userId;
  } catch {
    // cc_club_members not present / any error → bill as self (safe default).
    return userId;
  }
}

function resolveEffectiveTier(
  rawTier: RawPlanTier,
  grandfatheredTrialEndsAt: string | null,
  subscriptionStatus: string | null
): PlanTier {
  if (rawTier === 'grandfathered') {
    if (!grandfatheredTrialEndsAt) return 'free';
    return new Date(grandfatheredTrialEndsAt) > new Date() ? 'pro' : 'free';
  }
  if (rawTier === 'pro') {
    if (subscriptionStatus && ['active', 'trialing', 'past_due'].includes(subscriptionStatus)) {
      return 'pro';
    }
    return 'free';
  }
  return 'free';
}

export async function getPlanContext(userId: string): Promise<PlanContext> {
  // Resolve tier + subscription from the club owner's profile (club-level plan).
  const billingUserId = await resolveBillingUserId(userId);
  const supabase = await createServiceClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select(
      'plan_tier, stripe_customer_id, stripe_subscription_id, subscription_status, current_period_end, grandfathered_trial_ends_at, free_dj_event_id'
    )
    .eq('id', billingUserId)
    .single();

  const rawTier = (profile?.plan_tier as RawPlanTier) || 'free';
  const trialEnds = profile?.grandfathered_trial_ends_at || null;
  const subStatus = profile?.subscription_status || null;
  const effectiveTier = resolveEffectiveTier(rawTier, trialEnds, subStatus);

  const daysRemaining =
    rawTier === 'grandfathered' && trialEnds
      ? Math.max(0, Math.ceil((new Date(trialEnds).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
      : null;

  return {
    userId,
    billingUserId,
    isBillingOwner: billingUserId === userId,
    rawTier,
    effectiveTier,
    grandfatheredTrialEndsAt: trialEnds,
    grandfatheredDaysRemaining: daysRemaining,
    subscriptionStatus: subStatus,
    currentPeriodEnd: profile?.current_period_end || null,
    stripeCustomerId: profile?.stripe_customer_id || null,
    stripeSubscriptionId: profile?.stripe_subscription_id || null,
    freeDjEventId: profile?.free_dj_event_id || null,
  };
}

export function hasFeatureForTier(tier: PlanTier, feature: Feature): boolean {
  return FEATURES_BY_TIER[tier].includes(feature);
}

export async function hasFeature(userId: string, feature: Feature): Promise<boolean> {
  const ctx = await getPlanContext(userId);
  return hasFeatureForTier(ctx.effectiveTier, feature);
}

export async function eventHasDayPass(eventId: string): Promise<boolean> {
  const supabase = await createServiceClient();
  const { data } = await supabase
    .from('events')
    .select('day_pass_purchased_at')
    .eq('id', eventId)
    .single();
  if (!data?.day_pass_purchased_at) return false;
  const purchased = new Date(data.day_pass_purchased_at);
  const ageMs = Date.now() - purchased.getTime();
  return ageMs < 1000 * 60 * 60 * 24 * 2; // 48-hour window
}

/**
 * Read-only check: can this user use this premium feature on this event right now?
 *
 * For dj_console specifically, free users get 1 event lifetime — so this returns true if:
 *   - they're Pro, OR
 *   - the event has a Day Pass, OR
 *   - they haven't claimed their free DJ event yet, OR
 *   - this IS their already-claimed free DJ event.
 *
 * Does NOT mutate the claim. The actual claim happens server-side via claimFreeDjIfNeeded
 * inside the announcer route.
 */
export async function eventCanUsePremium(
  userId: string,
  eventId: string,
  feature: Feature
): Promise<boolean> {
  const ctx = await getPlanContext(userId);
  if (hasFeatureForTier(ctx.effectiveTier, feature)) return true;
  if (await eventHasDayPass(eventId)) return true;
  if (feature === 'dj_console') {
    return ctx.freeDjEventId === null || ctx.freeDjEventId === eventId;
  }
  return false;
}

/**
 * Atomically claim the user's free DJ event. Returns:
 *   { ok: true, alreadyClaimed: false } — first claim, eventId now stored
 *   { ok: true, alreadyClaimed: true } — they had already claimed THIS event
 *   { ok: false } — they had claimed a different event; not allowed
 *
 * No-op for Pro users and Day-Pass events; those callers should bypass this entirely.
 */
export async function claimFreeDjIfNeeded(
  userId: string,
  eventId: string
): Promise<{ ok: boolean; alreadyClaimed: boolean }> {
  const billId = await resolveBillingUserId(userId); // club-level free DJ event
  const supabase = await createServiceClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('free_dj_event_id')
    .eq('id', billId)
    .single();
  const claimed = profile?.free_dj_event_id || null;
  if (claimed && claimed !== eventId) {
    return { ok: false, alreadyClaimed: true };
  }
  if (claimed === eventId) {
    return { ok: true, alreadyClaimed: true };
  }
  await supabase.from('profiles').update({ free_dj_event_id: eventId }).eq('id', billId);
  return { ok: true, alreadyClaimed: false };
}

export async function getUsage(userId: string) {
  const billingUserId = await resolveBillingUserId(userId);
  const supabase = await createServiceClient();
  const { data } = await supabase
    .from('usage_credits')
    .select('*')
    .eq('user_id', billingUserId)
    .single();
  return (
    data || {
      user_id: billingUserId,
      period_start: new Date().toISOString(),
      emails_used: 0,
      sms_used: 0,
      sms_overage_cents: 0,
      tts_chars_used: 0,
      ai_calls_used: 0,
    }
  );
}

async function ensureUsageRow(userId: string) {
  const supabase = await createServiceClient();
  await supabase
    .from('usage_credits')
    .upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true });
  return supabase;
}

export class CreditLimitError extends Error {
  constructor(public kind: 'email' | 'sms' | 'ai', public tier: PlanTier, public limit: number) {
    super(`${kind} limit reached on ${tier} plan (${limit})`);
    this.name = 'CreditLimitError';
  }
}

export async function consumeEmailCredits(userId: string, count: number): Promise<void> {
  if (count <= 0) return;
  const ctx = await getPlanContext(userId);
  const billId = ctx.billingUserId; // pool at the club owner
  const limit: number = TIER_LIMITS[ctx.effectiveTier].emails;
  const supabase = await ensureUsageRow(billId);
  const { data: usage } = await supabase
    .from('usage_credits')
    .select('emails_used')
    .eq('user_id', billId)
    .single();
  const used = usage?.emails_used ?? 0;
  if (limit > 0 && used + count > limit) {
    throw new CreditLimitError('email', ctx.effectiveTier, limit);
  }
  await supabase
    .from('usage_credits')
    .update({ emails_used: used + count, updated_at: new Date().toISOString() })
    .eq('user_id', billId);
}

export async function consumeSmsCredits(
  userId: string,
  count: number
): Promise<{ overageCents: number }> {
  if (count <= 0) return { overageCents: 0 };
  const ctx = await getPlanContext(userId);
  if (ctx.effectiveTier === 'free') {
    throw new CreditLimitError('sms', 'free', 0);
  }
  const billId = ctx.billingUserId; // pool at the club owner
  const supabase = await ensureUsageRow(billId);
  const limit: number = TIER_LIMITS[ctx.effectiveTier].sms;
  const overagePerSmsCents = 5; // Pro overage = $0.05/SMS
  const { data: usage } = await supabase
    .from('usage_credits')
    .select('sms_used, sms_overage_cents')
    .eq('user_id', billId)
    .single();
  const used = usage?.sms_used ?? 0;
  const newUsed = used + count;
  const overSomeBy = Math.max(0, newUsed - limit);
  const previousOver = Math.max(0, used - limit);
  const incrementalOver = overSomeBy - previousOver;
  const overageCentsThisCall = incrementalOver * overagePerSmsCents;
  await supabase
    .from('usage_credits')
    .update({
      sms_used: newUsed,
      sms_overage_cents: (usage?.sms_overage_cents ?? 0) + overageCentsThisCall,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', billId);
  return { overageCents: overageCentsThisCall };
}

export async function consumeAiCall(userId: string): Promise<void> {
  const ctx = await getPlanContext(userId);
  if (ctx.effectiveTier === 'free') {
    throw new CreditLimitError('ai', 'free', 0);
  }
  const billId = ctx.billingUserId; // pool at the club owner
  const supabase = await ensureUsageRow(billId);
  const { data: usage } = await supabase
    .from('usage_credits')
    .select('ai_calls_used')
    .eq('user_id', billId)
    .single();
  await supabase
    .from('usage_credits')
    .update({
      ai_calls_used: (usage?.ai_calls_used ?? 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', billId);
}

/**
 * Record one Assistant chat message as a billable AI action, plus the real
 * Claude token usage so the metered ("taxi meter") pricing is accurate.
 *
 * Unlike consumeAiCall, this does NOT hard-block any tier — the per-page chat is
 * metered, not gated. It never throws: a metering hiccup must not break the chat.
 */
export async function recordAiUsage(
  userId: string,
  inputTokens: number,
  outputTokens: number
): Promise<void> {
  try {
    const billId = await resolveBillingUserId(userId);
    const supabase = await ensureUsageRow(billId);
    const { data: usage } = await supabase
      .from('usage_credits')
      .select('ai_calls_used, ai_input_tokens, ai_output_tokens')
      .eq('user_id', billId)
      .single();
    await supabase
      .from('usage_credits')
      .update({
        ai_calls_used: (usage?.ai_calls_used ?? 0) + 1,
        ai_input_tokens: (usage?.ai_input_tokens ?? 0) + Math.max(0, inputTokens),
        ai_output_tokens: (usage?.ai_output_tokens ?? 0) + Math.max(0, outputTokens),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', billId);
  } catch (err) {
    console.error('recordAiUsage failed (non-fatal):', err);
  }
}

export async function consumeTtsChars(userId: string, chars: number): Promise<void> {
  if (chars <= 0) return;
  const billId = await resolveBillingUserId(userId);
  const supabase = await ensureUsageRow(billId);
  const { data: usage } = await supabase
    .from('usage_credits')
    .select('tts_chars_used')
    .eq('user_id', billId)
    .single();
  await supabase
    .from('usage_credits')
    .update({
      tts_chars_used: (usage?.tts_chars_used ?? 0) + chars,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', billId);
}

export async function getCurrentUserPlan() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return getPlanContext(user.id);
}

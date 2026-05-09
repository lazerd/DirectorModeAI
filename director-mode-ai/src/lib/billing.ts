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
  | 'sms';

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
];

const FEATURES_BY_TIER: Record<PlanTier, ReadonlyArray<Feature>> = {
  free: [],
  pro: PRO_FEATURES,
};

export interface PlanContext {
  userId: string;
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
  const supabase = await createServiceClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select(
      'plan_tier, stripe_customer_id, stripe_subscription_id, subscription_status, current_period_end, grandfathered_trial_ends_at, free_dj_event_id'
    )
    .eq('id', userId)
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
    .from('mixer_events')
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
  const supabase = await createServiceClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('free_dj_event_id')
    .eq('id', userId)
    .single();
  const claimed = profile?.free_dj_event_id || null;
  if (claimed && claimed !== eventId) {
    return { ok: false, alreadyClaimed: true };
  }
  if (claimed === eventId) {
    return { ok: true, alreadyClaimed: true };
  }
  await supabase.from('profiles').update({ free_dj_event_id: eventId }).eq('id', userId);
  return { ok: true, alreadyClaimed: false };
}

export async function getUsage(userId: string) {
  const supabase = await createServiceClient();
  const { data } = await supabase
    .from('usage_credits')
    .select('*')
    .eq('user_id', userId)
    .single();
  return (
    data || {
      user_id: userId,
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
  const limit: number = TIER_LIMITS[ctx.effectiveTier].emails;
  const supabase = await ensureUsageRow(userId);
  const { data: usage } = await supabase
    .from('usage_credits')
    .select('emails_used')
    .eq('user_id', userId)
    .single();
  const used = usage?.emails_used ?? 0;
  if (limit > 0 && used + count > limit) {
    throw new CreditLimitError('email', ctx.effectiveTier, limit);
  }
  await supabase
    .from('usage_credits')
    .update({ emails_used: used + count, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
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
  const supabase = await ensureUsageRow(userId);
  const limit: number = TIER_LIMITS[ctx.effectiveTier].sms;
  const overagePerSmsCents = 5; // Pro overage = $0.05/SMS
  const { data: usage } = await supabase
    .from('usage_credits')
    .select('sms_used, sms_overage_cents')
    .eq('user_id', userId)
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
    .eq('user_id', userId);
  return { overageCents: overageCentsThisCall };
}

export async function consumeAiCall(userId: string): Promise<void> {
  const ctx = await getPlanContext(userId);
  if (ctx.effectiveTier === 'free') {
    throw new CreditLimitError('ai', 'free', 0);
  }
  const supabase = await ensureUsageRow(userId);
  const { data: usage } = await supabase
    .from('usage_credits')
    .select('ai_calls_used')
    .eq('user_id', userId)
    .single();
  await supabase
    .from('usage_credits')
    .update({
      ai_calls_used: (usage?.ai_calls_used ?? 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
}

export async function consumeTtsChars(userId: string, chars: number): Promise<void> {
  if (chars <= 0) return;
  const supabase = await ensureUsageRow(userId);
  const { data: usage } = await supabase
    .from('usage_credits')
    .select('tts_chars_used')
    .eq('user_id', userId)
    .single();
  await supabase
    .from('usage_credits')
    .update({
      tts_chars_used: (usage?.tts_chars_used ?? 0) + chars,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
}

export async function getCurrentUserPlan() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return getPlanContext(user.id);
}

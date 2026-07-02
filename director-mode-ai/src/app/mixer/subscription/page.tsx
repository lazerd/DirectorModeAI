import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CreditCard, ArrowRight, Sparkles, Calendar, Mail, MessageSquare } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getPlanContext, getUsage, TIER_LIMITS } from '@/lib/billing';
import ManagePlanButton from '@/components/billing/ManagePlanButton';
import UpgradeButton from '@/components/billing/UpgradeButton';

export const dynamic = 'force-dynamic';

export default async function MixerSubscriptionPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/mixer/subscription');

  const ctx = await getPlanContext(user.id);
  const usage = await getUsage(user.id);
  const limits = TIER_LIMITS[ctx.effectiveTier];

  const tierLabel = {
    free: 'Free',
    pro: 'Pro — $29/mo',
  }[ctx.effectiveTier];

  const onTrial = ctx.rawTier === 'grandfathered' && (ctx.grandfatheredDaysRemaining ?? 0) > 0;

  return (
    <div className="px-4 md:px-8 py-8 md:py-12 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-2">
        <CreditCard className="text-orange-400" size={24} />
        <h1 className="font-display text-3xl text-white">Subscription</h1>
      </div>
      <p className="text-white/50">Manage your plan, see your usage, and upgrade or cancel any time.</p>

      {onTrial && (
        <div className="mt-6 rounded-2xl border border-yellow-300/30 bg-yellow-300/5 p-5">
          <div className="flex items-start gap-3">
            <Sparkles size={20} className="text-yellow-300 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-yellow-300 font-medium">
                You're on a 90-day free Pro trial.
              </div>
              <div className="text-white/70 text-sm mt-1">
                {ctx.grandfatheredDaysRemaining} day{ctx.grandfatheredDaysRemaining === 1 ? '' : 's'} remaining. Pick a plan before the trial ends to keep DJ Console, SMS, and unlimited features.
              </div>
              <div className="mt-3">
                <UpgradeButton />
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-8 rounded-2xl border border-white/10 bg-[#002838] p-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="text-white/50 text-sm">Current plan</div>
            <div className="text-2xl font-display text-white mt-1">{tierLabel}</div>
            {ctx.subscriptionStatus && (
              <div className="text-xs text-white/40 mt-1 uppercase tracking-wider">{ctx.subscriptionStatus}</div>
            )}
            {ctx.currentPeriodEnd && (
              <div className="text-xs text-white/40 mt-1">
                Renews {new Date(ctx.currentPeriodEnd).toLocaleDateString()}
              </div>
            )}
          </div>
          <div className="flex flex-col items-stretch sm:items-end gap-3">
            {ctx.subscriptionStatus === 'active' || ctx.subscriptionStatus === 'trialing' ? (
              <ManagePlanButton />
            ) : (
              <UpgradeButton />
            )}
            <Link href="/pricing" className="text-xs text-white/40 hover:text-white/70 text-right">
              Compare plans
            </Link>
          </div>
        </div>
      </div>

      <div className="mt-8">
        <h2 className="font-display text-xl text-white mb-4">This month's usage</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <UsageCard
            icon={Mail}
            label="Emails sent"
            used={usage.emails_used}
            limit={limits.emails}
            color="text-blue-400"
          />
          <UsageCard
            icon={MessageSquare}
            label="SMS sent"
            used={usage.sms_used}
            limit={limits.sms}
            color="text-emerald-400"
            overageCents={usage.sms_overage_cents}
          />
          <UsageCard
            icon={Sparkles}
            label="AI recommendations"
            used={usage.ai_calls_used}
            limit={ctx.effectiveTier === 'free' ? 0 : -1}
            color="text-pink-400"
          />
        </div>
        <div className="mt-3 text-xs text-white/40">
          Counters reset on the 1st of each month.
        </div>
      </div>
    </div>
  );
}

function UsageCard({
  icon: Icon,
  label,
  used,
  limit,
  color,
  overageCents,
}: {
  icon: any;
  label: string;
  used: number;
  limit: number;
  color: string;
  overageCents?: number;
}) {
  const unlimited = limit === -1;
  const pct = unlimited || limit === 0 ? 0 : Math.min(100, Math.round((used / limit) * 100));
  return (
    <div className="rounded-xl border border-white/10 bg-[#002838] p-4">
      <div className="flex items-center gap-2 text-white/60 text-sm">
        <Icon size={16} className={color} />
        <span>{label}</span>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <div className="text-2xl font-display text-white">{used}</div>
        <div className="text-white/40 text-sm">
          / {unlimited ? '∞' : limit === 0 ? 'not included' : limit}
        </div>
      </div>
      {!unlimited && limit > 0 && (
        <div className="mt-3 h-1.5 rounded-full bg-white/5 overflow-hidden">
          <div
            className={`h-full ${pct > 90 ? 'bg-red-400' : pct > 70 ? 'bg-yellow-300' : 'bg-emerald-400'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {overageCents && overageCents > 0 ? (
        <div className="mt-2 text-xs text-yellow-300">
          + ${(overageCents / 100).toFixed(2)} overage this period
        </div>
      ) : null}
    </div>
  );
}

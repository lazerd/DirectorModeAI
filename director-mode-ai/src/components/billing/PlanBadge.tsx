import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { getCurrentUserPlan, FOUNDING_MODE, FOUNDING_LABEL } from '@/lib/billing';

export default async function PlanBadge() {
  const ctx = await getCurrentUserPlan();
  if (!ctx) return null;

  // While founding mode is on there is no plan to show — every club has
  // everything. Showing "Free" here would be a lie that invites an upgrade
  // prompt we deliberately have not built.
  if (FOUNDING_MODE) {
    return (
      <span
        title="Nothing is locked and nothing is metered while ClubMode is in its founding period."
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium border-yellow-300/40 bg-yellow-300/10 text-yellow-300"
      >
        <Sparkles size={12} />
        {FOUNDING_LABEL}
      </span>
    );
  }

  const onTrial = ctx.rawTier === 'grandfathered' && (ctx.grandfatheredDaysRemaining ?? 0) > 0;
  const label = onTrial
    ? `Trial · ${ctx.grandfatheredDaysRemaining}d left`
    : ctx.effectiveTier === 'free'
      ? 'Free'
      : 'Pro';

  const color = onTrial || ctx.effectiveTier === 'pro'
    ? 'border-yellow-300/40 bg-yellow-300/10 text-yellow-300'
    : 'border-white/10 bg-white/5 text-white/60';

  return (
    <Link
      href={ctx.effectiveTier === 'free' && !onTrial ? '/pricing' : '/mixer/subscription'}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${color}`}
    >
      <Sparkles size={12} />
      {label}
    </Link>
  );
}

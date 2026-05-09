import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { getCurrentUserPlan } from '@/lib/billing';

export default async function PlanBadge() {
  const ctx = await getCurrentUserPlan();
  if (!ctx) return null;

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

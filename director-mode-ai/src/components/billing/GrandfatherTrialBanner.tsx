import Link from 'next/link';
import { Sparkles, ArrowRight } from 'lucide-react';
import { getCurrentUserPlan } from '@/lib/billing';

export default async function GrandfatherTrialBanner() {
  const ctx = await getCurrentUserPlan();
  if (!ctx) return null;
  if (ctx.rawTier !== 'grandfathered') return null;
  const days = ctx.grandfatheredDaysRemaining ?? 0;
  if (days <= 0 || days > 30) return null; // Only show in final 30 days

  const urgency = days <= 7;
  return (
    <div
      className={`px-4 py-3 ${urgency ? 'bg-red-500/10 border-red-500/30' : 'bg-yellow-300/10 border-yellow-300/30'} border-b`}
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-3 flex-wrap">
        <div className={`flex items-center gap-2 text-sm ${urgency ? 'text-red-300' : 'text-yellow-300'}`}>
          <Sparkles size={14} />
          <span>
            <strong>{days} day{days === 1 ? '' : 's'}</strong> left on your free Pro trial. Upgrade to keep DJ Console, SMS, and unlimited features.
          </span>
        </div>
        <Link
          href="/pricing"
          className={`text-sm font-medium flex items-center gap-1 hover:underline ${urgency ? 'text-red-300' : 'text-yellow-300'}`}
        >
          See plans <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}

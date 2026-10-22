import Link from 'next/link';
import { redirect } from 'next/navigation';
import ManagePlanButton from '@/components/billing/ManagePlanButton';
import SpendLimitForm from '@/components/billing/SpendLimitForm';
import { monthlyLimitCents } from '@/lib/usageMeter';
import { DEFAULT_MONTHLY_LIMIT_USD } from '@/config/pricing';
import { CreditCard, Sparkles, Mail, MessageSquare, Inbox, CheckCircle2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import {
  EMAIL_PRICE_CENTS,
  TEXT_PRICE_CENTS,
  AI_MONTHLY_CAP_USD,
} from '@/config/pricing';
import { heldCount, sendBilling } from '@/lib/usageMeter';
import { paygActive, periodStart } from '@/lib/assistant/meter';
import { buildCheckoutUrl } from '@/lib/lemonsqueezy';

export const dynamic = 'force-dynamic';

/**
 * Usage & billing. ClubMode is free; a club pays only for what it sends
 * (emails, texts) and for Ask Claude, on one monthly metered charge. The club
 * owner (the billing user) sees this month's meter, whether a card is on file,
 * and how many emails are waiting on that card. Everyone else is pointed at
 * the owner.
 *
 * All reads are server-side with the admin client, scoped to the signed-in
 * user's billing user id.
 */

type Bucket = { units: number; cents: number };
type MonthUsage = {
  email: { billed: Bucket; exempt: Bucket };
  sms: { billed: Bucket; exempt: Bucket };
  ai: { billedCents: number; exemptCents: number };
};

const emptyBucket = (): Bucket => ({ units: 0, cents: 0 });

async function monthUsage(billingUserId: string): Promise<MonthUsage> {
  const db = getSupabaseAdmin();
  const since = periodStart().toISOString();

  const [{ data: sends }, { data: ai }] = await Promise.all([
    db
      .from('usage_events')
      .select('kind, units, billed_cents, exempt')
      .eq('billing_user_id', billingUserId)
      .gte('created_at', since),
    db
      .from('ai_usage_events')
      .select('billed_micro, exempt')
      .eq('billing_user_id', billingUserId)
      .gte('created_at', since),
  ]);

  const out: MonthUsage = {
    email: { billed: emptyBucket(), exempt: emptyBucket() },
    sms: { billed: emptyBucket(), exempt: emptyBucket() },
    ai: { billedCents: 0, exemptCents: 0 },
  };

  for (const r of (sends ?? []) as {
    kind: string;
    units: number | null;
    billed_cents: number | null;
    exempt: boolean | null;
  }[]) {
    if (r.kind !== 'email' && r.kind !== 'sms') continue;
    const b = out[r.kind][r.exempt ? 'exempt' : 'billed'];
    b.units += Number(r.units || 0);
    b.cents += Number(r.billed_cents || 0);
  }

  for (const r of (ai ?? []) as { billed_micro: number | null; exempt: boolean | null }[]) {
    // micro-dollars -> cents
    const cents = Number(r.billed_micro || 0) / 10_000;
    if (r.exempt) out.ai.exemptCents += cents;
    else out.ai.billedCents += cents;
  }

  return out;
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default async function UsageBillingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/mixer/subscription');

  const { billingUserId, exempt } = await sendBilling(user.id);
  const isOwner = billingUserId === user.id;

  if (!isOwner) {
    return (
      <div className="px-4 md:px-8 py-8 md:py-12 max-w-4xl mx-auto">
        <Header />
        <div className="mt-8 rounded-2xl border border-white/10 bg-[#002838] p-6 text-white/70">
          Billing is handled by your club owner.
        </div>
      </div>
    );
  }

  const limitCents = await monthlyLimitCents(billingUserId);
  const [usage, hasCard, held] = await Promise.all([
    monthUsage(billingUserId),
    exempt ? Promise.resolve(false) : paygActive(getSupabaseAdmin(), billingUserId),
    heldCount(billingUserId),
  ]);

  const checkoutUrl =
    !exempt && !hasCard
      ? buildCheckoutUrl('ai_usage', { userId: billingUserId, email: user.email ?? null })
      : null;

  const billedTotal = usage.email.billed.cents + usage.sms.billed.cents + usage.ai.billedCents;
  const exemptTotal = usage.email.exempt.cents + usage.sms.exempt.cents + usage.ai.exemptCents;

  const monthLabel = new Date().toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <div className="px-4 md:px-8 py-8 md:py-12 max-w-4xl mx-auto">
      <Header />

      {/* Card status */}
      <div className="mt-8 rounded-2xl border border-white/10 bg-[#002838] p-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="text-white/50 text-sm">Card</div>
            {exempt ? (
              <div className="text-xl font-display text-white mt-1">
                Not needed — platform owner, nothing is billed
              </div>
            ) : hasCard ? (
              <div className="text-xl font-display text-white mt-1 flex items-center gap-2">
                <CheckCircle2 size={20} className="text-emerald-400" /> On file
              </div>
            ) : (
              <>
                <div className="text-xl font-display text-white mt-1">Not yet</div>
                <div className="text-sm text-white/50 mt-1 max-w-md">
                  ClubMode is free. Add a card before your club sends: emails sent until then
                  are saved and go out once it&apos;s on file; texts need the card first.
                </div>
              </>
            )}
          </div>
          {!exempt && hasCard && <ManagePlanButton />}
          {!exempt && !hasCard && (
            checkoutUrl ? (
              <SpendLimitForm mode="add-card" initialDollars={DEFAULT_MONTHLY_LIMIT_USD} checkoutUrl={checkoutUrl} />
            ) : (
              <div className="text-sm text-white/50 max-w-xs sm:text-right">
                Card setup isn&apos;t available right now. Please try again later.
              </div>
            )
          )}
        </div>
      </div>

      {/* Monthly spending limit */}
      {!exempt && hasCard && (
        <div className="mt-6 rounded-2xl border border-white/10 bg-[#002838] p-6">
          <div className="text-white/50 text-sm mb-3">
            {limitCents === null
              ? 'No monthly limit set.'
              : `Limit: $${(limitCents / 100).toFixed(0)} a month. Change it any time, including mid-month.`}
          </div>
          <SpendLimitForm mode="edit" initialDollars={limitCents === null ? null : Math.round(limitCents / 100)} />
        </div>
      )}

      {/* Held emails */}
      {held > 0 && (
        <div className="mt-4 rounded-2xl border border-yellow-300/30 bg-yellow-300/5 p-5 flex items-start gap-3">
          <Inbox size={20} className="text-yellow-300 flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-yellow-300 font-medium">
              {held} email{held === 1 ? '' : 's'} waiting to send
            </div>
            <div className="text-white/70 text-sm mt-1">
              {hasCard || exempt
                ? 'These will go out shortly.'
                : 'They go out as soon as you add a card.'}
            </div>
          </div>
        </div>
      )}

      {/* This month */}
      <div className="mt-8">
        <h2 className="font-display text-xl text-white mb-4">This month ({monthLabel})</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <UsageCard
            icon={Mail}
            color="text-blue-400"
            label="Emails sent"
            count={usage.email.billed.units + usage.email.exempt.units}
            rate={`${EMAIL_PRICE_CENTS}¢ each`}
            billedCents={usage.email.billed.cents}
            exemptCents={usage.email.exempt.cents}
          />
          <UsageCard
            icon={MessageSquare}
            color="text-emerald-400"
            label="Texts sent"
            count={usage.sms.billed.units + usage.sms.exempt.units}
            rate={`${TEXT_PRICE_CENTS}¢ each`}
            billedCents={usage.sms.billed.cents}
            exemptCents={usage.sms.exempt.cents}
          />
          <UsageCard
            icon={Sparkles}
            color="text-pink-400"
            label="Ask Claude"
            rate={`$${AI_MONTHLY_CAP_USD}/month cap`}
            billedCents={usage.ai.billedCents}
            exemptCents={usage.ai.exemptCents}
          />
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-[#002838] p-5 flex items-baseline justify-between gap-4">
          <div className="text-white/70">Total this month</div>
          <div className="text-right">
            <div className="text-2xl font-display text-white">{usd(billedTotal)}</div>
            {exemptTotal > 0 && (
              <div className="text-xs text-white/40 mt-0.5">
                + {usd(exemptTotal)} not billed (platform owner)
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 text-xs text-white/40">
          Billed monthly. The meter resets on the 1st (UTC).{' '}
          <Link href="/pricing" className="hover:text-white/70 underline">
            How pricing works
          </Link>
        </div>
      </div>
    </div>
  );
}

function Header() {
  return (
    <>
      <div className="flex items-center gap-3 mb-2">
        <CreditCard className="text-orange-400" size={24} />
        <h1 className="font-display text-3xl text-white">Usage &amp; billing</h1>
      </div>
      <p className="text-white/50">
        ClubMode is free. Your club pays only for the emails and texts it sends, and for Ask
        Claude.
      </p>
    </>
  );
}

function UsageCard({
  icon: Icon,
  color,
  label,
  count,
  rate,
  billedCents,
  exemptCents,
}: {
  icon: typeof Mail;
  color: string;
  label: string;
  count?: number;
  rate: string;
  billedCents: number;
  exemptCents: number;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#002838] p-4">
      <div className="flex items-center gap-2 text-white/60 text-sm">
        <Icon size={16} className={color} />
        <span>{label}</span>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        {count !== undefined && (
          <div className="text-2xl font-display text-white">{count.toLocaleString()}</div>
        )}
        <div className={count !== undefined ? 'text-white/60 text-sm' : 'text-2xl font-display text-white'}>
          {usd(billedCents)}
        </div>
      </div>
      <div className="mt-1 text-xs text-white/40">{rate}</div>
      {exemptCents > 0 && (
        <div className="mt-2 text-xs text-white/40">
          {usd(exemptCents)} not billed (platform owner)
        </div>
      )}
    </div>
  );
}

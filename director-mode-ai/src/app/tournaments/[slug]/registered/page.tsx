import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CheckCircle2, Trophy, Clock, CreditCard } from 'lucide-react';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export default async function RegisteredPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ entry?: string }>;
}) {
  const { slug } = await params;
  const { entry: entryId } = await searchParams;
  const supabase = getSupabaseAdmin();

  const { data: ev } = await supabase
    .from('events')
    .select('id, name, slug, entry_fee_cents, external_payment_url')
    .eq('slug', slug)
    .maybeSingle();
  if (!ev) return notFound();

  const { data: entry } = entryId
    ? await supabase
        .from('tournament_entries')
        .select('id, player_name, position, payment_status')
        .eq('id', entryId)
        .maybeSingle()
    : { data: null };

  const e: any = entry || {};
  const isWaitlist = e.position === 'waitlist';
  const isPending = e.position === 'pending_payment' || e.payment_status === 'pending';

  // When the tournament collects entry fees via an external link (PayPal/
  // Square/etc.) instead of Stripe, prompt the family to pay now.
  const evAny: any = ev;
  const feeLabel = evAny.entry_fee_cents > 0 ? `$${(evAny.entry_fee_cents / 100).toFixed(0)}` : '';
  const showExternalPay =
    !!evAny.external_payment_url && evAny.entry_fee_cents > 0 && !isWaitlist;

  return (
    <div className="min-h-screen bg-[#001820] text-white flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full bg-white text-gray-900 rounded-2xl p-8 text-center">
        {isPending || isWaitlist ? (
          <Clock size={48} className="text-amber-500 mx-auto mb-4" />
        ) : (
          <CheckCircle2 size={48} className="text-emerald-500 mx-auto mb-4" />
        )}
        <h1 className="text-2xl font-bold mb-2">
          {showExternalPay ? 'One more step' : isPending ? 'Almost there…' : isWaitlist ? "You're on the waitlist" : "You're in!"}
        </h1>
        <p className="text-gray-600 mb-6">
          {e.player_name
            ? `${e.player_name}, registered for ${(ev as any).name}.`
            : `Registered for ${(ev as any).name}.`}
        </p>

        {showExternalPay && (
          <div className="bg-emerald-50 border-2 border-emerald-200 rounded-xl p-4 mb-6 text-left">
            <p className="text-sm text-gray-800 mb-3">
              To complete registration, please pay the <b>{feeLabel} entry fee</b>. In the payment
              note, put <b>{e.player_name || 'the player'}&apos;s full name</b> and the division so we
              can match your payment.
            </p>
            <a
              href={evAny.external_payment_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg px-4 py-3"
            >
              <CreditCard size={18} /> Pay {feeLabel} entry fee →
            </a>
            <p className="text-[11px] text-gray-500 mt-2 text-center">
              A spot in the draw is held once your payment is received.
            </p>
          </div>
        )}
        {isWaitlist && (
          <p className="text-sm text-gray-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
            The tournament is full. We'll email you immediately if a spot opens up.
          </p>
        )}
        {isPending && !showExternalPay && (
          <p className="text-sm text-gray-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
            We're confirming your payment. You'll receive an email once it goes through.
          </p>
        )}
        <Link
          href={`/tournaments/${slug}`}
          className="inline-flex items-center gap-2 text-orange-600 hover:underline"
        >
          <Trophy size={16} /> Back to tournament page
        </Link>
      </div>
    </div>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CheckCircle2, Trophy, Clock } from 'lucide-react';
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
    .select('id, name, slug, event_date, max_players')
    .eq('slug', slug)
    .maybeSingle();
  if (!ev) return notFound();

  const { data: entry } = entryId
    ? await supabase
        .from('quad_entries')
        .select('id, player_name, position, payment_status')
        .eq('id', entryId)
        .maybeSingle()
    : { data: null };

  const e: any = entry || {};
  const isWaitlist = e.position === 'waitlist';
  const isPending = e.position === 'pending_payment' || e.payment_status === 'pending';

  return (
    <div className="min-h-screen bg-[#001820] text-white flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full bg-white text-gray-900 rounded-2xl p-8 text-center">
        {isPending ? (
          <Clock size={48} className="text-amber-500 mx-auto mb-4" />
        ) : isWaitlist ? (
          <Clock size={48} className="text-amber-500 mx-auto mb-4" />
        ) : (
          <CheckCircle2 size={48} className="text-emerald-500 mx-auto mb-4" />
        )}
        <h1 className="text-2xl font-bold mb-2">
          {isPending
            ? 'Almost there…'
            : isWaitlist
              ? "You're on the waitlist"
              : "You're in!"}
        </h1>
        <p className="text-gray-600 mb-6">
          {e.player_name
            ? `${e.player_name}, registered for ${(ev as any).name}.`
            : `Registered for ${(ev as any).name}.`}
        </p>
        {isWaitlist && (
          <p className="text-sm text-gray-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
            The tournament is full. We'll email you immediately if a spot opens up.
          </p>
        )}
        {isPending && (
          <p className="text-sm text-gray-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
            We're confirming your payment. You'll receive an email once it goes through.
          </p>
        )}
        <Link
          href={`/quads/${slug}`}
          className="inline-flex items-center gap-2 text-orange-600 hover:underline"
        >
          <Trophy size={16} /> Back to tournament page
        </Link>
      </div>
    </div>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CheckCircle2, Trophy, Clock, MailCheck } from 'lucide-react';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { parseDivisions, divisionLabel, PLAYERS_PER_QUAD } from '@/lib/quadDivisions';
import { getSponsor } from '@/config/sponsors';

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
    .select('id, name, slug, event_date, max_players, divisions, entry_fee_cents, sponsor_id')
    .eq('slug', slug)
    .maybeSingle();
  if (!ev) return notFound();
  const event = ev as any;
  const sponsor = getSponsor(event.sponsor_id);
  const accent = sponsor?.colors.primary ?? '#EA580C';

  const { data: entry } = entryId
    ? await supabase
        .from('quad_entries')
        .select('id, player_name, position, payment_status, division, registered_at')
        .eq('id', entryId)
        .maybeSingle()
    : { data: null };

  const e: any = entry || {};
  const divisions = parseDivisions(event.divisions);
  const divLabel = divisionLabel(divisions, e.division);

  // Where this player sits in their division's queue.
  let positionInLine: number | null = null;
  if (e.id && e.division) {
    const { count } = await supabase
      .from('quad_entries')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', event.id)
      .eq('division', e.division)
      .in('position', ['requested', 'pending_payment', 'in_flight'])
      .lte('registered_at', e.registered_at);
    positionInLine = count ?? null;
  }

  const isRequested = e.position === 'requested';
  const isPaid = e.payment_status === 'paid' || e.position === 'in_flight';
  const isWaitlist = e.position === 'waitlist';
  const isPending = !isRequested && !isPaid && e.position === 'pending_payment';
  const feeLabel = `$${((event.entry_fee_cents ?? 0) / 100).toFixed(0)}`;

  const heading = isRequested
    ? 'Request received'
    : isPaid
      ? "You're confirmed!"
      : isWaitlist
        ? "You're on the waitlist"
        : isPending
          ? 'Almost there…'
          : "You're in!";

  return (
    <div className="min-h-screen bg-[#001820] text-white flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full bg-white text-gray-900 rounded-2xl p-8 text-center">
        {isRequested ? (
          <MailCheck size={48} className="mx-auto mb-4" style={{ color: accent }} />
        ) : isPaid ? (
          <CheckCircle2 size={48} className="text-emerald-500 mx-auto mb-4" />
        ) : (
          <Clock size={48} className="text-amber-500 mx-auto mb-4" />
        )}

        <h1 className="text-2xl font-bold mb-2">{heading}</h1>
        <p className="text-gray-600 mb-6">
          {e.player_name
            ? `${e.player_name} — ${event.name}${e.division ? ` · ${divLabel}` : ''}.`
            : event.name}
        </p>

        {isRequested && (
          <div className="text-left text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4 space-y-2">
            {positionInLine !== null && (
              <p>
                You&rsquo;re <strong>#{positionInLine} in line</strong> for {divLabel}.{' '}
                {positionInLine <= PLAYERS_PER_QUAD
                  ? 'The first four get the spots.'
                  : "You're on the waitlist for now — divisions that don't fill get folded into ones that do, which often frees up spots."}
              </p>
            )}
            <p>
              <strong>Nothing has been charged.</strong> Once registration closes we&rsquo;ll email
              accepted players a payment link. You&rsquo;ll have <strong>24 hours</strong> to pay
              the {feeLabel} entry fee to lock in the spot.
            </p>
          </div>
        )}

        {isPaid && (
          <p className="text-sm text-gray-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3 mb-4">
            Payment received — your spot is locked in. We&rsquo;ll email your match schedule before
            the event.
          </p>
        )}

        {isWaitlist && (
          <p className="text-sm text-gray-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
            This one is full. We&rsquo;ll email you immediately if a spot opens up.
          </p>
        )}

        {isPending && (
          <p className="text-sm text-gray-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
            We&rsquo;re confirming your payment. You&rsquo;ll get an email as soon as it clears — if
            you closed the Square page before paying, use the link in your invitation email.
          </p>
        )}

        <Link
          href={`/quads/${slug}`}
          className="inline-flex items-center gap-2 hover:underline"
          style={{ color: accent }}
        >
          <Trophy size={16} /> Back to the event page
        </Link>
      </div>
    </div>
  );
}

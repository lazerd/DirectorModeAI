import { notFound } from 'next/navigation';
import Link from 'next/link';
import { format } from 'date-fns';
import { Trophy, Calendar, Users, AlertCircle } from 'lucide-react';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { quadScoringLabel } from '@/lib/quads';
import RegisterForm from './RegisterForm';

export const dynamic = 'force-dynamic';

const GENDER_LABELS: Record<string, string> = {
  boys: 'Boys only',
  girls: 'Girls only',
  coed: 'Coed (any gender)',
};

export default async function PublicQuadsLandingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ cancelled?: string }>;
}) {
  const { slug } = await params;
  const { cancelled } = await searchParams;
  const supabase = getSupabaseAdmin();

  const { data: ev } = await supabase
    .from('events')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();

  if (!ev || ev.match_format !== 'quads') return notFound();
  const e = ev as any;

  const now = Date.now();
  const opens = e.registration_opens_at ? new Date(e.registration_opens_at) : null;
  const closes = e.registration_closes_at ? new Date(e.registration_closes_at) : null;

  const closedReason =
    e.public_status === 'draft'
      ? 'This tournament is not yet published.'
      : e.public_status === 'closed'
        ? 'Registration has closed.'
        : e.public_status === 'running'
          ? 'Registration closed — the tournament is in progress.'
          : e.public_status === 'completed'
            ? 'This tournament has finished.'
            : e.public_status === 'cancelled'
              ? 'This tournament was cancelled.'
              : opens && opens.getTime() > now
                ? `Registration opens ${format(opens, 'MMM d, yyyy h:mm a')}.`
                : closes && closes.getTime() < now
                  ? `Registration closed ${format(closes, 'MMM d, yyyy h:mm a')}.`
                  : null;

  const { count: confirmedCount } = await supabase
    .from('quad_entries')
    .select('*', { count: 'exact', head: true })
    .eq('event_id', e.id)
    .in('position', ['in_flight']);

  const { count: waitlistCount } = await supabase
    .from('quad_entries')
    .select('*', { count: 'exact', head: true })
    .eq('event_id', e.id)
    .eq('position', 'waitlist');

  const spotsTotal = e.max_players ?? null;
  const spotsLeft = spotsTotal !== null ? Math.max(0, spotsTotal - (confirmedCount ?? 0)) : null;

  return (
    <div className="min-h-screen bg-[#001820] text-white">
      <header className="border-b border-white/10">
        <div className="max-w-3xl mx-auto px-4 py-6 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#D3FB52] flex items-center justify-center flex-shrink-0">
            <Trophy size={22} className="text-[#002838]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-white/40">CoachMode Quads</div>
            <h1 className="text-xl sm:text-2xl font-semibold truncate">{e.name}</h1>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {cancelled === '1' && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-sm text-amber-200 flex items-start gap-2">
            <AlertCircle size={16} className="mt-0.5" />
            Payment was cancelled. Your registration was not saved — feel free to try again.
          </div>
        )}

        <div className="grid sm:grid-cols-3 gap-3">
          <div className="bg-white/5 rounded-xl p-4">
            <div className="text-xs text-white/50 mb-1 flex items-center gap-1">
              <Calendar size={12} /> Date
            </div>
            <div className="font-semibold">
              {e.event_date ? format(new Date(e.event_date + 'T00:00:00'), 'MMM d, yyyy') : 'TBD'}
            </div>
            {e.start_time && <div className="text-sm text-white/60">{e.start_time}</div>}
          </div>
          <div className="bg-white/5 rounded-xl p-4">
            <div className="text-xs text-white/50 mb-1 flex items-center gap-1">
              <Users size={12} /> Eligibility
            </div>
            <div className="font-semibold">
              {e.age_max ? `${e.age_max} & Under` : 'Open age'}
            </div>
            <div className="text-sm text-white/60">{GENDER_LABELS[e.gender_restriction] ?? 'Coed'}</div>
          </div>
          <div className="bg-white/5 rounded-xl p-4">
            <div className="text-xs text-white/50 mb-1">Entry Fee</div>
            <div className="font-semibold">
              {e.entry_fee_cents > 0 ? `$${(e.entry_fee_cents / 100).toFixed(0)}` : 'Free'}
            </div>
            {spotsLeft !== null && (
              <div className="text-sm text-white/60">
                {spotsLeft} of {spotsTotal} spots left
              </div>
            )}
          </div>
        </div>

        <div className="bg-white/5 rounded-xl p-5 space-y-2 text-sm text-white/80">
          <div className="font-semibold text-white">Format: Quads</div>
          <p>
            Players are grouped into flights of 4 by skill (UTR/NTRP). Each flight plays a 3-round
            singles round-robin, then a 4th-round doubles match where the 1st-place finisher pairs
            with 4th place to play 2nd & 3rd.
          </p>
          <p className="text-white/60">
            Match scoring:{' '}
            <span className="text-white">
              {quadScoringLabel(e.event_scoring_format) || 'Director will announce'}
            </span>
          </p>
          {(waitlistCount ?? 0) > 0 && (
            <p className="text-amber-200">
              Waitlist: {waitlistCount} player{waitlistCount === 1 ? '' : 's'}. Registering now will
              add you to the waitlist.
            </p>
          )}
        </div>

        {closedReason ? (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 text-amber-200 flex items-start gap-2">
            <AlertCircle size={18} className="mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-semibold">Registration unavailable</p>
              <p className="text-sm">{closedReason}</p>
            </div>
          </div>
        ) : (
          <div className="bg-white text-gray-900 rounded-2xl p-5 sm:p-6">
            <h2 className="font-semibold text-lg mb-4">Register</h2>
            <RegisterForm
              slug={e.slug}
              feeCents={e.entry_fee_cents ?? 0}
              ageMax={e.age_max}
              genderRestriction={e.gender_restriction}
            />
            <p className="text-xs text-gray-500 mt-3">
              By registering you agree to receive emails about this tournament. You can unsubscribe
              at any time.
            </p>
          </div>
        )}

        <div className="text-center text-xs text-white/40">
          <Link href="/" className="hover:text-white/60">
            Powered by CoachMode
          </Link>
        </div>
      </main>
    </div>
  );
}

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { format } from 'date-fns';
import { Trophy, Calendar, Users, AlertCircle } from 'lucide-react';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { quadScoringLabel } from '@/lib/quads';
import { parseDivisions, PLAYERS_PER_QUAD } from '@/lib/quadDivisions';
import { getSponsor } from '@/config/sponsors';
import SponsoredQuadLanding, {
  type SiblingDate,
  type DivisionStatus,
} from '@/components/quads/SponsoredQuadLanding';
import RegisterForm from './RegisterForm';

export const dynamic = 'force-dynamic';

const GENDER_LABELS: Record<string, string> = {
  boys: 'Boys only',
  girls: 'Girls only',
  coed: 'Coed (any gender)',
};

/** Positions that count as holding a place in line for a division. */
const IN_LINE = ['requested', 'pending_payment', 'in_flight'];

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

  const { data: ev } = await supabase.from('events').select('*').eq('slug', slug).maybeSingle();

  // A series slug (e.g. /quads/dunkin-quads) is a permanent link that lands on
  // whichever date in the series is next up — so flyers never go stale.
  if (!ev) {
    const { data: seriesEvents } = await supabase
      .from('events')
      .select('slug, event_date, public_status')
      .eq('series_slug', slug)
      .order('event_date');
    const list = (seriesEvents as any[]) || [];
    if (list.length > 0) {
      const today = new Date().toISOString().slice(0, 10);
      const next =
        list.find((x) => x.event_date >= today && x.public_status === 'open') ??
        list.find((x) => x.event_date >= today) ??
        list[0];
      redirect(`/quads/${next.slug}`);
    }
    return notFound();
  }

  if ((ev as any).match_format !== 'quads') return notFound();
  const e = ev as any;

  const now = Date.now();
  const opens = e.registration_opens_at ? new Date(e.registration_opens_at) : null;
  const closes = e.registration_closes_at ? new Date(e.registration_closes_at) : null;

  const closedReason =
    e.public_status === 'draft'
      ? 'This event is not yet published.'
      : e.public_status === 'closed'
        ? 'Registration has closed.'
        : e.public_status === 'running'
          ? 'Registration closed — the event is in progress.'
          : e.public_status === 'completed'
            ? 'This event has finished.'
            : e.public_status === 'cancelled'
              ? 'This event was cancelled.'
              : opens && opens.getTime() > now
                ? `Registration opens ${format(opens, 'MMM d, yyyy h:mm a')}.`
                : closes && closes.getTime() < now
                  ? `Registration closed ${format(closes, 'MMM d, yyyy h:mm a')}.`
                  : null;

  const divisions = parseDivisions(e.divisions);

  // One read of every live entry, then count in memory — cheaper than a query
  // per division, and it gives us the waitlist numbers for free.
  const { data: entryRows } = await supabase
    .from('quad_entries')
    .select('id, division, position')
    .eq('event_id', e.id)
    .in('position', [...IN_LINE, 'waitlist']);
  const liveEntries = (entryRows as any[]) || [];

  const inLineCount = liveEntries.filter((x) => IN_LINE.includes(x.position)).length;
  const waitlistCount = liveEntries.filter((x) => x.position === 'waitlist').length;

  const divisionStatus: DivisionStatus[] = divisions.map((d) => {
    const inLine = liveEntries.filter(
      (x) => x.division === d.id && IN_LINE.includes(x.position)
    ).length;
    return {
      ...d,
      inLine,
      spotsLeft: Math.max(0, PLAYERS_PER_QUAD - inLine),
      waiting: Math.max(0, inLine - PLAYERS_PER_QUAD),
    };
  });

  const spotsTotal = e.max_players ?? null;
  const spotsLeft = spotsTotal !== null ? Math.max(0, spotsTotal - inLineCount) : null;

  // Other dates in this series, for the date switcher.
  let siblings: SiblingDate[] = [];
  if (e.series_slug) {
    const { data: sibRows } = await supabase
      .from('events')
      .select('slug, event_date, public_status')
      .eq('series_slug', e.series_slug)
      .order('event_date');
    siblings = ((sibRows as any[]) || []).map((s) => ({
      slug: s.slug,
      eventDate: s.event_date,
      isCurrent: s.slug === e.slug,
      isOpen: s.public_status === 'open',
    }));
  }

  // Sponsored events get the sponsor's own branded page (src/config/sponsors.ts).
  const sponsor = getSponsor(e.sponsor_id);
  if (sponsor) {
    return (
      <SponsoredQuadLanding
        event={e}
        sponsor={sponsor}
        spotsLeft={spotsLeft}
        spotsTotal={spotsTotal}
        waitlistCount={waitlistCount}
        closedReason={closedReason}
        cancelled={cancelled === '1'}
        divisions={divisionStatus}
        siblings={siblings}
      />
    );
  }

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
            <div className="font-semibold">{e.age_max ? `${e.age_max} & Under` : 'Open age'}</div>
            <div className="text-sm text-white/60">
              {GENDER_LABELS[e.gender_restriction] ?? 'Coed'}
            </div>
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
            with 4th place to play 2nd &amp; 3rd. Most games won across all four rounds takes the
            quad.
          </p>
          <p className="text-white/60">
            Match scoring:{' '}
            <span className="text-white">
              {quadScoringLabel(e.event_scoring_format) || 'Director will announce'}
            </span>
          </p>
          {waitlistCount > 0 && (
            <p className="text-amber-200">
              Waitlist: {waitlistCount} player{waitlistCount === 1 ? '' : 's'}.
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
              divisions={divisionStatus}
              eventDate={e.event_date}
              requestMode={e.entry_flow === 'request_then_invite'}
            />
            <p className="text-xs text-gray-500 mt-3">
              By registering you agree to receive emails about this event. You can unsubscribe at
              any time.
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

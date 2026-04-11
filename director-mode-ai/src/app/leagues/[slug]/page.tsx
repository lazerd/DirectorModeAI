import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Trophy, Calendar, AlertCircle, GitBranch, ArrowRight } from 'lucide-react';
import { format } from 'date-fns';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { CATEGORY_LABELS, CATEGORY_ORDER, formatMoney, type CategoryKey } from '@/lib/leagueUtils';
import RegisterForm from './RegisterForm';

// This page is public — no auth required.
export const dynamic = 'force-dynamic';

export default async function PublicLeaguePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = getSupabaseAdmin();

  const { data: league } = await supabase
    .from('leagues')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();

  if (!league) return notFound();

  const { data: categories } = await supabase
    .from('league_categories')
    .select('id, category_key, entry_fee_cents, is_enabled')
    .eq('league_id', (league as any).id)
    .eq('is_enabled', true);

  const l = league as any;
  const status = l.status as string;
  const now = new Date();
  const opens = l.registration_opens_at ? new Date(l.registration_opens_at) : null;
  const closes = l.registration_closes_at ? new Date(l.registration_closes_at) : null;

  const registrationClosed =
    status !== 'open' ||
    (opens && now < opens) ||
    (closes && now > closes);

  const closedReason =
    status === 'draft' ? 'This league is not yet published.' :
    status === 'closed' ? 'Registration has closed.' :
    status === 'running' ? 'Registration closed — the league is already in progress.' :
    status === 'completed' ? 'This league has finished.' :
    status === 'cancelled' ? 'This league was cancelled.' :
    opens && now < opens ? `Registration opens ${format(opens, 'MMM d, yyyy h:mm a')}.` :
    closes && now > closes ? `Registration closed ${format(closes, 'MMM d, yyyy h:mm a')}.` :
    null;

  // Order categories by the standard order
  const sortedCategories = (categories || []).slice().sort((a: any, b: any) =>
    CATEGORY_ORDER.indexOf(a.category_key) - CATEGORY_ORDER.indexOf(b.category_key)
  );

  return (
    <div className="min-h-screen bg-[#001820] text-white">
      {/* Header */}
      <header className="border-b border-white/10">
        <div className="max-w-3xl mx-auto px-4 py-6 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#D3FB52] flex items-center justify-center flex-shrink-0">
            <Trophy size={22} className="text-[#002838]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-white/40">CoachMode Leagues</div>
            <h1 className="font-display text-xl truncate">{l.name}</h1>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 sm:py-8">
        {/* Live bracket CTA — shown prominently when the league is running or
            done, since the whole point of the public page at that stage is
            to see the compass draw, not the registration form. */}
        {(l.status === 'running' || l.status === 'completed') && (
          <Link
            href={`/leagues/${l.slug}/bracket`}
            className="group block mb-6 rounded-xl border border-[#D3FB52]/40 bg-gradient-to-br from-[#D3FB52]/15 to-[#D3FB52]/5 px-5 py-4 hover:border-[#D3FB52] hover:from-[#D3FB52]/25 transition-colors"
          >
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl bg-[#D3FB52] flex items-center justify-center flex-shrink-0">
                <GitBranch size={20} className="text-[#002838]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[#D3FB52] text-base leading-tight">
                  {l.status === 'running' ? 'View the live bracket' : 'View final results'}
                </div>
                <div className="text-xs text-white/50 mt-0.5">
                  {l.status === 'running'
                    ? 'Compass draw, standings, and match results — updated as scores come in.'
                    : 'Final placements, full bracket tree, and match history.'}
                </div>
              </div>
              <ArrowRight size={18} className="text-[#D3FB52] flex-shrink-0 group-hover:translate-x-0.5 transition-transform" />
            </div>
          </Link>
        )}

        {/* Hero block */}
        <section className="bg-white/5 border border-white/10 rounded-xl p-5 sm:p-6 mb-6">
          <div className="flex items-start gap-2 text-sm text-white/60 mb-3">
            <Calendar size={16} className="mt-0.5 flex-shrink-0" />
            <span>
              {format(new Date(l.start_date), 'MMMM d, yyyy')} –{' '}
              {format(new Date(l.end_date), 'MMMM d, yyyy')}
            </span>
          </div>
          {l.description && (
            <p className="text-white/80 text-sm whitespace-pre-wrap">{l.description}</p>
          )}

          <div className="mt-5 pt-5 border-t border-white/10">
            <h3 className="text-xs uppercase tracking-wide text-white/40 mb-3">Format</h3>
            <p className="text-sm text-white/70">
              Compass draw — every player plays <strong className="text-white">4 matches</strong> (or 3 in
              an 8-player flight), one every 2 weeks, and gets ranked through their bracket. No early
              eliminations, every match counts.
            </p>
          </div>
        </section>

        {/* Registration form OR closed notice */}
        {registrationClosed ? (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-5 flex items-start gap-3">
            <AlertCircle size={20} className="text-red-400 mt-0.5 flex-shrink-0" />
            <div>
              <div className="font-medium text-red-300 mb-1">Registration is closed</div>
              <div className="text-sm text-red-200/80">{closedReason}</div>
            </div>
          </div>
        ) : sortedCategories.length === 0 ? (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-5 text-yellow-200 text-sm">
            No categories have been set up for this league yet.
          </div>
        ) : (
          <RegisterForm
            leagueSlug={l.slug}
            leagueName={l.name}
            categories={sortedCategories.map((c: any) => ({
              id: c.id,
              key: c.category_key as CategoryKey,
              label: CATEGORY_LABELS[c.category_key as CategoryKey],
              feeCents: c.entry_fee_cents,
              feeLabel: formatMoney(c.entry_fee_cents),
            }))}
            paymentRails={{
              venmo: l.venmo_handle,
              zelle: l.zelle_handle,
              stripe: l.stripe_payment_link,
            }}
          />
        )}

        <div className="text-center text-xs text-white/30 mt-8 py-6 border-t border-white/10">
          Powered by <Link href="/" className="text-[#D3FB52] hover:underline">CoachMode AI</Link>
        </div>
      </main>
    </div>
  );
}

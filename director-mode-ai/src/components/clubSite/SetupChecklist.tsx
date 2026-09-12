/**
 * "Finish your site" — the unfinished work, addressed to the club.
 *
 * Renders NOTHING once a club is done. That is the contract: a checklist that
 * always has something on it is a permanent nag, people stop reading it, and
 * they go back to messaging whoever set the site up — which is the outcome
 * this whole feature exists to prevent.
 *
 * Every item carries a count and a link to the exact screen, plus (where one
 * makes sense) the sentence to say to the assistant instead of finding the
 * screen at all. A payment URL or a photo cannot be dictated, so those offer
 * no sentence rather than pretending.
 */

import Link from 'next/link';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { isPaymentLink } from '@/config/payments';
import { setupTasks, type SetupSnapshot, type SetupTask } from '@/lib/clubSite/setup';

export async function getSetupSnapshot(clubId: string): Promise<SetupSnapshot | null> {
  const db = getSupabaseAdmin();

  const [{ data: site }, { data: programs }, { data: payments }, { data: rates }] =
    await Promise.all([
      db
        .from('club_site')
        .select('status, hero_image_url, staff, partner_links, documents')
        .eq('club_id', clubId)
        .maybeSingle(),
      db.from('club_programs').select('status, price_cents').eq('club_id', clubId),
      db.from('club_payments').select('payment_link').eq('club_id', clubId).maybeSingle(),
      db
        .from('court_rate_cards')
        .select('price_cents')
        .eq('club_id', clubId)
        .eq('active', true),
    ]);

  // No site row means they have never opened the editor — there is nothing to
  // be "unfinished" about yet, and the editor itself is the prompt.
  if (!site) return null;

  const s = site as {
    status: string;
    hero_image_url: string | null;
    staff: unknown[] | null;
    partner_links: { href?: string | null }[] | null;
    documents: { href?: string | null }[] | null;
  };
  const rows = (programs as { status: string; price_cents: number | null }[] | null) ?? [];
  const published = rows.filter((p) => p.status === 'published');
  const rateRows = (rates as { price_cents: number }[] | null) ?? [];

  const link = ((payments as { payment_link?: string | null } | null)?.payment_link || '').trim();
  const haveCheckout = isPaymentLink(link);
  const sellingSomething =
    rateRows.some((r) => r.price_cents > 0) ||
    published.some((p) => (p.price_cents ?? 0) > 0);

  return {
    siteStatus: s.status,
    publishedClasses: published.length,
    draftClasses: rows.filter((p) => p.status === 'draft').length,
    // Only PUBLISHED ones: a draft with no price is a work in progress, not a
    // public page telling people to ring up and ask.
    unpricedPublishedClasses: published.filter((p) => p.price_cents == null).length,
    partnersWithoutUrl: (s.partner_links ?? []).filter((p) => !p.href).length,
    documentsWithoutFile: (s.documents ?? []).filter((d) => !d.href).length,
    staffCount: (s.staff ?? []).length,
    chargingWithNoCheckout: sellingSomething && !haveCheckout,
    hasHeroImage: !!s.hero_image_url,
    hasCourtRates: rateRows.length > 0,
  };
}

const TONE: Record<SetupTask['severity'], { dot: string; ring: string }> = {
  money: { dot: 'bg-red-400', ring: 'border-red-400/30 bg-red-400/[0.06]' },
  public: { dot: 'bg-amber-300', ring: 'border-amber-300/25 bg-amber-300/[0.05]' },
  polish: { dot: 'bg-white/30', ring: 'border-white/10 bg-white/[0.03]' },
};

export default async function SetupChecklist({ clubId }: { clubId: string }) {
  const snapshot = await getSetupSnapshot(clubId);
  if (!snapshot) return null;

  const tasks = setupTasks(snapshot);
  if (tasks.length === 0) return null;

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <h2 className="font-display text-xl text-white">Finish your site</h2>
      <p className="mt-1 text-sm text-white/50">
        {tasks.length === 1
          ? 'One thing left.'
          : `${tasks.length} things left — the ones costing you money are first.`}{' '}
        This list disappears when it is done.
      </p>

      <ul className="mt-4 space-y-2.5">
        {tasks.map((t) => {
          const tone = TONE[t.severity];
          return (
            <li key={t.id} className={`rounded-xl border p-3.5 ${tone.ring}`}>
              <div className="flex items-start gap-2.5">
                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} />
                <div className="min-w-0 flex-1">
                  <Link href={t.href} className="font-semibold text-white hover:underline">
                    {t.title}
                  </Link>
                  <p className="mt-0.5 text-sm leading-snug text-white/55">{t.detail}</p>
                  {t.ask && (
                    /*
                      The alternative to finding the screen. Shown as the actual
                      words to say, because "you can ask the assistant" teaches
                      nobody what it will understand.
                    */
                    <p className="mt-2 text-xs text-white/40">
                      Or say to the assistant:{' '}
                      <span className="rounded bg-white/[0.07] px-1.5 py-0.5 font-medium text-white/70">
                        {t.ask}
                      </span>
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

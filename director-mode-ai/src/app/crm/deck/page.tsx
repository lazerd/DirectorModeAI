/**
 * /crm/deck — the morning's cold emails, one card at a time.
 *
 * The rule this whole page exists to enforce: nothing sends without a right
 * swipe. The card IS the email — the same text compose() will hand to Resend,
 * signature and opt-out line included — so what Darrin approves is what the
 * club president reads. There is no "send all", there is no bulk action, and
 * there is no way to reach the sender from this screen.
 *
 * Rendered fresh on every request. A deck that shows a card somebody already
 * swiped on is worse than an empty deck.
 */
import Link from 'next/link';
import { requireCrmForPage } from '@/lib/crm/server';
import { loadDeck } from '@/lib/outreach/deck';
import Deck from './Deck';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Deck',
  robots: { index: false, follow: false },
};

export default async function DeckPage() {
  const ctx = await requireCrmForPage('/crm/deck');
  const payload = await loadDeck(ctx.db, ctx.repEmail);

  return (
    // pb-36 on a phone leaves room under the sticky action bar and the app's
    // own fixed "Ask ClubMode" button; neither may cover the last line.
    <div className="min-h-screen bg-[#001820] px-4 pb-36 pt-20 text-white sm:px-6 sm:pb-12 md:pt-8">
      <div className="mx-auto max-w-[620px]">
        <header className="flex items-baseline justify-between gap-3">
          <h1 className="font-display text-2xl text-white">Today&rsquo;s deck</h1>
          <Link href="/crm" className="text-sm text-white/45 underline-offset-4 hover:text-white/70 hover:underline">
            Pipeline
          </Link>
        </header>
        <Deck initial={payload} repName={ctx.repName} />
      </div>
    </div>
  );
}

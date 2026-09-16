import Link from 'next/link';
import { requireCrmForPage } from '@/lib/crm/server';
import {
  loadContactIndex,
  loadDeckCount,
  loadPipeline,
  loadReps,
  splitDeals,
  toColdRows,
} from '@/lib/crm/load';
import { buildPipeline, money } from '@/lib/crm/insights';
import { buildToday } from '@/lib/crm/today';
import { regionsPresent } from '@/lib/crm/region';
import CrmWorkspace from './CrmWorkspace';

/**
 * /crm — the working tool.
 *
 * Private to the two people who sell ClubMode. Not in the nav for anyone else,
 * not discoverable, and a 404 to everybody but them (lib/crm/server.ts).
 *
 * Three views, in this order: what to do today, the handful of live deals, and
 * the 519 cold clubs from the Directors Club import. The first version put all
 * 522 on one board, which was a picture of the data rather than a way to work
 * it. Above all of it is the ask box, because "which West clubs have no
 * contact?" is a question, not a filter combination worth hunting for.
 *
 * Rendered fresh on every request: a deal board showing yesterday's stage is
 * worse than no board.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Pipeline',
  // It is behind a 404 already; this keeps it out of an index if a signed-in
  // crawler ever gets a session, and out of the app's own sitemap.
  robots: { index: false, follow: false },
};

export default async function CrmPage() {
  const ctx = await requireCrmForPage('/crm');
  const [orgs, reps, contactsByOrg, deckQueued] = await Promise.all([
    loadPipeline(ctx.db),
    loadReps(ctx.db),
    loadContactIndex(ctx.db),
    // Null when the outreach deck's tables are not there yet. Today hides the
    // line rather than claiming an empty deck.
    loadDeckCount(ctx.db),
  ]);

  const { live, cold } = splitDeals(orgs);
  const pipeline = buildPipeline(live, ctx.today);
  const coldRows = toColdRows(cold, contactsByOrg);
  const queuedForOutreach = orgs.filter((o) => o.queued_at).length;
  const todayList = buildToday(live, ctx.today, deckQueued, queuedForOutreach);
  const noContact = orgs.filter((o) => o.contact_count === 0).length;

  return (
    <div className="min-h-screen bg-[#001820] px-4 pb-10 pt-20 text-white sm:px-6 md:px-10 md:pt-8">
      <div className="mx-auto max-w-[1400px]">
        <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h1 className="font-display text-2xl text-white sm:text-3xl">Pipeline</h1>
            <p className="mt-1 text-sm text-white/45">
              {live.length} live · {money(pipeline.valueCents)}/mo if they all say yes ·{' '}
              {cold.length.toLocaleString('en-US')} cold · {noContact} with nobody on file
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {/*
              THE OUTREACH DECK'S SPOT. /crm/deck and its crm_outreach_* tables
              are being built alongside this; the link is here so the deck has
              a door the day it lands, and it is the only thing in this file
              that knows the deck exists. Nothing else to add here.
            */}
            <Link
              href="/crm/deck"
              className="rounded-lg border border-white/15 px-3 py-2 text-sm font-medium text-white/70 hover:border-[#D3FB52]/50 hover:text-white"
            >
              Today&rsquo;s emails
            </Link>
            <Link
              href="/crm/new"
              className="rounded-lg bg-[#D3FB52] px-4 py-2 text-sm font-semibold text-[#001820]"
            >
              Add a club
            </Link>
          </div>
        </header>

        {orgs.length === 0 ? (
          <p className="mt-10 text-white/40">
            Nothing in the pipeline yet.{' '}
            <Link href="/crm/new" className="text-[#D3FB52] hover:underline">
              Add the first club
            </Link>
            .
          </p>
        ) : (
          <CrmWorkspace
            today={todayList}
            todayDate={ctx.today}
            live={live}
            cold={coldRows}
            regions={regionsPresent(cold)}
            reps={reps}
            byStage={pipeline.byStage.map(({ stage, count }) => ({ stage, count }))}
          />
        )}
      </div>
    </div>
  );
}

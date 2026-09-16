import Link from 'next/link';
import { requireCrmForPage } from '@/lib/crm/server';
import { loadPipeline } from '@/lib/crm/load';
import { buildPipeline, money } from '@/lib/crm/insights';
import PipelineBoard from './PipelineBoard';

/**
 * /crm — the pipeline.
 *
 * Private to the two people who sell ClubMode. Not in the nav for anyone else,
 * not discoverable, and a 404 to everybody but them (lib/crm/server.ts).
 *
 * Rendered fresh on every request: a deal board that shows yesterday's stage
 * is worse than no board, and there are three rows.
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
  const orgs = await loadPipeline(ctx.db);
  const pipeline = buildPipeline(orgs, ctx.today);

  return (
    <div className="min-h-screen bg-[#001820] px-4 py-6 text-white sm:px-6 md:px-10">
      <div className="mx-auto max-w-[1400px]">
        <header className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl text-white sm:text-3xl">Pipeline</h1>
            <p className="mt-1 text-sm text-white/45">
              {pipeline.open.length} open · {money(pipeline.valueCents)}/mo if they all say yes ·{' '}
              {pipeline.wonCount} won · {pipeline.lostCount} lost
            </p>
          </div>
          <Link
            href="/crm/new"
            className="rounded-lg bg-[#D3FB52] px-4 py-2 text-sm font-semibold text-[#001820]"
          >
            Add a club
          </Link>
        </header>

        {/*
          What to do today, before the board.

          The board is a picture of the work; these sentences are the work. A
          rep opening this between lessons should be able to act on the first
          line without scrolling. Renders nothing when there is nothing.
        */}
        {pipeline.nudges.length > 0 && (
          <ul className="mt-6 space-y-1.5">
            {pipeline.nudges.map((n, i) => {
              const dot =
                n.tone === 'late' ? 'bg-red-400' : n.tone === 'today' ? 'bg-[#D3FB52]' : 'bg-white/30';
              const row = (
                <span className="flex items-start gap-2.5">
                  <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
                  <span className={n.tone === 'late' ? 'text-red-200' : 'text-white/80'}>{n.text}</span>
                </span>
              );
              return (
                <li key={i} className="text-sm">
                  {n.orgId ? (
                    <Link href={`/crm/${n.orgId}`} className="block rounded py-0.5 hover:text-white">
                      {row}
                    </Link>
                  ) : (
                    <span className="block py-0.5">{row}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {orgs.length === 0 ? (
          <p className="mt-10 text-white/40">
            Nothing in the pipeline yet.{' '}
            <Link href="/crm/new" className="text-[#D3FB52] hover:underline">
              Add the first club
            </Link>
            .
          </p>
        ) : (
          <div className="mt-8">
            <PipelineBoard
              orgs={orgs}
              today={ctx.today}
              byStage={pipeline.byStage.map(({ stage, count }) => ({ stage, count }))}
            />
          </div>
        )}
      </div>
    </div>
  );
}

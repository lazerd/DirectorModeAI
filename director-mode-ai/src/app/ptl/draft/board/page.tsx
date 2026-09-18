/**
 * The public draft board.
 *
 * Deliberately a static segment, which Next resolves ahead of the sibling
 * [token] route — so /ptl/draft/board is the board and never a captain called
 * "board".
 *
 * Public and unauthenticated on purpose: this is the screen projected in the
 * room, and it is also the link a player who isn't a captain opens to watch
 * themselves get drafted. It shows only picks and teams, never the pool or
 * anybody's queue.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import DraftBoard from '@/components/ptl/DraftBoard';
import { DemoRibbon } from '@/components/ptl/DemoRibbon';
import {
  getDraftForSeason,
  getDraftState,
  getPicks,
  getSeason,
  getTeams,
} from '@/lib/ptl/server';

export const dynamic = 'force-dynamic';

export default async function DraftBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const { season: slug } = await searchParams;
  const season = await getSeason(slug);
  if (!season) notFound();

  const draft = await getDraftForSeason(season.id);
  if (!draft) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-24 text-center">
        <h1 className="text-3xl font-black tracking-tight">No draft yet</h1>
        <p className="mt-3 text-white/55">
          {season.name} hasn&rsquo;t reached its draft. The board lights up the moment the
          commissioner starts it.
        </p>
        <Link
          href={`/ptl?season=${season.slug}`}
          className="mt-8 inline-block rounded-sm border border-white/25 px-6 py-3 font-semibold text-white/85 hover:border-white/50 hover:text-white"
        >
          Back to the league
        </Link>
      </div>
    );
  }

  const state = await getDraftState(draft.id);
  if (!state) notFound();

  const [picks, teams] = await Promise.all([getPicks(draft.id), getTeams(season.id)]);

  return (
    <>
      {season.is_demo && <DemoRibbon note={season.demo_note} />}
      <DraftBoard
        draftId={draft.id}
        seasonName={season.name}
        initial={{
          state,
          picks,
          teams: teams.map((t) => ({
            id: t.id,
            name: t.name,
            shortCode: t.short_code,
            color: t.color,
            draftSlot: t.draft_slot,
            captainName: t.captain_name,
          })),
          // The board never sees the pool or a queue — it reads picks only.
          pool: [],
          queue: [],
          you: null,
        }}
      />
    </>
  );
}

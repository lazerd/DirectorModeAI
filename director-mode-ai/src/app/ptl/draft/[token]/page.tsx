/**
 * A captain's draft room, reached by token.
 *
 * The token IS the credential — no login, because PTL captains come from a
 * dozen clubs and most will never have a ClubMode account. Same pattern as
 * /captain/availability/[token], and the reason /ptl/admin is the only PTL
 * path in middleware's protectedPaths: a startsWith('/ptl') rule would bounce
 * captains to a login screen on draft night.
 *
 * Server does the first paint so the room is populated before any JavaScript
 * runs; DraftRoom takes it from there over the socket.
 */

import { notFound } from 'next/navigation';
import DraftRoom from '@/components/ptl/DraftRoom';
import { DemoRibbon } from '@/components/ptl/DemoRibbon';
import {
  getAvailablePool,
  getDraftState,
  getPicks,
  getQueue,
  getTeamByToken,
  getTeams,
} from '@/lib/ptl/server';

export const dynamic = 'force-dynamic';
// A draft room is a private working surface, not something to be indexed.
export const metadata = { robots: { index: false, follow: false } };

export default async function DraftRoomPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const resolved = await getTeamByToken(token);
  if (!resolved?.draftId) notFound();

  const { team, season, draftId } = resolved;
  const state = await getDraftState(draftId);
  if (!state) notFound();

  const [picks, teams, pool, queue] = await Promise.all([
    getPicks(draftId),
    getTeams(season.id),
    getAvailablePool(season.id),
    getQueue(draftId, team.id),
  ]);

  return (
    <>
      {season.is_demo && <DemoRibbon note={season.demo_note} />}
      <DraftRoom
        token={token}
        teamName={team.name}
        seasonName={season.name}
        rosterSize={season.roster_size}
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
          pool,
          queue,
          you: team.id,
        }}
      />
    </>
  );
}

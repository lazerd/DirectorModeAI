/**
 * POST/DELETE /api/leagues/matches/[matchId]/admin-report
 *
 * Director-only score entry + clearing for any match in one of the director's
 * leagues. Authenticates via the Supabase session (not a magic-link token)
 * and goes straight to 'confirmed' on POST (no 24h dispute window since the
 * director is vouching for the score).
 *
 *   POST   body { score, winnerEntryId }  → record/edit a result
 *   DELETE                                → clear a result back to pending
 *
 * Edit/delete guard: if the match's current winner or loser has already
 * advanced into one or more later-round matches, both POST (when changing
 * the winner) and DELETE return 409 with a list of downstream matches so
 * the director can clean those up first.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import {
  progressMatchOnConfirm,
  sendRoundMatchEmails,
  findDownstreamMatches,
  describeDownstream,
} from '@/lib/leagueProgression';

/**
 * Shared auth + load: returns the match + verifies the caller owns the
 * parent league, or a NextResponse error to short-circuit the handler.
 */
async function loadAndAuthorize(matchId: string) {
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) {
    return {
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    } as const;
  }

  const admin = getSupabaseAdmin();

  const { data: match } = await admin
    .from('league_matches')
    .select('*')
    .eq('id', matchId)
    .maybeSingle();
  if (!match) {
    return {
      error: NextResponse.json({ error: 'Match not found' }, { status: 404 }),
    } as const;
  }

  const { data: flight } = await admin
    .from('league_flights')
    .select('league_id')
    .eq('id', (match as any).flight_id)
    .maybeSingle();
  if (!flight) {
    return {
      error: NextResponse.json({ error: 'Flight not found' }, { status: 404 }),
    } as const;
  }

  const { data: league } = await admin
    .from('leagues')
    .select('director_id')
    .eq('id', (flight as any).league_id)
    .maybeSingle();
  if (!league || (league as any).director_id !== user.id) {
    return {
      error: NextResponse.json({ error: 'Not authorized' }, { status: 403 }),
    } as const;
  }

  return { admin, match: match as any, user } as const;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ matchId: string }> }
) {
  try {
    const { matchId } = await params;
    const loaded = await loadAndAuthorize(matchId);
    if ('error' in loaded) return loaded.error;
    const { admin, match } = loaded;

    const body = await request.json().catch(() => ({}));
    const score = typeof body?.score === 'string' ? body.score.trim().slice(0, 64) : '';
    const winnerEntryId = typeof body?.winnerEntryId === 'string' ? body.winnerEntryId : '';

    if (!score) return NextResponse.json({ error: 'Score is required' }, { status: 400 });
    if (!winnerEntryId) return NextResponse.json({ error: 'Winner is required' }, { status: 400 });
    if (winnerEntryId !== match.entry_a_id && winnerEntryId !== match.entry_b_id) {
      return NextResponse.json({ error: 'Winner must be one of the two teams' }, { status: 400 });
    }

    // Downstream guard: if this match already has a winner that has advanced
    // to later rounds AND the admin is changing the winner, refuse. Score-only
    // edits (same winner, different score string) are always allowed because
    // nothing downstream needs to change.
    const isWinnerChange =
      !!match.winner_entry_id && match.winner_entry_id !== winnerEntryId;
    if (isWinnerChange) {
      const downstream = await findDownstreamMatches(matchId);
      if (downstream.length > 0) {
        return NextResponse.json(
          {
            error: describeDownstream(downstream),
            downstream,
            code: 'DOWNSTREAM_EXISTS',
          },
          { status: 409 }
        );
      }
    }

    // Admin-entered scores skip the dispute window and go straight to confirmed.
    await admin
      .from('league_matches')
      .update({
        score,
        winner_entry_id: winnerEntryId,
        reported_at: new Date().toISOString(),
        reported_by_token: 'admin',
        status: 'confirmed',
      })
      .eq('id', matchId);

    // Advance winner (and, for compass, loser) into the next round immediately.
    // Any next-round match that becomes fully paired as a result gets a round
    // notification email sent fire-and-forget.
    const progression = await progressMatchOnConfirm(matchId);
    if (progression.newlyPairedMatchIds.length > 0) {
      const origin = new URL(request.url).origin;
      (async () => {
        for (const pairedId of progression.newlyPairedMatchIds) {
          try {
            await sendRoundMatchEmails(pairedId, origin);
          } catch (e) {
            console.error('sendRoundMatchEmails failed:', e);
          }
        }
      })();
    }

    return NextResponse.json({ success: true, progression });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ matchId: string }> }
) {
  try {
    const { matchId } = await params;
    const loaded = await loadAndAuthorize(matchId);
    if ('error' in loaded) return loaded.error;
    const { admin, match } = loaded;

    // Nothing to clear — match is already in its initial state.
    if (!match.winner_entry_id && !match.score) {
      return NextResponse.json({ success: true, noop: true });
    }

    // Downstream guard: any later-round match referencing the current winner
    // or loser must be cleared first.
    const downstream = await findDownstreamMatches(matchId);
    if (downstream.length > 0) {
      return NextResponse.json(
        {
          error: describeDownstream(downstream),
          downstream,
          code: 'DOWNSTREAM_EXISTS',
        },
        { status: 409 }
      );
    }

    // Clear the result: back to an unplayed pending match, keeping the
    // entries/bracket position in place so the flight structure is intact.
    await admin
      .from('league_matches')
      .update({
        score: null,
        winner_entry_id: null,
        reported_at: null,
        reported_by_token: null,
        disputed_at: null,
        disputed_by_token: null,
        status: 'pending',
      })
      .eq('id', matchId);

    // If this was the final round of its flight, un-complete the flight
    // (and the league) since the flight is no longer fully resolved.
    const { data: flight } = await admin
      .from('league_flights')
      .select('id, league_id, num_rounds, status')
      .eq('id', match.flight_id)
      .maybeSingle();
    if (flight && (flight as any).status === 'completed' && match.round >= (flight as any).num_rounds) {
      await admin
        .from('league_flights')
        .update({ status: 'running' })
        .eq('id', (flight as any).id);
      await admin
        .from('leagues')
        .update({ status: 'running' })
        .eq('id', (flight as any).league_id)
        .eq('status', 'completed');
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 });
  }
}

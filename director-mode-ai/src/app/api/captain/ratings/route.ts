/**
 * Paste-in ratings.
 *   POST { team_id, text, action:'preview' }             — parse + match, write nothing
 *   POST { team_id, text, action:'apply', rank?:boolean } — write the matched ratings
 *
 * Always preview first in the UI. Assigning one player another player's rating
 * is a silent error the captain would never spot, so nothing is written until
 * they've seen exactly who gets what.
 */
import { NextResponse } from 'next/server';
import { requireTeam, isError } from '@/lib/captain/server';
import { parseRatingsBlock, resolveRatings, rankByRating } from '@/lib/captain/ratingsPaste';

const MAX_TEXT = 20000;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    team_id?: string;
    text?: string;
    action?: 'preview' | 'apply';
    rank?: boolean;
  };

  const ctx = await requireTeam(body.team_id || '');
  if (isError(ctx)) return ctx.error;

  const text = typeof body.text === 'string' ? body.text.slice(0, MAX_TEXT) : '';
  if (!text.trim()) {
    return NextResponse.json({ error: 'Paste the ratings first.' }, { status: 400 });
  }

  const { data } = await ctx.db
    .from('captain_players')
    .select('id, name, rating, sort_order, is_sub')
    .eq('team_id', ctx.teamId)
    .eq('active', true);

  const roster =
    (data as { id: string; name: string; rating: number | null; sort_order: number | null; is_sub: boolean }[]) ||
    [];

  const { parsed, ignored } = parseRatingsBlock(text);
  const res = resolveRatings(parsed, roster, ignored);

  if (body.action !== 'apply') {
    return NextResponse.json({
      ...res,
      // Names the captain would expect to see and didn't — the most useful
      // thing on the preview, because it means a lookup was missed.
      missing: roster
        .filter((p) => !res.matched.some((m) => m.playerId === p.id))
        .map((p) => p.name)
        .sort(),
    });
  }

  if (!res.matched.length) {
    return NextResponse.json({ error: 'Nothing matched the roster.' }, { status: 400 });
  }

  const stamp = new Date().toISOString();
  const writes = await Promise.all(
    res.matched.map((m) =>
      ctx.db
        .from('captain_players')
        .update({ rating: m.rating, updated_at: stamp })
        .eq('id', m.playerId)
        .eq('team_id', ctx.teamId),
    ),
  );
  const failed = writes.find((w) => w.error);
  if (failed?.error) {
    return NextResponse.json({ error: failed.error.message }, { status: 500 });
  }

  let ranked = 0;
  if (body.rank) {
    // Re-rank off the ratings we just wrote, not the stale ones.
    const updated = roster.map((p) => {
      const m = res.matched.find((x) => x.playerId === p.id);
      return m ? { ...p, rating: m.rating } : p;
    });
    const order = rankByRating(updated.filter((p) => !p.is_sub));
    const rankWrites = await Promise.all(
      order.map((id, i) =>
        ctx.db
          .from('captain_players')
          .update({ sort_order: i + 1, updated_at: stamp })
          .eq('id', id)
          .eq('team_id', ctx.teamId),
      ),
    );
    const rankFailed = rankWrites.find((w) => w.error);
    if (rankFailed?.error) {
      return NextResponse.json(
        { error: `Ratings saved, but ranking failed: ${rankFailed.error.message}` },
        { status: 500 },
      );
    }
    ranked = order.length;
  }

  return NextResponse.json({ ok: true, updated: res.matched.length, ranked });
}

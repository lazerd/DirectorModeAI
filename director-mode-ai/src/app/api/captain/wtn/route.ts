/**
 * Paste-in World Tennis Numbers.
 *   POST { team_id, text, action:'preview' }              — parse + match, write nothing
 *   POST { team_id, text, action:'apply', rank?:boolean }  — write them, optionally re-rank
 *
 * Always preview first. WTN runs the opposite way to NTRP (lower is stronger),
 * so a number landing on the wrong player doesn't just misrank them, it can put
 * the weakest pair on court 1 and still look entirely reasonable on screen.
 */
import { NextResponse } from 'next/server';
import { requireTeam, isError } from '@/lib/captain/server';
import { parseWtnBlock, resolveWtn, rankByWtn } from '@/lib/captain/wtnPaste';

const MAX_TEXT = 20000;

type RosterRow = {
  id: string;
  name: string;
  wtn: number | null;
  wtn_doubles: number | null;
  sort_order: number | null;
  is_sub: boolean;
  /** Link into the identity hub. Null for a player who exists only on this roster. */
  master_player_id: string | null;
};

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
    return NextResponse.json({ error: 'Paste the WTNs first.' }, { status: 400 });
  }

  const { data, error } = await ctx.db
    .from('captain_players')
    .select('id, name, wtn, wtn_doubles, sort_order, is_sub, master_player_id')
    .eq('team_id', ctx.teamId)
    .eq('active', true);

  if (error) {
    // The columns arrive with a migration; say which one rather than 500-ing.
    if (/column .* does not exist/i.test(error.message)) {
      return NextResponse.json(
        { error: 'WTN needs the captain_wtn_and_phone migration to be run first.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const roster = ((data as RosterRow[]) || []).map((p) => ({
    ...p,
    wtn: p.wtn == null ? null : Number(p.wtn),
    wtn_doubles: p.wtn_doubles == null ? null : Number(p.wtn_doubles),
  }));

  const { parsed, ignored, ntrpLooking } = parseWtnBlock(text);
  const res = resolveWtn(parsed, roster, ignored, ntrpLooking);

  if (body.action !== 'apply') {
    return NextResponse.json({
      ...res,
      // Names the captain would expect to see and didn't — the most useful line
      // on the preview, because it means a lookup got missed.
      missing: roster
        .filter((p) => !res.matched.some((m) => m.playerId === p.id))
        .map((p) => p.name)
        .sort(),
    });
  }

  if (!res.matched.length) {
    return NextResponse.json(
      {
        error: ntrpLooking.length
          ? 'Those numbers look like NTRP ratings, not WTNs. WTN runs 1–40 and lower is stronger.'
          : 'Nothing matched the roster.',
      },
      { status: 400 },
    );
  }

  const stamp = new Date().toISOString();
  const writes = await Promise.all(
    res.matched.map((m) =>
      ctx.db
        .from('captain_players')
        .update({
          wtn: m.wtn,
          // Only overwrite the doubles number when the paste actually carried
          // one — a singles-only paste must not wipe a doubles WTN.
          ...(m.wtnDoubles != null ? { wtn_doubles: m.wtnDoubles } : {}),
          wtn_updated_at: stamp,
          updated_at: stamp,
        })
        .eq('id', m.playerId)
        .eq('team_id', ctx.teamId),
    ),
  );
  const failed = writes.find((w) => w.error);
  if (failed?.error) {
    return NextResponse.json({ error: failed.error.message }, { status: 500 });
  }

  /**
   * Write the number through to the PERSON, not just this team's roster row.
   *
   * A World Tennis Number describes a player, not a membership of one team, so
   * a captain who pastes it here should never have to paste it again in
   * PlayerVault, a mixer, or next season's roster. master_players is the
   * identity hub every other tool already links to, so putting it there is what
   * makes the number follow them around.
   *
   * Best-effort: a roster row with no identity link yet (the nightly sync
   * creates them) still gets its own copy above, and picks up the shared one on
   * the next pass. Failing to reach the hub must never lose the paste the
   * captain just confirmed.
   */
  const linked = res.matched
    .map((m) => ({ m, mpid: roster.find((p) => p.id === m.playerId)?.master_player_id }))
    .filter((x): x is { m: (typeof res.matched)[number]; mpid: string } => !!x.mpid);

  let sharedWith = 0;
  if (linked.length) {
    const hub = await Promise.all(
      linked.map((x) =>
        ctx.db
          .from('master_players')
          .update({
            wtn: x.m.wtn,
            ...(x.m.wtnDoubles != null ? { wtn_doubles: x.m.wtnDoubles } : {}),
            wtn_updated_at: stamp,
            wtn_source: 'usta_paste',
            updated_at: stamp,
          })
          .eq('id', x.mpid),
      ),
    );
    sharedWith = hub.filter((h) => !h.error).length;
    const hubFailed = hub.find((h) => h.error);
    if (hubFailed?.error) {
      console.error('[captain/wtn] could not reach the identity hub', hubFailed.error.message);
    }
  }

  let ranked = 0;
  if (body.rank) {
    // Re-rank off the numbers we just wrote, not the stale ones.
    const updated = roster.map((p) => {
      const m = res.matched.find((x) => x.playerId === p.id);
      return m
        ? { ...p, wtn: m.wtn, wtnDoubles: m.wtnDoubles ?? p.wtn_doubles }
        : { ...p, wtnDoubles: p.wtn_doubles };
    });
    const order = rankByWtn(updated.filter((p) => !p.is_sub));
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
        { error: `WTNs saved, but ranking failed: ${rankFailed.error.message}` },
        { status: 500 },
      );
    }
    ranked = order.length;
  }

  return NextResponse.json({
    ok: true,
    updated: res.matched.length,
    ranked,
    // How many of those numbers now follow the player across every tool.
    sharedWith,
    notLinked: res.matched.length - linked.length,
  });
}

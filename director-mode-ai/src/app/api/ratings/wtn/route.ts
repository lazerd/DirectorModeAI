/**
 * Set a player's World Tennis Number from any surface, and make it stick
 * everywhere.
 *   POST { vault_player_id, wtn, wtn_doubles? }
 *
 * The number belongs to the person, so writing it in one tool has to reach all
 * of them. This resolves the row to its master_players identity, writes there,
 * and pushes the copy out to every club-scoped table linked to that person.
 *
 * Authorisation is RLS, deliberately. The caller's own client has to be able to
 * read the vault row first — if their club boundary lets them see the player,
 * they may set that player's rating. Only after that does the service-role
 * client do the propagation, because the hub is service-role-only and the
 * mirrors live in clubs the caller may have no access to.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { setWtnForPerson, isValidWtn, MIN_WTN, MAX_WTN } from '@/lib/ratings/wtn';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    vault_player_id?: string;
    wtn?: number | null;
    wtn_doubles?: number | null;
  };

  if (!body.vault_player_id) {
    return NextResponse.json({ error: 'vault_player_id is required.' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const wtn = body.wtn ?? null;
  const wtnDoubles = body.wtn_doubles ?? null;

  for (const [label, v] of [
    ['Singles WTN', wtn],
    ['Doubles WTN', wtnDoubles],
  ] as const) {
    if (v !== null && !isValidWtn(v)) {
      return NextResponse.json(
        {
          error: `${label} must be between ${MIN_WTN} and ${MAX_WTN}. WTN runs the opposite way to NTRP — lower is stronger.`,
        },
        { status: 400 },
      );
    }
  }

  // RLS is the permission check: reading it with the caller's own client proves
  // the player is inside their club boundary.
  const { data: row } = await supabase
    .from('cc_vault_players')
    .select('id, full_name, master_player_id')
    .eq('id', body.vault_player_id)
    .maybeSingle();

  if (!row) {
    return NextResponse.json({ error: 'Player not found.' }, { status: 404 });
  }

  const player = row as { id: string; full_name: string; master_player_id: string | null };

  if (!player.master_player_id) {
    /**
     * Not linked to the identity hub yet — the nightly sync creates that link.
     * Write the local copy so the captain's edit is never lost, and say plainly
     * that it has not travelled yet rather than implying it has.
     */
    const admin = getSupabaseAdmin();
    const patch: Record<string, unknown> = { wtn, updated_at: new Date().toISOString() };
    if (wtnDoubles !== null) patch.wtn_doubles = wtnDoubles;
    const { error } = await admin.from('cc_vault_players').update(patch).eq('id', player.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      ok: true,
      shared: false,
      message: `Saved for ${player.full_name} here. It reaches your other tools once the nightly player sync links her up.`,
    });
  }

  const out = await setWtnForPerson(player.master_player_id, { wtn, wtnDoubles }, 'manual');
  if (out.errors.length) {
    return NextResponse.json({ error: out.errors.join('; ') }, { status: 500 });
  }

  const reached = Object.values(out.updated).reduce((a, b) => a + b, 0);
  return NextResponse.json({
    ok: true,
    shared: true,
    updated: out.updated,
    message: `Saved for ${player.full_name} across ${reached} record${reached === 1 ? '' : 's'} — it now follows her everywhere in ClubMode.`,
  });
}

/**
 * POST /api/play/games/[id]/notify — email members about a game that is still
 * open, a second time.
 *
 *   { preview: true }  -> who WOULD be emailed. Sends nothing.
 *   { preview: false } -> sends, and only to people this game has not already
 *                         emailed.
 *
 * A game emails the club once, when it is posted. That is right for a club
 * whose members are all in CourtConnect already, and wrong for one that is
 * still filling up its roster: the director adds fifteen members in the
 * evening, and the game they posted that morning has no way to reach them.
 *
 * Staff only — the same people who can see the CourtConnect page in "Run the
 * club" — because this spends the club's email allowance.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { resolveActiveClub } from '@/lib/clubs/activeClub';
import { loadClub, loadGame } from '@/lib/partnerFinder/server';
import { inviteMembers } from '@/lib/partnerFinder/notify';
import { MAX_RECIPIENTS } from '@/lib/partnerFinder/format';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getSupabaseAdmin();
  const game = await loadGame(db, params.id);
  if (!game) return NextResponse.json({ error: 'We could not find that game.' }, { status: 404 });

  // resolveActiveClub returns only clubs this person owns, staffs, or reaches
  // as the platform — a plain member gets nothing back.
  const { active } = await resolveActiveClub(user.id, user.email);
  if (!active || active.id !== game.club_id) {
    return NextResponse.json({ error: 'Only the club can email its members.' }, { status: 403 });
  }

  if (game.status !== 'open') {
    return NextResponse.json({ error: `This game is ${game.status}, so nobody needs to hear about it.` }, { status: 400 });
  }

  const club = await loadClub(db, game.club_id);
  if (!club) return NextResponse.json({ error: 'Club not found' }, { status: 404 });

  const { preview } = (await req.json().catch(() => ({}))) as { preview?: boolean };

  const { data: recipientRows } = await db.rpc('pf_game_recipients', { p_game: game.id, p_limit: MAX_RECIPIENTS });
  const { data: alreadyRows } = await db
    .from('pf_links')
    .select('user_id')
    .eq('game_id', game.id)
    .not('emailed_at', 'is', null);
  const already = new Set(((alreadyRows as { user_id: string }[] | null) ?? []).map((l) => l.user_id));
  const fresh = (
    (recipientRows as { user_id: string; email: string; full_name: string | null; ntrp: number | null }[] | null) ?? []
  ).filter((r) => !already.has(r.user_id));

  if (preview !== false) {
    return NextResponse.json({
      preview: true,
      would_email: fresh.length,
      already_emailed: already.size,
      recipients: fresh.map((r) => ({ name: r.full_name, email: r.email, level: r.ntrp })),
      unreachable: await unreachableForGame(db, club.owner_id, game),
    });
  }

  if (!fresh.length) {
    return NextResponse.json({ sent: 0, message: 'Everyone who fits this game has already had the email.' });
  }

  const sent = await inviteMembers(db, game, club, { onlyNew: true });
  return NextResponse.json({ sent, message: `Emailed ${sent} ${sent === 1 ? 'member' : 'members'}.` });
}

/**
 * People in the club's PlayerVault who fit this game but cannot be emailed,
 * because they have no ClubMode account and so are not club members.
 *
 * This is the honest answer to "why isn't Ryan on the list?". CourtConnect
 * only reaches accounts, a director's vault is mostly people who have never
 * made one (79 of Sleepy Hollow's 92 addresses on 2026-09-21), and the preview
 * used to show a number with no explanation for the gap. A director reading a
 * short list of the members they expected concludes the matching is broken.
 */
async function unreachableForGame(
  db: ReturnType<typeof getSupabaseAdmin>,
  ownerId: string,
  game: { club_id: string; rating_min: number | null; rating_max: number | null; include_unrated: boolean },
): Promise<{ count: number; names: string[] }> {
  const [{ data: memberRows }, { data: vaultRows }] = await Promise.all([
    db.from('cc_club_members').select('user_id').eq('club_id', game.club_id),
    db
      .from('cc_vault_players')
      .select('full_name, email, usta_rating, user_id')
      .eq('director_id', ownerId)
      .not('email', 'is', null),
  ]);
  const members = new Set(((memberRows as { user_id: string }[] | null) ?? []).map((m) => m.user_id));

  const fits = (rating: number | null): boolean => {
    if (game.rating_min == null && game.rating_max == null) return true;
    if (rating == null) return game.include_unrated;
    return rating >= (game.rating_min ?? 1) && rating <= (game.rating_max ?? 7);
  };

  // One entry per address: a vault with the same person twice must not read as
  // two more people the club is failing to reach.
  const seen = new Set<string>();
  const names: string[] = [];
  for (const v of ((vaultRows as { full_name: string | null; email: string | null; usta_rating: number | null; user_id: string | null }[] | null) ?? [])) {
    const addr = (v.email || '').trim().toLowerCase();
    if (!addr || seen.has(addr)) continue;
    if (v.user_id && members.has(v.user_id)) continue;
    if (!fits(v.usta_rating)) continue;
    seen.add(addr);
    names.push((v.full_name || addr).trim());
  }
  names.sort((a, b) => a.localeCompare(b));
  return { count: names.length, names: names.slice(0, 8) };
}

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
    });
  }

  if (!fresh.length) {
    return NextResponse.json({ sent: 0, message: 'Everyone who fits this game has already had the email.' });
  }

  const sent = await inviteMembers(db, game, club, { onlyNew: true });
  return NextResponse.json({ sent, message: `Emailed ${sent} ${sent === 1 ? 'member' : 'members'}.` });
}

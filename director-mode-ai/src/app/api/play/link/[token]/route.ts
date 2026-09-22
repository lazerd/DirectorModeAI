/**
 * POST /api/play/link/[token] — the no-login actions behind an emailed link.
 *
 * { action: 'join' | 'decline' | 'leave' | 'cancel' | 'level', ntrp? }
 *
 * The token is the credential: it names one game and one person, and it can
 * only act as that person on that game. Same rule as CaptainMode's sub claim.
 * Opening the page never acts — a mail scanner that follows links must not
 * take a spot for anyone — so every action is a POST from a button.
 */
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { cancelGame, declineGame, hostAddPlayer, joinGame, leaveGame } from '@/lib/partnerFinder/actions';
import { linkByToken, loadClub, personRow, saveSelfRating } from '@/lib/partnerFinder/server';
import { isLevelValue } from '@/lib/levels';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const db = getSupabaseAdmin();
  const link = await linkByToken(db, params.token);
  if (!link) return NextResponse.json({ error: 'This link is not recognized.' }, { status: 404 });

  /*
   * Still on the club's roster? Someone taken off it keeps their old emails.
   *
   * This asked cc_club_members, which meant a club member with no ACCOUNT was
   * refused by the very link the club had just emailed them -- "Only members
   * of this club can join its games". Membership is being in the club's
   * PlayerVault now (courtconnect_reads_people.sql), and that is what the
   * roster answers.
   */
  const me = await personRow(db, link.club_id, link.person_id);
  if (!me) return NextResponse.json({ error: 'Only members of this club can join its games.' }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    ntrp?: unknown;
    personId?: unknown;
    guestName?: unknown;
  };

  /*
   * The host seating someone who said yes out loud. The token proves who is
   * asking; pf_host_add refuses anyone who did not post the game, so this
   * cannot be used to stuff somebody else's court.
   */
  if (body.action === 'add') {
    const guestName = typeof body.guestName === 'string' ? body.guestName.trim().slice(0, 60) : '';
    const personId = typeof body.personId === 'string' && body.personId ? body.personId : null;
    return NextResponse.json(
      await hostAddPlayer(db, link.game_id, link.person_id, { personId, guestName }),
    );
  }

  if (body.action === 'level') {
    const n = Number(body.ntrp);
    // The club's own ladder, the same one the page offered them.
    const club = await loadClub(db, link.club_id);
    if (!club || !isLevelValue(club.levels, n)) {
      return NextResponse.json({ error: 'Please pick a level from the list.' }, { status: 400 });
    }
    const saved = await saveSelfRating(db, {
      clubId: link.club_id,
      personId: link.person_id,
      email: me.email,
      fullName: me.full_name,
      ntrp: n,
    });
    return NextResponse.json({ ok: saved.saved, result: 'level', message: 'Thanks, your level is saved.' });
  }

  const outcome =
    body.action === 'join'
      ? await joinGame(db, link.game_id, link.person_id, 'email')
      : body.action === 'leave'
        ? await leaveGame(db, link.game_id, link.person_id)
        : body.action === 'cancel'
          ? await cancelGame(db, link.game_id, link.person_id)
          : body.action === 'decline'
            ? await declineGame(db, link.game_id, link.person_id)
            : null;
  if (!outcome) return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  return NextResponse.json(outcome);
}

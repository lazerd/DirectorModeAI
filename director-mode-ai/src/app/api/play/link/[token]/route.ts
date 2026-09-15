/**
 * POST /api/play/link/[token] — the no-login actions behind an emailed link.
 *
 * { action: 'join' | 'leave' | 'cancel' | 'level', ntrp? }
 *
 * The token is the credential: it names one game and one person, and it can
 * only act as that person on that game. Same rule as CaptainMode's sub claim.
 * Opening the page never acts — a mail scanner that follows links must not
 * take a spot for anyone — so every action is a POST from a button.
 */
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { cancelGame, joinGame, leaveGame } from '@/lib/partnerFinder/actions';
import { linkByToken, saveSelfRating } from '@/lib/partnerFinder/server';
import { NTRP_LEVELS } from '@/lib/partnerFinder/format';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const db = getSupabaseAdmin();
  const link = await linkByToken(db, params.token);
  if (!link) return NextResponse.json({ error: 'This link is not recognized.' }, { status: 404 });

  // Still a member? Someone removed from the club keeps their old emails.
  const { data: member } = await db
    .from('cc_club_members')
    .select('role')
    .eq('club_id', link.club_id)
    .eq('user_id', link.user_id)
    .neq('role', 'maintenance')
    .maybeSingle();
  if (!member) return NextResponse.json({ error: 'Only members of this club can join its games.' }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { action?: string; ntrp?: unknown };

  if (body.action === 'level') {
    const n = Number(body.ntrp);
    if (!(NTRP_LEVELS as readonly number[]).includes(n)) {
      return NextResponse.json({ error: 'Please pick a level from the list.' }, { status: 400 });
    }
    const { data: u } = await db.auth.admin.getUserById(link.user_id);
    const { data: p } = await db.from('profiles').select('full_name').eq('id', link.user_id).maybeSingle();
    const saved = await saveSelfRating(db, {
      clubId: link.club_id,
      userId: link.user_id,
      email: u?.user?.email ?? null,
      fullName: (p as { full_name: string | null } | null)?.full_name ?? null,
      ntrp: n,
    });
    return NextResponse.json({ ok: saved.saved, result: 'level', message: 'Thanks, your level is saved.' });
  }

  const outcome =
    body.action === 'join'
      ? await joinGame(db, link.game_id, link.user_id, 'email')
      : body.action === 'leave'
        ? await leaveGame(db, link.game_id, link.user_id)
        : body.action === 'cancel'
          ? await cancelGame(db, link.game_id, link.user_id)
          : null;
  if (!outcome) return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  return NextResponse.json(outcome);
}

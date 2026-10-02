/**
 * GET /api/play/games/[id]/manage — the poster's way from the board to their own
 * game page (/play/i/[token]), where they add someone who said yes, invite their
 * own friends, or message the players. Until now that page was only reachable
 * from an email, and the poster gets no email until someone joins.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { clubRoster, ensureLinks, loadGame } from '@/lib/partnerFinder/server';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const back = (path: string) => NextResponse.redirect(new URL(path, req.url), 303);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return back(`/login?redirect=${encodeURIComponent(`/api/play/games/${params.id}/manage`)}`);

  const db = getSupabaseAdmin();
  const game = await loadGame(db, params.id);
  // Only the poster gets the poster's page.
  if (!game || game.posted_by !== user.id) return back('/member/games');

  const me = (await clubRoster(db, game.club_id, user.id)).find((r) => r.user_id === user.id);
  if (!me?.person_id) return back('/member/games');
  const token = (await ensureLinks(db, game, [me.person_id])).get(me.person_id);
  return back(token ? `/play/i/${token}` : '/member/games');
}

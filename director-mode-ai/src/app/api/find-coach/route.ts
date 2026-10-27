/**
 * GET /api/find-coach?q=name — the coach list behind /find-coach.
 *
 * A signed-in club member sees their own club's coaches and nobody else's.
 * The page used to read lesson_coaches straight from the browser with no club
 * filter, so a QA Test Club member was offered Darrin and every demo club's
 * coaches, each with a booking link (QA report #3, 2026-10).
 *
 * The club is resolved here from the session, with the same primary-club rule
 * /member uses (resolvePlayingClub). There is deliberately no club parameter:
 * nothing in the request can widen or move the list to another club.
 *
 * Signed out, or signed in without a club, it is the public directory it
 * always was — /find-coach is linked from the homepage for visitors.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { resolvePlayingClub } from '@/lib/partnerFinder/server';

export const dynamic = 'force-dynamic';

type Coach = { id: string; display_name: string; slug: string };

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').trim().slice(0, 80);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const admin = getSupabaseAdmin();

  // Only ever the viewer's own club, chosen from their memberships.
  const playing = user ? await resolvePlayingClub(admin, user.id) : null;

  let query = admin
    .from('lesson_coaches')
    .select('id, display_name, slug')
    .not('slug', 'is', null)
    .order('display_name', { ascending: true })
    .limit(q ? 10 : 50);
  if (playing) query = query.eq('club_id', playing.club.id);
  // A typed % or _ is a letter in a name, not a wildcard.
  if (q) query = query.ilike('display_name', `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);

  const { data, error } = await query;
  if (error) {
    console.error('find-coach:', error.message);
    return NextResponse.json({ error: 'Could not load coaches.' }, { status: 500 });
  }

  return NextResponse.json({
    coaches: (data as Coach[] | null) ?? [],
    club: playing ? { name: playing.club.name } : null,
  });
}

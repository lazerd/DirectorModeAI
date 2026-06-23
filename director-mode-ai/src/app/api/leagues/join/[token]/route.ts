/**
 * Public self-service team signup (replaces the JTT Google Form).
 *   GET  /api/leagues/join/[token]  — resolve a league_division_clubs.signup_token
 *                                     into { league, division, club } for the page.
 *   POST /api/leagues/join/[token]  — register a kid onto that team's roster.
 *                                     Body: { player_name, parent_name, parent_email, parent_phone }
 *                                     Returns { player_token } -> reservation page.
 * No auth — the token is the credential.
 */
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

async function resolve(token: string) {
  const admin = getSupabaseAdmin();
  const { data: dc } = await admin
    .from('league_division_clubs')
    .select('division_id, club_id, signup_token')
    .eq('signup_token', token)
    .maybeSingle();
  if (!dc) return null;
  const d = dc as { division_id: string; club_id: string };
  const { data: division } = await admin
    .from('league_divisions')
    .select('id, name, short_code, league_id')
    .eq('id', d.division_id)
    .maybeSingle();
  if (!division) return null;
  const div = division as { id: string; name: string; short_code: string; league_id: string };
  const { data: club } = await admin
    .from('league_clubs').select('id, name, short_code').eq('id', d.club_id).maybeSingle();
  const { data: league } = await admin
    .from('leagues').select('id, name, slug, status').eq('id', div.league_id).maybeSingle();
  return { admin, division: div, club, league };
}

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const r = await resolve(params.token);
  if (!r) return NextResponse.json({ error: 'Signup link not recognized.' }, { status: 404 });
  return NextResponse.json({ league: r.league, division: r.division, club: r.club });
}

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const r = await resolve(params.token);
  if (!r) return NextResponse.json({ error: 'Signup link not recognized.' }, { status: 404 });
  const { admin, division, club } = r;

  const body = (await req.json().catch(() => ({}))) as Record<string, string>;
  const player_name = (body.player_name || '').trim();
  const parent_name = (body.parent_name || '').trim();
  const parent_email = (body.parent_email || '').trim();
  const parent_phone = (body.parent_phone || '').trim();
  if (!player_name) return NextResponse.json({ error: "Player's name is required." }, { status: 400 });
  if (!parent_email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(parent_email))
    return NextResponse.json({ error: 'A valid parent email is required.' }, { status: 400 });

  // If this kid is already on the roster (same name, division, club), reuse their row/token.
  const { data: existing } = await admin
    .from('league_team_rosters')
    .select('id, player_token, parent_email')
    .eq('division_id', division.id)
    .eq('club_id', (club as { id: string }).id)
    .ilike('player_name', player_name)
    .maybeSingle();
  if (existing) {
    const e = existing as { id: string; player_token: string; parent_email: string | null };
    // backfill contact info if it was blank
    if (!e.parent_email) {
      await admin.from('league_team_rosters')
        .update({ parent_name, parent_email, parent_phone }).eq('id', e.id);
    }
    return NextResponse.json({ player_token: e.player_token, existed: true });
  }

  // next ladder position within this team
  const { data: team } = await admin
    .from('league_team_rosters').select('ladder_position')
    .eq('division_id', division.id).eq('club_id', (club as { id: string }).id);
  const nextPos =
    ((team as Array<{ ladder_position: number | null }>) || []).reduce(
      (mx, x) => Math.max(mx, x.ladder_position ?? 0), 0) + 1;

  const { data: ins, error } = await admin
    .from('league_team_rosters')
    .insert({
      division_id: division.id, club_id: (club as { id: string }).id,
      player_name, parent_name: parent_name || null,
      parent_email, parent_phone: parent_phone || null,
      status: 'active', ladder_position: nextPos,
    })
    .select('player_token')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ player_token: (ins as { player_token: string }).player_token });
}

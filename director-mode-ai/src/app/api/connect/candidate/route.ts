import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { zipToLatLng, normalizeZip } from '@/lib/geo';
import { runMatchForCandidate } from '@/lib/connect/engine';

const DEPTS = ['Tennis/Racquets', 'Golf', 'GM'];

// GET — the caller's own candidate profile + their matches (with the opening
// each match points at, so the candidate can see who's interested).
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: candidate } = await supabase
    .from('connect_candidates')
    .select('*')
    .eq('profile_id', user.id)
    .maybeSingle();

  let matches: any[] = [];
  if (candidate) {
    const { data } = await supabase
      .from('connect_matches')
      .select('*, opening:connect_openings(club_name, title, dept, comp_max, status)')
      .eq('candidate_id', candidate.id)
      .order('score', { ascending: false });
    matches = data || [];
  }

  return NextResponse.json({ candidate: candidate || null, matches });
}

// POST — upsert the caller's candidate profile, geocode their ZIP, then run the
// matcher against open openings (a fresh candidate lights up existing jobs).
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const dept = String(body.dept || '');
  if (!DEPTS.includes(dept)) {
    return NextResponse.json({ error: 'invalid dept' }, { status: 400 });
  }
  const currentComp = Number(body.current_comp);
  if (!Number.isFinite(currentComp) || currentComp <= 0) {
    return NextResponse.json({ error: 'current_comp required' }, { status: 400 });
  }

  const zip = normalizeZip(body.home_zip);
  const geo = zipToLatLng(zip);
  const radius = Number.isFinite(Number(body.radius_miles)) ? Number(body.radius_miles) : 50;
  const minComp = Number.isFinite(Number(body.min_comp)) ? Number(body.min_comp) : currentComp;
  const revealMode = body.reveal_mode === 'approve' ? 'approve' : 'auto';

  const svc = await createServiceClient();
  const row = {
    profile_id: user.id,
    full_name: body.full_name ? String(body.full_name) : (user.user_metadata?.full_name ?? null),
    email: body.email ? String(body.email) : user.email,
    phone: body.phone ? String(body.phone) : null,
    headline: body.headline ? String(body.headline) : null,
    dept,
    years_experience: Number.isFinite(Number(body.years_experience)) ? Number(body.years_experience) : null,
    current_comp: currentComp,
    min_comp: minComp,
    home_zip: zip || null,
    home_lat: geo?.lat ?? null,
    home_lng: geo?.lng ?? null,
    radius_miles: radius,
    open_to_work: body.open_to_work !== false,
    reveal_mode: revealMode,
    claimed_ein: body.claimed_ein ? String(body.claimed_ein) : null,
  };

  const { data: saved, error } = await svc
    .from('connect_candidates')
    .upsert(row, { onConflict: 'profile_id' })
    .select('*')
    .single();

  if (error || !saved) {
    return NextResponse.json({ error: error?.message || 'save failed' }, { status: 500 });
  }

  let newMatches = 0;
  if (saved.open_to_work && saved.home_lat != null) {
    newMatches = await runMatchForCandidate(svc, saved as any);
  }

  return NextResponse.json({ candidate: saved, newMatches });
}

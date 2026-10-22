import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// GET /api/connect/applications/mine — the caller's own applications (incl. invites).
// Club-side fields (ai_fit, club_notes) are deliberately not returned.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const svc = getSupabaseAdmin();
  const { data: cand } = await svc.from('connect_candidates').select('id').eq('profile_id', user.id).maybeSingle();
  if (!cand) return NextResponse.json({ applications: [] });

  const { data, error } = await svc
    .from('connect_applications')
    .select('id, opening_id, source, stage, invited_at, consent_at, created_at, updated_at, opening:connect_openings(id, club_name, title, dept, comp_min, comp_max, city, state, status)')
    .eq('candidate_id', cand.id)
    .order('updated_at', { ascending: false });

  if (error) return NextResponse.json({ error: 'Could not load applications' }, { status: 500 });
  return NextResponse.json({ applications: data || [] });
}

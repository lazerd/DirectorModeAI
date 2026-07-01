import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

// GET /api/connect/prospect-interests — clubs that flagged interest in THIS
// director as a public 990 prospect, surfaced once they've opted in and claimed
// that 990 record (match = same EIN + normalized name). Best-effort: returns []
// if the table isn't there yet or the user hasn't claimed a record.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const svc = await createServiceClient();
  const { data: cand } = await svc
    .from('connect_candidates')
    .select('claimed_ein, full_name')
    .eq('profile_id', user.id)
    .maybeSingle();

  if (!cand?.claimed_ein || !cand.full_name) return NextResponse.json({ interests: [] });

  const norm = String(cand.full_name).toLowerCase().replace(/\s+/g, ' ').trim();
  const { data, error } = await svc
    .from('connect_prospect_interests')
    .select('id, club_name, role, comp_min, comp_max, prospect_title, created_at, status')
    .eq('prospect_ein', cand.claimed_ein)
    .eq('prospect_name_norm', norm)
    .eq('status', 'open')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ interests: [] }); // table not applied yet
  return NextResponse.json({ interests: data || [] });
}

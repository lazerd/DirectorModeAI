import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// GET /api/connect/jobs — the public job board. No auth.
// Only openings a club has published (open + public + placement terms accepted).
// Never returns owner_id, club_id or any contact details.
const PUBLIC_COLS =
  'id, club_name, title, dept, comp_min, comp_max, city, state, zip, deadline, description, requirements, created_at';

const trim = (s: unknown, n: number) => {
  const t = typeof s === 'string' ? s.trim() : '';
  return t.length > n ? `${t.slice(0, n).trimEnd()}…` : t || null;
};

export async function GET() {
  const svc = getSupabaseAdmin();
  const { data, error } = await svc
    .from('connect_openings')
    .select(PUBLIC_COLS)
    .eq('status', 'open')
    .eq('is_public', true)
    .not('terms_accepted_at', 'is', null)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: 'Could not load jobs' }, { status: 500 });

  const jobs = (data || []).map((j: any) => ({
    ...j,
    description: trim(j.description, 400),
    requirements: trim(j.requirements, 400),
  }));
  return NextResponse.json({ jobs });
}

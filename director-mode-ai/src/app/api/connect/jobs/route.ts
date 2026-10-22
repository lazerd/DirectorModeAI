import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { SOURCED_PUBLIC_COLS } from '@/lib/connect/scout/labels';
import { feeEligible } from '@/lib/connect/feeScope';

export const dynamic = 'force-dynamic';

// GET /api/connect/jobs — the public job board. No auth.
// `jobs`: openings a club has published (open + public + placement terms accepted).
// `sourced`: active jobs the Scout found on public boards (see SOURCED_PUBLIC_COLS).
// Never returns owner_id, club_id or any contact details.
const PUBLIC_COLS =
  'id, club_name, title, dept, comp_min, comp_max, city, state, zip, deadline, description, requirements, created_at';

const trim = (s: unknown, n: number) => {
  const t = typeof s === 'string' ? s.trim() : '';
  return t.length > n ? `${t.slice(0, n).trimEnd()}…` : t || null;
};

export async function GET() {
  const svc = getSupabaseAdmin();
  const [{ data, error }, sourced] = await Promise.all([svc
    .from('connect_openings')
    .select(PUBLIC_COLS)
    .eq('status', 'open')
    .eq('is_public', true)
    .not('terms_accepted_at', 'is', null)
    .order('created_at', { ascending: false })
    .limit(200),
  svc
    .from('connect_sourced_jobs')
    .select(`${SOURCED_PUBLIC_COLS}, last_seen_at`)
    .eq('status', 'active')
    .is('opening_id', null)
    .order('first_seen_at', { ascending: false })
    .limit(300)]);

  if (error) return NextResponse.json({ error: 'Could not load jobs' }, { status: 500 });

  const jobs = (data || []).map((j: any) => ({
    ...j,
    fee_eligible: feeEligible(null, j.title),
    description: trim(j.description, 400),
    requirements: trim(j.requirements, 400),
  }));
  // Sourced ids carry an "s-" prefix so they never collide with retained ids in /connect/jobs/[id].
  // A posting whose deadline has passed is stale even if the board still shows it.
  const today = new Date().toISOString().slice(0, 10);
  const live = (sourced.data || []).filter((j: any) => !j.deadline || j.deadline >= today);
  const sourcedJobs = live.map(({ last_seen_at, ...j }: any) => ({ ...j, id: `s-${j.id}`, summary: trim(j.summary, 400), fee_eligible: feeEligible(j.role_level, j.title) }));
  // When the Scout last confirmed these postings were still up.
  const checkedAt = live.reduce((m: string | null, j: any) => (!m || j.last_seen_at > m ? j.last_seen_at : m), null);
  return NextResponse.json({ jobs: jobs.filter((j: any) => !j.deadline || j.deadline >= today), sourced: sourcedJobs, checked_at: checkedAt });
}

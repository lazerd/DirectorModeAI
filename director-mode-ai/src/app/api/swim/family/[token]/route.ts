/**
 * GET /api/swim/family/[token]
 *
 * Public — no auth. Returns everything needed to render a family's signup page:
 *   - their family record + season
 *   - all meets, jobs, and (importantly) per-job signup counts so we can show
 *     "5 of 8 spots filled" and disable the button when full
 *   - their own assignments (so we can show "you signed up for X")
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const token = params.token;
  if (!token || token.length < 8) {
    return NextResponse.json({ error: 'Invalid link.' }, { status: 400 });
  }
  const admin = getSupabaseAdmin();

  const { data: family } = await admin
    .from('swim_families')
    .select('*')
    .eq('family_token', token)
    .maybeSingle();
  if (!family) {
    return NextResponse.json({ error: 'Link not recognized.' }, { status: 404 });
  }
  const f: any = family;

  const [{ data: season }, { data: meets }, { data: jobs }, { data: myAssignments }] =
    await Promise.all([
      admin.from('swim_seasons').select('*').eq('id', f.season_id).maybeSingle(),
      admin.from('swim_meets').select('*').eq('season_id', f.season_id),
      admin.from('swim_jobs').select('*').eq('season_id', f.season_id),
      admin.from('swim_assignments').select('*').eq('family_id', f.id),
    ]);

  // For every job in this season, count how many active (signed_up + completed)
  // assignments exist so the client can show capacity / disable when full.
  const jobIds = ((jobs as any[]) || []).map((j) => j.id);
  let counts: Record<string, number> = {};
  if (jobIds.length > 0) {
    const { data: allAssignments } = await admin
      .from('swim_assignments')
      .select('job_id, status')
      .in('job_id', jobIds);
    for (const a of (allAssignments as any[]) || []) {
      if (a.status === 'signed_up' || a.status === 'completed') {
        counts[a.job_id] = (counts[a.job_id] ?? 0) + 1;
      }
    }
  }

  return NextResponse.json({
    family: f,
    season,
    meets: meets || [],
    jobs: jobs || [],
    myAssignments: myAssignments || [],
    jobSignupCounts: counts,
  });
}

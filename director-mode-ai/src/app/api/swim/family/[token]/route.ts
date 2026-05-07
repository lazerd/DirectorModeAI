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

// Skip Next.js's fetch cache so newly-added jobs/meets show up immediately.
// Supabase-js uses fetch under the hood and App Router caches fetch GETs by
// default — that was returning stale empty arrays for swim_jobs/swim_meets.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

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

  const [seasonRes, meetsRes, jobsRes, assignRes] = await Promise.all([
    admin.from('swim_seasons').select('*').eq('id', f.season_id).maybeSingle(),
    admin.from('swim_meets').select('*').eq('season_id', f.season_id),
    admin.from('swim_jobs').select('*').eq('season_id', f.season_id),
    admin.from('swim_assignments').select('*').eq('family_id', f.id),
  ]);

  // Surface query errors so we can debug why jobs/meets aren't loading
  // (e.g. PostgREST schema cache stale after migrations).
  const errs: Record<string, string> = {};
  if (seasonRes.error) errs.season = seasonRes.error.message;
  if (meetsRes.error) errs.meets = meetsRes.error.message;
  if (jobsRes.error) errs.jobs = jobsRes.error.message;
  if (assignRes.error) errs.assignments = assignRes.error.message;

  const season = seasonRes.data;
  const meets = meetsRes.data;
  const jobs = jobsRes.data;
  const myAssignments = assignRes.data;

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
    _diag:
      Object.keys(errs).length > 0
        ? { errors: errs, family_season_id: f.season_id }
        : { family_season_id: f.season_id, jobs_count: (jobs || []).length },
  });
}

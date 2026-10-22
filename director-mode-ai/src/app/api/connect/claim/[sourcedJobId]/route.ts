import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { PLACEMENT_FEE_USD, PLACEMENT_TERMS, PLACEMENT_TERMS_VERSION } from '@/lib/connect/placement';
import { claimSourcedJob, ClaimError } from '@/lib/connect/recruiter/claim';

export const dynamic = 'force-dynamic';

// GET — what the club sees before accepting: the job facts, how many candidates
// are waiting (counts only, never identities) and the terms.
export async function GET(_req: Request, { params }: { params: { sourcedJobId: string } }) {
  const db = getSupabaseAdmin();
  const { data: job } = await db
    .from('connect_sourced_jobs')
    .select('id, club_name, title, city, state, comp_min, comp_max, est_comp, status, opening_id, evaluation')
    .eq('id', params.sourcedJobId)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Only confirmed interests are ever cited to a club; ranked prospects are not.
  const { count: interested } = await db
    .from('connect_job_interests')
    .select('id', { count: 'exact', head: true })
    .eq('sourced_job_id', job.id)
    .in('status', ['interested', 'presented']);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let mine = false;
  if (user && job.opening_id) {
    const { data: o } = await db.from('connect_openings').select('owner_id').eq('id', job.opening_id).maybeSingle();
    mine = o?.owner_id === user.id;
  }

  const ev = job.evaluation as { target_comp?: number | null; bands?: { maxRadiusMiles?: number | null } | null } | null;
  return NextResponse.json({
    job: {
      id: job.id,
      club_name: job.club_name,
      title: job.title,
      city: job.city,
      state: job.state,
      comp_max: job.comp_max ?? job.est_comp ?? ev?.target_comp ?? null,
      comp_posted: !!job.comp_max,
      radius: ev?.bands?.maxRadiusMiles ?? null,
      active: job.status === 'active' && !job.opening_id,
      claimed: !!job.opening_id,
      opening_id: mine ? job.opening_id : null,
    },
    counts: { interested: interested ?? 0 },
    terms: { fee: PLACEMENT_FEE_USD, version: PLACEMENT_TERMS_VERSION, lines: PLACEMENT_TERMS },
    me: { signedIn: !!user, email: user?.email ?? null, mine },
  });
}

// POST — accept the terms and claim. Body: { accept_terms: true, comp_max?: number }.
export async function POST(req: Request, { params }: { params: { sourcedJobId: string } }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (body.accept_terms !== true) {
    return NextResponse.json({ error: `Please accept the terms: you pay a flat $${PLACEMENT_FEE_USD.toLocaleString()} only if you hire a candidate we introduce.` }, { status: 400 });
  }
  try {
    const r = await claimSourcedJob({ id: user.id, email: user.email }, params.sourcedJobId, {
      compMax: Number.isFinite(Number(body.comp_max)) ? Number(body.comp_max) : null,
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    if (err instanceof ClaimError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[connect/claim]', err);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}

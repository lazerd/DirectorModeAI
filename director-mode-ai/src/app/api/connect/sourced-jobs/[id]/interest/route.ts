import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { feeEligible, JOB_BOARD_ONLY_HINT } from '@/lib/connect/feeScope';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function candidateFor(userId: string) {
  const svc = getSupabaseAdmin();
  const { data } = await svc.from('connect_candidates').select('id, resume_path').eq('profile_id', userId).is('deleted_at', null).maybeSingle();
  return data as { id: string; resume_path: string | null } | null;
}

// POST /api/connect/sourced-jobs/:id/interest — "I'm interested — present me to
// this club." A job we found on a public board (the club hasn't signed our
// terms yet). Requires sign-in, a candidate profile with a résumé, and explicit
// consent to present the profile to that club for that role. Nothing is sent
// to the club here; the recruiter engine decides when to pitch it.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in to raise your hand for this job.' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (body.consent !== true) {
    return NextResponse.json({ error: 'Please check the box so we can present your profile to this club.' }, { status: 400 });
  }
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) || null : null;

  const svc = getSupabaseAdmin();
  const { data: job } = await svc
    .from('connect_sourced_jobs')
    .select('id, status, role_level, title')
    .eq('id', params.id)
    .maybeSingle();
  if (!job || job.status !== 'active') return NextResponse.json({ error: 'This job is no longer listed.' }, { status: 404 });
  // We only present candidates for director-level roles; the rest are job board only.
  if (!feeEligible(job.role_level, job.title)) return NextResponse.json({ error: JOB_BOARD_ONLY_HINT }, { status: 400 });

  const cand = await candidateFor(user.id);
  if (!cand) return NextResponse.json({ error: 'Complete your candidate profile first.', needs: 'profile' }, { status: 400 });
  if (!cand.resume_path) return NextResponse.json({ error: 'Upload your résumé on your candidate profile first.', needs: 'resume' }, { status: 400 });

  // Already presented → keep that status (don't move them backwards).
  const { data: prior } = await svc
    .from('connect_job_interests')
    .select('status')
    .eq('sourced_job_id', job.id)
    .eq('candidate_id', cand.id)
    .maybeSingle();
  const status = prior?.status === 'presented' ? 'presented' : 'interested';

  const { data, error } = await svc
    .from('connect_job_interests')
    .upsert(
      { sourced_job_id: job.id, candidate_id: cand.id, consent_at: new Date().toISOString(), note, status },
      { onConflict: 'sourced_job_id,candidate_id' },
    )
    .select('id, status, consent_at')
    .single();
  if (error) return NextResponse.json({ error: 'Could not save that. Please try again.' }, { status: 500 });

  return NextResponse.json({
    interest: data,
    message: "You're on our list for this role. When we introduce candidates to this club, you'll be one of them, and we'll tell you first.",
  });
}

// DELETE — withdraw interest (consent no longer applies).
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const cand = await candidateFor(user.id);
  if (!cand) return NextResponse.json({ ok: true });
  const svc = getSupabaseAdmin();
  await svc
    .from('connect_job_interests')
    .update({ status: 'withdrawn' })
    .eq('sourced_job_id', params.id)
    .eq('candidate_id', cand.id);
  return NextResponse.json({ ok: true });
}

/**
 * POST   /api/swim/family/[token]/signup  { job_id }     → sign up
 * DELETE /api/swim/family/[token]/signup?assignment_id=X → cancel signup
 *
 * Public — no auth, identified by the family's magic-link token.
 *
 * Slot enforcement: if the job has `slots` set, count existing active
 * (signed_up + completed) assignments for that job; reject if full.
 *
 * Cancel is only allowed while the assignment is still `signed_up`.
 * Once the lead marks `completed`, the family can't undo it themselves.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

async function getFamily(token: string) {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from('swim_families')
    .select('*')
    .eq('family_token', token)
    .maybeSingle();
  return data as any;
}

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const token = params.token;
  if (!token || token.length < 8) {
    return NextResponse.json({ error: 'Invalid link.' }, { status: 400 });
  }

  const family = await getFamily(token);
  if (!family) {
    return NextResponse.json({ error: 'Link not recognized.' }, { status: 404 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const jobId: string | undefined = body?.job_id;
  if (!jobId) {
    return NextResponse.json({ error: 'job_id required.' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  const { data: job } = await admin
    .from('swim_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();
  if (!job) {
    return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
  }
  if ((job as any).season_id !== family.season_id) {
    return NextResponse.json({ error: 'Job not in your season.' }, { status: 403 });
  }

  // Already signed up? (active = signed_up or completed)
  const { data: existing } = await admin
    .from('swim_assignments')
    .select('id, status')
    .eq('family_id', family.id)
    .eq('job_id', jobId);
  const dup = (existing as any[])?.find(
    (a) => a.status === 'signed_up' || a.status === 'completed'
  );
  if (dup) {
    return NextResponse.json({ error: 'Already signed up for this job.' }, { status: 409 });
  }

  // Slot enforcement
  const slots = (job as any).slots as number | null;
  if (slots != null) {
    const { data: allForJob } = await admin
      .from('swim_assignments')
      .select('id, status')
      .eq('job_id', jobId);
    const taken = ((allForJob as any[]) || []).filter(
      (a) => a.status === 'signed_up' || a.status === 'completed'
    ).length;
    if (taken >= slots) {
      return NextResponse.json(
        { error: `This job is full (${taken}/${slots}).` },
        { status: 409 }
      );
    }
  }

  const auto = (job as any).auto_award_on_signup === true;
  const { data: created, error: insErr } = await admin
    .from('swim_assignments')
    .insert({
      family_id: family.id,
      job_id: jobId,
      points_awarded: (job as any).points,
      status: auto ? 'completed' : 'signed_up',
      completed_at: auto ? new Date().toISOString() : null,
      auto_awarded: auto,
    })
    .select('*')
    .maybeSingle();

  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, assignment: created });
}

export async function DELETE(req: Request, { params }: { params: { token: string } }) {
  const token = params.token;
  if (!token || token.length < 8) {
    return NextResponse.json({ error: 'Invalid link.' }, { status: 400 });
  }
  const family = await getFamily(token);
  if (!family) {
    return NextResponse.json({ error: 'Link not recognized.' }, { status: 404 });
  }

  const url = new URL(req.url);
  const assignmentId = url.searchParams.get('assignment_id');
  if (!assignmentId) {
    return NextResponse.json({ error: 'assignment_id required.' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data: a } = await admin
    .from('swim_assignments')
    .select('*')
    .eq('id', assignmentId)
    .maybeSingle();
  if (!a) {
    return NextResponse.json({ error: 'Signup not found.' }, { status: 404 });
  }
  if ((a as any).family_id !== family.id) {
    return NextResponse.json({ error: 'Not your signup.' }, { status: 403 });
  }
  // Family can cancel their own pending signups, OR auto-awarded ones the lead
  // hasn't manually touched. Lead-confirmed completions are protected.
  const isCancellable =
    (a as any).status === 'signed_up' ||
    ((a as any).status === 'completed' && (a as any).auto_awarded === true);
  if (!isCancellable) {
    return NextResponse.json(
      { error: 'Already confirmed by the lead — please contact them to change.' },
      { status: 409 }
    );
  }

  const { error: delErr } = await admin
    .from('swim_assignments')
    .delete()
    .eq('id', assignmentId);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

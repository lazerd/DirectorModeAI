import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { SOURCED_PUBLIC_COLS } from '@/lib/connect/scout/labels';
import { feeEligible } from '@/lib/connect/feeScope';

export const dynamic = 'force-dynamic';

// GET /api/connect/jobs/:id — one public opening. If the caller is signed in,
// also says whether they have a candidate profile / résumé and their
// application stage for this opening (their own row only). A non-public
// opening is shown only to a candidate who already has a row for it (an invite).
const PUBLIC_COLS =
  'id, club_name, title, dept, comp_min, comp_max, city, state, zip, deadline, description, requirements, job_url, created_at';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Me = {
  signedIn: boolean;
  hasProfile: boolean;
  hasResume: boolean;
  application: { id: string; stage: string; updated_at: string } | null;
  interest?: { status: string; consent_at: string } | null;
};

// GET /api/connect/jobs/s-:uuid — a job the Scout found on a public board.
// Public facts + our summary + the original link (SOURCED_PUBLIC_COLS); plus,
// for a signed-in candidate, whether they've raised their hand for it.
async function getSourced(rawId: string) {
  const id = rawId.slice(2);
  if (!UUID.test(id)) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  const svc = getSupabaseAdmin();
  const { data: row } = await svc
    .from('connect_sourced_jobs')
    .select(SOURCED_PUBLIC_COLS)
    .eq('id', id)
    .eq('status', 'active')
    .maybeSingle();
  if (!row) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const me: Me = { signedIn: false, hasProfile: false, hasResume: false, application: null, interest: null };
  if (user) {
    me.signedIn = true;
    const { data: cand } = await svc
      .from('connect_candidates')
      .select('id, resume_path')
      .eq('profile_id', user.id)
      .is('deleted_at', null)
      .maybeSingle();
    if (cand) {
      me.hasProfile = true;
      me.hasResume = !!cand.resume_path;
      const { data: interest } = await svc
        .from('connect_job_interests')
        .select('status, consent_at')
        .eq('sourced_job_id', id)
        .eq('candidate_id', cand.id)
        .maybeSingle();
      me.interest = interest || null;
    }
  }
  const r = row as unknown as Record<string, unknown>;
  const fee_eligible = feeEligible(r.role_level as string | null, r.title as string | null);
  return NextResponse.json({ job: { ...r, id: `s-${r.id}`, sourced_id: r.id, kind: 'sourced', fee_eligible }, me });
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (params.id.startsWith('s-')) return getSourced(params.id);
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  const svc = getSupabaseAdmin();
  const { data: row } = await svc
    .from('connect_openings')
    .select(`${PUBLIC_COLS}, is_public`)
    .eq('id', params.id)
    .eq('status', 'open')
    .not('terms_accepted_at', 'is', null)
    .maybeSingle();

  if (!row) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  const { is_public: isPublic, ...job } = row as any;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let me: Me = { signedIn: false, hasProfile: false, hasResume: false, application: null };

  if (user) {
    me = { ...me, signedIn: true };
    const { data: cand } = await svc
      .from('connect_candidates')
      .select('id, resume_path')
      .eq('profile_id', user.id)
      .is('deleted_at', null)
      .maybeSingle();
    if (cand) {
      me.hasProfile = true;
      me.hasResume = !!cand.resume_path;
      const { data: app } = await svc
        .from('connect_applications')
        .select('id, stage, updated_at')
        .eq('opening_id', job.id)
        .eq('candidate_id', cand.id)
        .maybeSingle();
      me.application = app || null;
    }
  }

  if (!isPublic && !me.application) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  return NextResponse.json({ job: { ...job, fee_eligible: feeEligible(null, job.title) }, me });
}

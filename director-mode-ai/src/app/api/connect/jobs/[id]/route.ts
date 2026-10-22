import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// GET /api/connect/jobs/:id — one public opening. If the caller is signed in,
// also says whether they have a candidate profile / résumé and their
// application stage for this opening (their own row only). A non-public
// opening is shown only to a candidate who already has a row for it (an invite).
const PUBLIC_COLS =
  'id, club_name, title, dept, comp_min, comp_max, city, state, zip, deadline, description, requirements, job_url, created_at';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
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

  let me: {
    signedIn: boolean;
    hasProfile: boolean;
    hasResume: boolean;
    application: { id: string; stage: string; updated_at: string } | null;
  } = { signedIn: false, hasProfile: false, hasResume: false, application: null };

  if (user) {
    me = { ...me, signedIn: true };
    const { data: cand } = await svc
      .from('connect_candidates')
      .select('id, resume_path')
      .eq('profile_id', user.id)
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

  return NextResponse.json({ job, me });
}

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { candidateCanMove, isStage } from '@/lib/connect/placement';

export const dynamic = 'force-dynamic';

// POST /api/connect/applications/:id/withdraw — a candidate withdraws their own application
// (or declines an invite). Ownership is checked explicitly since we use the service role.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const svc = getSupabaseAdmin();
  const { data: cand } = await svc.from('connect_candidates').select('id').eq('profile_id', user.id).maybeSingle();
  if (!cand) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: app } = await svc
    .from('connect_applications')
    .select('id, stage, candidate_id')
    .eq('id', params.id)
    .maybeSingle();
  if (!app || app.candidate_id !== cand.id) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (!isStage(app.stage) || !candidateCanMove(app.stage, 'withdrawn')) {
    return NextResponse.json({ error: 'This application can no longer be withdrawn.' }, { status: 409 });
  }

  const { error } = await svc
    .from('connect_applications')
    .update({ stage: 'withdrawn', updated_at: new Date().toISOString() })
    .eq('id', app.id)
    .eq('candidate_id', cand.id);
  if (error) return NextResponse.json({ error: 'Could not withdraw' }, { status: 500 });

  return NextResponse.json({ ok: true, stage: 'withdrawn' });
}

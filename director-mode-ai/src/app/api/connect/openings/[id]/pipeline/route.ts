import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { CLUB_VISIBLE_STAGES } from '@/lib/connect/placement';

export const dynamic = 'force-dynamic';

// GET — the club's hiring pipeline for one opening. Only applications the
// candidate consented to (CLUB_VISIBLE_STAGES) are returned with identity;
// invited-but-not-applied candidates come back as a count only.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const db = getSupabaseAdmin();
  const { data: opening } = await db.from('connect_openings').select('*').eq('id', id).maybeSingle();
  if (!opening || opening.owner_id !== user.id) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const [{ data: apps }, { count: invited }, { data: placements }] = await Promise.all([
    db
      .from('connect_applications')
      .select('id, candidate_id, source, stage, cover_note, resume_path, introduced_at, ai_fit_score, ai_fit, ai_fit_at, club_notes, hired_at, start_date, created_at, updated_at')
      .eq('opening_id', id)
      .in('stage', CLUB_VISIBLE_STAGES)
      .order('ai_fit_score', { ascending: false, nullsFirst: false }),
    db
      .from('connect_applications')
      .select('id', { count: 'exact', head: true })
      .eq('opening_id', id)
      .eq('stage', 'invited'),
    db.from('connect_placements').select('application_id, fee_cents, start_date, guarantee_until, status').eq('opening_id', id),
  ]);

  const candIds = Array.from(new Set((apps || []).map((a) => a.candidate_id)));
  const { data: cands } = candIds.length
    ? await db
        .from('connect_candidates')
        .select('id, full_name, email, phone, headline, years_experience, certifications, linkedin_url, experience_summary, resume_path, resume_filename')
        .in('id', candIds)
    : { data: [] as any[] };
  const byId = new Map((cands || []).map((c) => [c.id, c]));
  const placementByApp = new Map((placements || []).map((p) => [p.application_id, p]));

  const applications = await Promise.all(
    (apps || []).map(async (a) => {
      const c: any = byId.get(a.candidate_id) || {};
      const path = a.resume_path || c.resume_path || null;
      let resume_url: string | null = null;
      if (path) {
        const { data: signed } = await db.storage.from('resumes').createSignedUrl(path, 600);
        resume_url = signed?.signedUrl ?? null;
      }
      return {
        id: a.id,
        stage: a.stage,
        source: a.source,
        cover_note: a.cover_note,
        introduced_at: a.introduced_at,
        ai_fit_score: a.ai_fit_score,
        ai_fit: a.ai_fit,
        ai_fit_at: a.ai_fit_at,
        club_notes: a.club_notes,
        hired_at: a.hired_at,
        start_date: a.start_date,
        created_at: a.created_at,
        resume_url,
        resume_filename: c.resume_filename ?? null,
        placement: placementByApp.get(a.id) ?? null,
        candidate: {
          full_name: c.full_name ?? null,
          email: c.email ?? null,
          phone: c.phone ?? null,
          headline: c.headline ?? null,
          years_experience: c.years_experience ?? null,
          certifications: c.certifications ?? null,
          linkedin_url: c.linkedin_url ?? null,
          experience_summary: c.experience_summary ?? null,
        },
      };
    }),
  );

  return NextResponse.json({ opening, applications, invited: invited ?? 0 });
}

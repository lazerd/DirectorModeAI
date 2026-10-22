import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { sendBilledEmail } from '@/lib/email';
import { APP_URL } from '@/lib/appUrl';
import { candidateCanMove, isStage, STAGE_LABEL } from '@/lib/connect/placement';
import { scoreApplication } from '@/lib/connect/aiFit';
import { background } from '@/lib/partnerFinder/background';
import { logStageEvent } from '@/lib/connect/events';

export const dynamic = 'force-dynamic';

const esc = (s: unknown) =>
  String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] || c));

// POST /api/connect/jobs/:id/apply — a candidate applies (with explicit consent).
// This application IS the introduction that starts the placement attribution
// clock. Candidates are never charged; the club email is platform-paid.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in to apply.' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (body.consent !== true) {
    return NextResponse.json({ error: 'Please check the box authorizing us to send your application to this club.' }, { status: 400 });
  }
  const coverNote = typeof body.cover_note === 'string' ? body.cover_note.trim().slice(0, 4000) || null : null;

  const svc = getSupabaseAdmin();

  const { data: opening } = await svc
    .from('connect_openings')
    .select('id, owner_id, club_name, title, dept, status, is_public, terms_accepted_at')
    .eq('id', params.id)
    .maybeSingle();
  if (!opening || opening.status !== 'open' || !opening.terms_accepted_at) {
    return NextResponse.json({ error: 'This job is no longer accepting applications.' }, { status: 404 });
  }

  const { data: cand } = await svc
    .from('connect_candidates')
    .select('id, full_name, headline, years_experience, resume_path')
    .eq('profile_id', user.id)
    .is('deleted_at', null)
    .maybeSingle();
  if (!cand) {
    return NextResponse.json({ error: 'Complete your candidate profile before applying.', needs: 'profile' }, { status: 400 });
  }
  if (!cand.resume_path) {
    return NextResponse.json({ error: 'Upload your résumé on your candidate profile before applying.', needs: 'resume' }, { status: 400 });
  }

  // An invite-only (non-public) opening can only be applied to by invited candidates.
  const { data: existing } = await svc
    .from('connect_applications')
    .select('id, stage, introduced_at')
    .eq('opening_id', opening.id)
    .eq('candidate_id', cand.id)
    .maybeSingle();

  if (!opening.is_public && !existing) {
    return NextResponse.json({ error: 'This job is no longer accepting applications.' }, { status: 404 });
  }

  const now = new Date().toISOString();
  let applicationId: string;

  if (existing) {
    const from = isStage(existing.stage) ? existing.stage : null;
    if (!from || !candidateCanMove(from, 'applied')) {
      if (from === 'withdrawn') {
        return NextResponse.json({ error: 'You withdrew from this job. Contact the club directly if you want to be reconsidered.' }, { status: 409 });
      }
      return NextResponse.json({
        ok: true, alreadyApplied: true, application: { id: existing.id, stage: existing.stage },
        message: `You already applied. Status: ${from ? STAGE_LABEL[from] : existing.stage}.`,
      });
    }
    const { error } = await svc
      .from('connect_applications')
      .update({
        stage: 'applied',
        cover_note: coverNote,
        resume_path: cand.resume_path,
        consent_at: now,
        introduced_at: existing.introduced_at || now,
        updated_at: now,
      })
      .eq('id', existing.id)
      .eq('stage', 'invited'); // guard against a concurrent move
    if (error) return NextResponse.json({ error: 'Could not submit your application.' }, { status: 500 });
    applicationId = existing.id;
    await logStageEvent({ application_id: applicationId, from_stage: existing.stage, to_stage: 'applied', actor_id: user.id, actor_role: 'candidate', note: 'applied with consent', at: now });
  } else {
    const { data: inserted, error } = await svc
      .from('connect_applications')
      .insert({
        opening_id: opening.id,
        candidate_id: cand.id,
        source: 'self_apply',
        stage: 'applied',
        cover_note: coverNote,
        resume_path: cand.resume_path,
        consent_at: now,
        introduced_at: now,
      })
      .select('id')
      .single();
    if (error || !inserted) {
      // Unique violation = a double-click raced us; treat as already applied.
      if ((error as any)?.code === '23505') {
        return NextResponse.json({ ok: true, alreadyApplied: true, message: 'You already applied.' });
      }
      return NextResponse.json({ error: 'Could not submit your application.' }, { status: 500 });
    }
    applicationId = inserted.id;
    await logStageEvent({ application_id: applicationId, from_stage: null, to_stage: 'applied', actor_id: user.id, actor_role: 'candidate', note: 'applied with consent', at: now });
  }

  // Tell the club. Platform-paid (null) — never billed to the club or candidate.
  const { data: owner } = await svc.from('profiles').select('email').eq('id', opening.owner_id).maybeSingle();
  const role = opening.title || opening.dept || 'your opening';
  if (owner?.email) {
    const link = `${APP_URL}/connect/clubs/${opening.id}`;
    const who = cand.headline || (cand.years_experience ? `${cand.years_experience} years experience` : 'A new candidate');
    await sendBilledEmail(null, {
      to: owner.email,
      subject: `New applicant for ${role}`,
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
          <h2 style="margin:0 0 8px">New applicant for ${esc(role)}</h2>
          <p style="margin:0 0 12px;color:#475569"><strong>${esc(cand.full_name || 'A candidate')}</strong> applied through ClubMode Recruiting. ${esc(who)}.</p>
          <p style="margin:0 0 16px;color:#475569">Their résumé, cover note and an AI fit summary are in your pipeline.</p>
          <p style="margin:0 0 16px"><a href="${esc(link)}" style="background:#0d9488;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">Review the application</a></p>
          <p style="margin:0;color:#94a3b8;font-size:12px">No fee unless you hire a candidate ClubMode introduced.</p>
        </div>`,
    }).catch((e) => console.error('[connect/apply] club email failed', e));
  }

  background('connect scoreApplication', () => scoreApplication(applicationId));

  return NextResponse.json({ ok: true, application: { id: applicationId, stage: 'applied' } });
}

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { zipToLatLng, normalizeZip } from '@/lib/geo';
import { runMatchForCandidate } from '@/lib/connect/engine';
import { makeReferralCode, normalizeRefCode, REF_COOKIE, shouldRecordReferral } from '@/lib/connect/referrals';
import { logStageEvents } from '@/lib/connect/events';

export const dynamic = 'force-dynamic';

const DEPTS = ['Tennis/Racquets', 'Golf', 'GM'];

function cleanText(v: unknown, max: number): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s.slice(0, max) : null;
}

// Only http(s) links; a bare "linkedin.com/in/x" gets https:// prepended.
function cleanUrl(v: unknown): string | null {
  const s = cleanText(v, 300);
  if (!s) return null;
  const withProto = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withProto);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

// GET — the caller's own candidate profile + their matches (with the opening
// each match points at, so the candidate can see who's interested).
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: candidate } = await supabase
    .from('connect_candidates')
    .select('*')
    .eq('profile_id', user.id)
    .maybeSingle();

  if (candidate?.deleted_at) return NextResponse.json({ candidate: null, matches: [], referral: null, deleted: true });

  let matches: any[] = [];
  let referral: { code: string; joined: number } | null = null;
  if (candidate) {
    referral = await ensureReferral(candidate.id, candidate.referral_code ?? null);
    const { data } = await supabase
      .from('connect_matches')
      .select('*, opening:connect_openings(club_name, title, dept, comp_max, status)')
      .eq('candidate_id', candidate.id)
      .order('score', { ascending: false });
    matches = data || [];
  }

  return NextResponse.json({ candidate: candidate || null, matches, referral });
}

/** The candidate's private invite code (created on first view) and how many people joined with it. */
async function ensureReferral(candidateId: string, existing: string | null): Promise<{ code: string; joined: number } | null> {
  const db = getSupabaseAdmin();
  let code = existing;
  for (let i = 0; !code && i < 5; i++) {
    const next = makeReferralCode();
    const { data } = await db
      .from('connect_candidates')
      .update({ referral_code: next })
      .eq('id', candidateId)
      .is('referral_code', null)
      .select('referral_code');
    if (data?.length) code = next;
    else {
      // Either a unique collision (retry) or a concurrent request set it first (read it back).
      const { data: row } = await db.from('connect_candidates').select('referral_code').eq('id', candidateId).maybeSingle();
      code = (row?.referral_code as string | null) ?? null;
    }
  }
  if (!code) return null;
  const { count } = await db
    .from('connect_referrals')
    .select('id', { count: 'exact', head: true })
    .eq('referrer_candidate_id', candidateId);
  return { code, joined: count ?? 0 };
}

// POST — upsert the caller's candidate profile, geocode their ZIP, then run the
// matcher against open openings (a fresh candidate lights up existing jobs).
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const dept = String(body.dept || '');
  if (!DEPTS.includes(dept)) {
    return NextResponse.json({ error: 'invalid dept' }, { status: 400 });
  }
  const currentComp = Number(body.current_comp);
  if (!Number.isFinite(currentComp) || currentComp <= 0) {
    return NextResponse.json({ error: 'current_comp required' }, { status: 400 });
  }

  const zip = normalizeZip(body.home_zip);
  const geo = zipToLatLng(zip);
  const radius = Number.isFinite(Number(body.radius_miles)) ? Number(body.radius_miles) : 50;
  const minComp = Number.isFinite(Number(body.min_comp)) ? Number(body.min_comp) : currentComp;
  const revealMode = body.reveal_mode === 'approve' ? 'approve' : 'auto';

  const svc = await createServiceClient();
  const admin = getSupabaseAdmin();
  const { data: prior } = await admin.from('connect_candidates').select('id').eq('profile_id', user.id).maybeSingle();
  const row = {
    profile_id: user.id,
    full_name: body.full_name ? String(body.full_name) : (user.user_metadata?.full_name ?? null),
    email: body.email ? String(body.email) : user.email,
    phone: body.phone ? String(body.phone) : null,
    headline: body.headline ? String(body.headline) : null,
    dept,
    years_experience: Number.isFinite(Number(body.years_experience)) ? Number(body.years_experience) : null,
    current_comp: currentComp,
    min_comp: minComp,
    home_zip: zip || null,
    home_lat: geo?.lat ?? null,
    home_lng: geo?.lng ?? null,
    radius_miles: radius,
    open_to_work: body.open_to_work !== false,
    reveal_mode: revealMode,
    claimed_ein: body.claimed_ein ? String(body.claimed_ein) : null,
    deleted_at: null, // saving again after a delete starts a fresh profile
    // Recruiting fields — only written when sent, so older clients don't blank them.
    ...('experience_summary' in body ? { experience_summary: cleanText(body.experience_summary, 4000) } : {}),
    ...('certifications' in body ? { certifications: cleanText(body.certifications, 1000) } : {}),
    ...('linkedin_url' in body ? { linkedin_url: cleanUrl(body.linkedin_url) } : {}),
  };

  const { data: saved, error } = await svc
    .from('connect_candidates')
    .upsert(row, { onConflict: 'profile_id' })
    .select('*')
    .single();

  if (error || !saved) {
    return NextResponse.json({ error: error?.message || 'save failed' }, { status: 500 });
  }

  // Founding-network referral: only when this save CREATED the profile, from the
  // ?ref= the page carried through signup (or the cookie /connect/join set).
  const cookieStore = await cookies();
  const refCode = normalizeRefCode(body.ref) ?? normalizeRefCode(cookieStore.get(REF_COOKIE)?.value);
  if (refCode) {
    const { data: referrer } = await admin
      .from('connect_candidates')
      .select('id, deleted_at')
      .eq('referral_code', refCode)
      .maybeSingle();
    if (shouldRecordReferral({ isNewProfile: !prior, referrerId: referrer?.id, referredId: saved.id, referrerDeleted: !!referrer?.deleted_at })) {
      const { error: refErr } = await admin
        .from('connect_referrals')
        .insert({ code: refCode, referrer_candidate_id: referrer!.id, referred_candidate_id: saved.id });
      if (!refErr) await admin.from('connect_candidates').update({ referred_by: referrer!.id }).eq('id', saved.id);
      else if (refErr.code !== '23505') console.error('[connect/candidate] referral insert failed', refErr.message);
    }
  }

  let newMatches = 0;
  if (saved.open_to_work && saved.home_lat != null) {
    newMatches = await runMatchForCandidate(svc, saved as any);
  }

  const res = NextResponse.json({ candidate: saved, newMatches });
  if (refCode) res.cookies.set(REF_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}

const RESUME_BUCKET = 'resumes';
const OPEN_STAGES = ['invited', 'applied', 'screening', 'interviewing', 'offer'];

// DELETE — "Delete my candidate profile and résumé". Scrubs every personal field on
// the candidate row, deletes all résumé files, withdraws open applications and
// interests, and drops pending matches and outreach. Placement records (billing) are
// kept: the row survives as an empty shell so their foreign key holds, and the
// placement keeps the name it was billed under.
export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const db = getSupabaseAdmin();
  const { data: cand } = await db
    .from('connect_candidates')
    .select('id, full_name, deleted_at')
    .eq('profile_id', user.id)
    .maybeSingle();
  if (!cand || cand.deleted_at) return NextResponse.json({ ok: true, deleted: false });
  const now = new Date().toISOString();

  // 1. Billing records keep the name they were billed under.
  if (cand.full_name) {
    await db.from('connect_placements').update({ candidate_name: cand.full_name }).eq('candidate_id', cand.id).is('candidate_name', null);
  }

  // 2. Résumé files: everything under <candidate_id>/. First, so a storage failure leaves the profile intact to retry.
  let removed = 0;
  const { data: files, error: listErr } = await db.storage.from(RESUME_BUCKET).list(cand.id, { limit: 1000 });
  if (listErr) return NextResponse.json({ error: 'Could not reach your résumé files. Please try again.' }, { status: 500 });
  const paths = (files ?? []).map((f) => `${cand.id}/${f.name}`);
  if (paths.length) {
    const { data: gone, error: rmErr } = await db.storage.from(RESUME_BUCKET).remove(paths);
    if (rmErr) {
      console.error('[connect/candidate] résumé delete failed', rmErr.message);
      return NextResponse.json({ error: 'Could not delete your résumé files. Please try again.' }, { status: 500 });
    }
    removed = gone?.length ?? 0;
  }

  // 3. Withdraw anything still in play (logged), and drop résumé snapshots and notes.
  const { data: open } = await db.from('connect_applications').select('id, stage').eq('candidate_id', cand.id).in('stage', OPEN_STAGES);
  if (open?.length) {
    await db.from('connect_applications').update({ stage: 'withdrawn', updated_at: now }).in('id', open.map((a) => a.id));
    await logStageEvents(
      open.map((a) => ({
        application_id: a.id, from_stage: a.stage, to_stage: 'withdrawn', actor_id: user.id,
        actor_role: 'candidate' as const, note: 'candidate deleted their profile', at: now,
      })),
    );
  }
  await db.from('connect_applications').update({ resume_path: null, cover_note: null }).eq('candidate_id', cand.id);
  await db.from('connect_job_interests').update({ status: 'withdrawn', note: null }).eq('candidate_id', cand.id).neq('status', 'withdrawn');

  // 4. Pending matches and unsent outreach to them go away.
  await db.from('connect_matches').delete().eq('candidate_id', cand.id);
  const { data: targets } = await db.from('connect_prospect_targets').select('id').eq('candidate_id', cand.id);
  if (targets?.length) {
    await db
      .from('connect_outreach')
      .update({ status: 'skipped', error: 'candidate deleted profile', to_email: null, to_name: null, body_html: null, updated_at: now })
      .in('target_id', targets.map((t) => t.id))
      .in('status', ['draft', 'approved', 'needs_email']);
    await db.from('connect_prospect_targets').update({ status: 'skipped', updated_at: now }).eq('candidate_id', cand.id);
  }

  // 5. Scrub the row. dept and current_comp are NOT NULL, so they get neutral values.
  const { error } = await db
    .from('connect_candidates')
    .update({
      full_name: null, email: null, phone: null, headline: null, years_experience: null,
      current_comp: 0, min_comp: null, home_zip: null, home_lat: null, home_lng: null, radius_miles: null,
      open_to_work: false, claimed_ein: null, master_player_id: null,
      resume_path: null, resume_filename: null, resume_uploaded_at: null,
      experience_summary: null, certifications: null, linkedin_url: null,
      referral_code: null, deleted_at: now, updated_at: now,
    })
    .eq('id', cand.id);
  if (error) return NextResponse.json({ error: 'Could not delete your profile. Please try again.' }, { status: 500 });

  return NextResponse.json({ ok: true, deleted: true, withdrawn: open?.length ?? 0, resumesRemoved: removed });
}

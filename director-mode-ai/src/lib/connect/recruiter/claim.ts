/**
 * A club accepts the placement terms on a sourced job ("claims" it).
 *
 * The sourced job becomes a connect_openings row owned by the club user, and every
 * candidate who raised a hand on it (connect_job_interests, consented to being
 * presented to this club) moves into the pipeline as stage 'applied', source
 * 'ai_invite', introduced now. That move is the introduction that starts the
 * attribution clock, so it only happens once we are confident the claimer really
 * speaks for the club: their email matches a contact we found for this job, or
 * their email domain matches the club's. Anyone else gets the opening, but the
 * candidates wait until the platform owner verifies the claim in /admin/recruiting.
 */
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { scoreApplication } from '@/lib/connect/aiFit';
import { background } from '@/lib/partnerFinder/background';
import { PLACEMENT_TERMS_VERSION } from '@/lib/connect/placement';
import { zipToLatLng } from '@/lib/geo';
import { deptFor, type Evaluation } from './evaluate';

const FREE_MAIL = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com', 'me.com', 'msn.com', 'live.com', 'comcast.net', 'verizon.net', 'att.net', 'protonmail.com']);

const domainOf = (s: string | null | undefined): string | null => {
  if (!s) return null;
  const t = s.trim().toLowerCase();
  const d = t.includes('@') ? t.split('@').pop()! : t.replace(/^https?:\/\//, '').split('/')[0];
  return d.replace(/^www\./, '') || null;
};

/** Is this signed-in email someone we can trust to speak for the club? Pure. */
export function claimVerified(userEmail: string | null | undefined, contacts: { email: string | null; club_website: string | null }[]): boolean {
  const email = (userEmail || '').trim().toLowerCase();
  if (!email) return false;
  if (contacts.some((c) => (c.email || '').trim().toLowerCase() === email)) return true;
  const d = domainOf(email);
  if (!d || FREE_MAIL.has(d)) return false;
  return contacts.some((c) => domainOf(c.club_website) === d || (domainOf(c.email) === d && !FREE_MAIL.has(d)));
}

export class ClaimError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Move interested candidates into the opening's pipeline. Idempotent. */
export async function moveInterests(sourcedJobId: string): Promise<number> {
  const db = getSupabaseAdmin();
  const { data: job } = await db.from('connect_sourced_jobs').select('opening_id').eq('id', sourcedJobId).maybeSingle();
  if (!job?.opening_id) return 0;
  const { data: interests } = await db
    .from('connect_job_interests')
    .select('id, candidate_id, consent_at, note')
    .eq('sourced_job_id', sourcedJobId)
    .eq('status', 'interested');
  if (!interests?.length) return 0;
  const { data: cands } = await db.from('connect_candidates').select('id, resume_path').in('id', interests.map((i) => i.candidate_id));
  const resume = new Map((cands ?? []).map((c) => [c.id as string, c.resume_path as string | null]));
  const now = new Date().toISOString();
  const { data: apps, error } = await db
    .from('connect_applications')
    .upsert(
      interests.map((i) => ({
        opening_id: job.opening_id,
        candidate_id: i.candidate_id,
        stage: 'applied',
        source: 'ai_invite',
        consent_at: i.consent_at,
        introduced_at: now,
        cover_note: i.note ?? null,
        resume_path: resume.get(i.candidate_id) ?? null,
      })),
      { onConflict: 'opening_id,candidate_id', ignoreDuplicates: true },
    )
    .select('id');
  if (error) throw new ClaimError(error.message, 500);
  await db.from('connect_job_interests').update({ status: 'presented' }).in('id', interests.map((i) => i.id));
  const ids = (apps ?? []).map((a) => a.id as string);
  background('recruiting claim scoring', async () => {
    for (const id of ids) await scoreApplication(id);
  });
  return ids.length;
}

export async function claimSourcedJob(
  user: { id: string; email?: string | null },
  sourcedJobId: string,
  opts: { compMax?: number | null } = {},
): Promise<{ openingId: string; verified: boolean; moved: number; already?: boolean }> {
  const db = getSupabaseAdmin();
  const { data: job } = await db
    .from('connect_sourced_jobs')
    .select('id, club_name, title, dept, role_level, city, state, zip, lat, lng, comp_min, comp_max, est_comp, summary, requirements, source_url, apply_url, deadline, status, opening_id, evaluation')
    .eq('id', sourcedJobId)
    .maybeSingle();
  if (!job) throw new ClaimError('This job was not found.', 404);
  if (job.opening_id) {
    const { data: o } = await db.from('connect_openings').select('id, owner_id').eq('id', job.opening_id).maybeSingle();
    if (o?.owner_id === user.id) return { openingId: o.id, verified: true, moved: 0, already: true };
    throw new ClaimError('This job has already been claimed by the club. If that wasn\'t you, reply to our email and we\'ll sort it out.', 409);
  }
  if (job.status !== 'active') throw new ClaimError('This job is no longer active.', 410);

  const evaluation = job.evaluation as Evaluation | null;
  const compMax = opts.compMax && opts.compMax > 0 ? Math.round(opts.compMax) : job.comp_max || job.est_comp || evaluation?.target_comp || null;
  if (!compMax) throw new ClaimError('Tell us the top of the pay range for this role to continue.', 400);
  let { lat, lng } = job;
  if ((lat == null || lng == null) && job.zip) {
    const g = zipToLatLng(job.zip);
    if (g) ({ lat, lng } = g);
  }

  const now = new Date().toISOString();
  const { data: opening, error } = await db
    .from('connect_openings')
    .insert({
      owner_id: user.id,
      club_name: job.club_name,
      dept: deptFor(job),
      title: job.title,
      comp_min: job.comp_min,
      comp_max: compMax,
      zip: job.zip,
      lat,
      lng,
      city: job.city,
      state: job.state,
      description: job.summary,
      requirements: job.requirements,
      job_url: job.apply_url || job.source_url,
      deadline: job.deadline,
      status: 'open',
      is_public: true,
      terms_accepted_at: now,
      terms_version: PLACEMENT_TERMS_VERSION,
    })
    .select('id')
    .single();
  if (error || !opening) throw new ClaimError(error?.message || 'Could not create the opening.', 500);

  // Race-safe link: only one claimant wins.
  const { data: linked } = await db
    .from('connect_sourced_jobs')
    .update({ opening_id: opening.id, status: 'claimed', updated_at: now })
    .eq('id', job.id)
    .is('opening_id', null)
    .select('id');
  if (!linked?.length) {
    await db.from('connect_openings').delete().eq('id', opening.id);
    throw new ClaimError('This job was just claimed by someone else.', 409);
  }

  const { data: contacts } = await db.from('connect_club_contacts').select('email, club_website').eq('sourced_job_id', job.id);
  const verified = claimVerified(user.email, contacts ?? []);
  const moved = verified ? await moveInterests(job.id) : 0;
  // Pending prospect targets carry over so the opening's ranker doesn't start cold.
  await db.from('connect_prospect_targets').update({ opening_id: opening.id }).eq('sourced_job_id', job.id);
  return { openingId: opening.id, verified, moved };
}

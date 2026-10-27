/**
 * RECRUITER step 4 — send approved outreach, plus auto drafts (opted-in candidates only).
 *
 * Platform-paid: sendBilledEmail(null, …) routes through safeResendSend, which
 * skips unsubscribed recipients and appends the unsubscribe footer. Paced to
 * Resend's ~2/sec ceiling. Every row is re-checked at send time: a candidate who
 * turned off open-to-work, a contact marked do-not-contact, or a job that was
 * claimed or expired since drafting is skipped, not sent.
 */
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { sendBilledEmail } from '@/lib/email';
import { MIN_CONFIRMED_FOR_PITCH } from './policy';
import { refreshInterestedCount } from './outreach';
import { feeEligible } from '@/lib/connect/feeScope';

const GAP_MS = 600;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Row = {
  id: string; kind: string; sourced_job_id: string | null; opening_id: string | null; target_id: string | null; contact_id: string | null;
  to_name: string | null; to_email: string | null; subject: string | null; body_html: string | null; status: string; auto: boolean;
};

/** Only an opted-in candidate invite may ever go without a human approval. */
export function sendable(r: Pick<Row, 'kind' | 'status' | 'auto' | 'to_email'>): boolean {
  if (!r.to_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.to_email)) return false;
  if (r.status === 'approved') return true;
  return r.status === 'draft' && r.auto === true && r.kind === 'candidate_invite';
}

export type SendSummary = { sent: number; failed: number; skipped: number; considered: number };

export async function sendQueue(opts: { limit?: number; ids?: string[]; deadlineMs?: number } = {}): Promise<SendSummary> {
  const db = getSupabaseAdmin();
  const started = Date.now();
  let q = db
    .from('connect_outreach')
    .select('id, kind, sourced_job_id, opening_id, target_id, contact_id, to_name, to_email, subject, body_html, status, auto')
    .not('to_email', 'is', null)
    .or('status.eq.approved,and(status.eq.draft,auto.eq.true,kind.eq.candidate_invite)');
  if (opts.ids?.length) q = q.in('id', opts.ids);
  const { data } = await q.order('created_at').limit(opts.limit ?? 60);
  const rows = ((data as Row[] | null) ?? []).filter(sendable);
  const out: SendSummary = { sent: 0, failed: 0, skipped: 0, considered: rows.length };

  for (const r of rows) {
    if (opts.deadlineMs && Date.now() - started > opts.deadlineMs) break;
    let html = r.body_html || '';
    let skip = await skipReason(r);
    if (!skip && r.kind === 'club_pitch') {
      const fin = await finalizeClubPitch(r);
      if ('skip' in fin) skip = fin.skip;
      else html = fin.html;
    }
    if (skip) {
      await db.from('connect_outreach').update({ status: 'skipped', error: skip, updated_at: new Date().toISOString() }).eq('id', r.id);
      out.skipped++;
      continue;
    }
    // Claim the row first so a concurrent run can't double-send it.
    const { data: claimed } = await db
      .from('connect_outreach')
      .update({ status: 'sending', updated_at: new Date().toISOString() })
      .eq('id', r.id)
      .eq('status', r.status)
      .select('id');
    if (!claimed?.length) continue;

    const res = await sendBilledEmail(null, {
      platformPaid: true,
      to: r.to_email!,
      subject: r.subject || 'An opportunity from ClubMode Recruiting',
      html,
      fromName: 'ClubMode Recruiting',
      // Same as the CRM outreach: replies land in Darrin's inbox unless overridden.
      replyTo: process.env.RECRUITING_REPLY_TO || process.env.RECRUITING_LEADS_EMAIL || 'darrinjco@gmail.com',
    }).catch((e: unknown) => ({ sent: false as const, reason: 'error' as const, error: String((e as Error)?.message || e) }));
    const now = new Date().toISOString();
    if (res.sent) {
      await db.from('connect_outreach').update({ status: 'sent', sent_at: now, error: null, body_html: html, updated_at: now }).eq('id', r.id);
      if (r.target_id) await db.from('connect_prospect_targets').update({ status: 'contacted', updated_at: now }).eq('id', r.target_id).in('status', ['new', 'queued']);
      if (r.contact_id) {
        const { data: c } = await db.from('connect_club_contacts').select('touches').eq('id', r.contact_id).maybeSingle();
        await db.from('connect_club_contacts').update({ touches: (c?.touches ?? 0) + 1, last_contacted_at: now }).eq('id', r.contact_id);
      }
      if (r.kind === 'candidate_invite' && r.opening_id) await markInvited(r);
      out.sent++;
    } else {
      const unsub = 'reason' in res && res.reason === 'unsubscribed';
      await db.from('connect_outreach').update({ status: unsub ? 'skipped' : 'failed', error: unsub ? 'unsubscribed' : ('error' in res ? res.error : null) || 'send failed', updated_at: now }).eq('id', r.id);
      if (unsub && r.contact_id) await db.from('connect_club_contacts').update({ do_not_contact: true }).eq('id', r.contact_id);
      unsub ? out.skipped++ : out.failed++;
    }
    await sleep(GAP_MS);
  }
  return out;
}

async function skipReason(r: Row): Promise<string | null> {
  const db = getSupabaseAdmin();
  if (r.sourced_job_id) {
    const { data: j } = await db.from('connect_sourced_jobs').select('status, opening_id, deadline, role_level, title').eq('id', r.sourced_job_id).maybeSingle();
    if (!j) return 'job gone';
    if (r.kind === 'club_pitch' && !feeEligible(j.role_level, j.title)) return 'job board only (not a director-level role)';
    // A claimed job's candidates are moved into the pipeline; a pitch to a claimed club is moot.
    if (r.kind === 'club_pitch' && (j.status !== 'active' || j.opening_id)) return `job ${j.opening_id ? 'claimed' : j.status}`;
    if (r.kind !== 'club_pitch' && j.status !== 'active') return `job ${j.status}`;
    if (j.deadline && j.deadline < new Date().toISOString().slice(0, 10)) return 'deadline passed';
  }
  if (r.opening_id) {
    const { data: o } = await db.from('connect_openings').select('status').eq('id', r.opening_id).maybeSingle();
    if (!o || o.status !== 'open') return 'opening not open';
  }
  if (r.kind === 'candidate_invite' && r.target_id) {
    const { data: t } = await db.from('connect_prospect_targets').select('candidate_id').eq('id', r.target_id).maybeSingle();
    if (!t?.candidate_id) return 'no candidate';
    const { data: c } = await db.from('connect_candidates').select('open_to_work').eq('id', t.candidate_id).maybeSingle();
    if (!c?.open_to_work) return 'candidate no longer open to work';
  }
  if (r.contact_id) {
    const { data: c } = await db.from('connect_club_contacts').select('do_not_contact').eq('id', r.contact_id).maybeSingle();
    if (c?.do_not_contact) return 'do not contact';
  }
  return null;
}

/** Retained opening: record the invite in the pipeline (stage invited, invisible to the club until they apply). */
async function markInvited(r: Row) {
  const db = getSupabaseAdmin();
  const { data: t } = await db.from('connect_prospect_targets').select('candidate_id').eq('id', r.target_id!).maybeSingle();
  if (!t?.candidate_id) return;
  await db
    .from('connect_applications')
    .upsert(
      { opening_id: r.opening_id, candidate_id: t.candidate_id, stage: 'invited', source: 'ai_invite', invited_at: new Date().toISOString() },
      { onConflict: 'opening_id,candidate_id', ignoreDuplicates: true },
    );
}

/**
 * A club is told exactly how many candidates confirmed interest, counted now, not
 * when the draft was written. Fewer than MIN_CONFIRMED_FOR_PITCH → don't send.
 */
async function finalizeClubPitch(r: Row): Promise<{ html: string } | { skip: string }> {
  if (!r.sourced_job_id) return { skip: 'club pitch without a sourced job' };
  const db = getSupabaseAdmin();
  const [{ count }, { data: job }] = await Promise.all([
    db.from('connect_job_interests').select('id', { count: 'exact', head: true }).eq('sourced_job_id', r.sourced_job_id).eq('status', 'interested'),
    db.from('connect_sourced_jobs').select('title').eq('id', r.sourced_job_id).maybeSingle(),
  ]);
  const n = count ?? 0;
  if (n < MIN_CONFIRMED_FOR_PITCH) return { skip: `only ${n} confirmed interested at send time (need ${MIN_CONFIRMED_FOR_PITCH})` };
  const html = refreshInterestedCount(r.body_html || '', n, job?.title || 'Director of Racquets');
  if (!html) return { skip: 'interested-count sentence was edited out; re-draft so the club sees a current count' };
  return { html };
}

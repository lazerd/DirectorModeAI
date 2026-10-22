/**
 * RECRUITER step 3 — draft outreach into connect_outreach.
 *
 * The order is fixed (Darrin, 2026-10-22):
 *   rank → contact candidates → a candidate CONFIRMS interest on the job page
 *   → only then, with 2+ confirmed, pitch the club.
 *
 *   candidate_invite  opted-in candidates who fit. They consented to opportunity
 *                     alerts, so auto=true (may send without approval). Happens on
 *                     its own, no club involvement. For sourced jobs the email is
 *                     honest: the club posted the job publicly; we can present them
 *                     if they're interested; the club has not asked for them.
 *   prospect_recruit  990 directors. NOT opted in, and 990s carry no email:
 *                     status needs_email until a human adds a real one. auto=false always.
 *   club_pitch        club decision-makers from connect_club_contacts. auto=false ALWAYS.
 *                     Only when MIN_CONFIRMED_FOR_PITCH (2) candidates have a
 *                     connect_job_interests row with status 'interested'. Ranked
 *                     prospects never count toward anything a club is told. The count
 *                     is re-checked and re-stated at send time. Follow-ups: weekly at
 *                     most, max 3 touches, each with a fresh, bigger offer (new
 *                     confirmed interests or the free 990 comp memo), never a reminder.
 */
import rawData from '@/app/benchmarks/_data/benchmarks.json';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { APP_URL } from '@/lib/appUrl';
import { PLACEMENT_FEE_USD } from '@/lib/connect/placement';
import { feeEligible } from '@/lib/connect/feeScope';
import { privacyEmailLine } from '@/lib/connect/privacy';
import { CONTACT_PRIORITY, planClubTouch, shouldPitchClub, type Offer } from './policy';
import { SOURCED_JOB_FIELDS, type SourcedJob } from './evaluate';
import { OPENING_FIELDS, type OpeningRow } from './prospects';

export const SIGNER = { name: 'Darrin Cohen', org: 'ClubMode Recruiting' };
/** Candidate invites need at least this fit. */
export const INVITE_MIN_SCORE = 50;
/** 990 prospects worth a personal note. */
export const RECRUIT_MIN_SCORE = 60;
export const RECRUIT_MAX_PER_JOB = 10;

const esc = (s: unknown) =>
  String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] || c));
const firstName = (n: string | null | undefined) => {
  const f = (n || '').trim().split(/\s+/)[0] || '';
  return f ? f[0].toUpperCase() + f.slice(1).toLowerCase() : '';
};
const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
const roleOf = (j: { title?: string | null }) => j.title || 'Director of Racquets';
const placeOf = (j: { city?: string | null; state?: string | null }) => [j.city, j.state].filter(Boolean).join(', ');
const button = (href: string, label: string) =>
  `<p><a href="${href}" style="display:inline-block;background:#0d9488;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${esc(label)}</a></p>`;
const sign = `<p>${SIGNER.name}<br/>${SIGNER.org}</p>`;
const privacy = () => privacyEmailLine(APP_URL);
const offersMarker = (offers: Offer[]) => `<!-- cm-offers:${offers.join(',')} -->`;

/** Offers recorded on an earlier club email. */
export function offersIn(html: string | null | undefined): Offer[] {
  const m = (html || '').match(/<!-- cm-offers:([a-z_,]+) -->/);
  return m ? (m[1].split(',') as Offer[]) : [];
}

export const sourcedJobLink = (id: string) => `${APP_URL}/connect/jobs/s-${id}`;
export const openingLink = (id: string) => `${APP_URL}/connect/jobs/${id}`;
export const claimLink = (id: string) => `${APP_URL}/connect/claim/${id}`;
export const profileLink = () => `${APP_URL}/connect/candidate`;

type JobLike = { club_name: string | null; title: string | null; city?: string | null; state?: string | null; comp_text?: string | null; comp_max?: number | null };

/**
 * `retained` = the club is a ClubMode client (accepted terms on a connect_openings row).
 * A sourced job is just a public posting: the email must not imply the club asked for
 * the candidate or works with us. `boardOnly` = a non-director role (see feeScope): we
 * never present candidates for it, so the email points them at the club's posting.
 */
export function candidateInviteEmail(
  job: JobLike,
  name: string | null,
  link: string,
  retained = false,
  boardOnly = false,
): { subject: string; html: string } {
  const club = job.club_name || 'A private club';
  const first = firstName(name);
  const where = placeOf(job);
  const pay = job.comp_text || (job.comp_max ? `up to ${usd(job.comp_max)}` : '');
  const what = `<strong>${esc(club)}</strong>${where ? ` in ${esc(where)}` : ''} is hiring a <strong>${esc(roleOf(job))}</strong>${pay ? ` (${esc(pay)})` : ''}`;
  const body = retained
    ? `<p>${what}, hiring through ClubMode Recruiting, and it lines up with your profile on role, location and pay.</p>
<p>The club hasn't seen your profile. Nothing is shared until you apply, and applying takes one click with the résumé on your profile.</p>`
    : boardOnly
      ? `<p>${what}. They posted the job publicly, and it lines up with your ClubMode profile on role, location and pay.</p>
<p>The club isn't working with us. If it interests you, apply on their posting; the job page has the link. We haven't shared anything about you.</p>`
      : `<p>${what}. They posted the job publicly, and it lines up with your ClubMode profile on role, location and pay.</p>
<p>The club hasn't asked for you and isn't working with us yet. If you're interested, tell us on the job page and we can present you to them. Nothing is shared with the club unless you say so.</p>`;
  return {
    subject: `${club} is hiring a ${roleOf(job)}`,
    html: `<p>${first ? `Hi ${esc(first)},` : 'Hi,'}</p>
${body}
${button(link, 'See the job')}
<p style="color:#64748b;font-size:13px">You're getting this because you marked yourself open to work on ClubMode Recruiting. Turn that off on your candidate profile any time.</p>
${privacy()}`,
  };
}

export function prospectRecruitEmail(job: JobLike, p: { name: string; club: string | null }, link: string, retained = false): { subject: string; html: string } {
  const club = job.club_name || 'A private club';
  const where = placeOf(job);
  const first = firstName(p.name);
  const pay = job.comp_text || (job.comp_max ? `up to ${usd(job.comp_max)}` : '');
  const posted = retained ? `${esc(club)} is hiring through us` : `${esc(club)} posted the job publicly; they haven't asked us for anyone, but we can present you if you're interested`;
  return {
    subject: `${roleOf(job)} at ${club}`,
    html: `<p>${first ? `Hi ${esc(first)},` : 'Hi,'}</p>
<p>I came across the program${p.club ? ` at ${esc(p.club)}` : ''} and wanted to pass along a role you might want to look at. ${esc(club)}${where ? ` in ${esc(where)}` : ''} is hiring a ${esc(roleOf(job))}${pay ? `, ${esc(pay)}` : ''}. From what I can see it would be a step up.</p>
<p>Here's the job: <a href="${link}">${esc(club)}, ${esc(roleOf(job))}</a>. ${posted}.</p>
<p>If you'd like that, set up a free profile <a href="${profileLink()}">here</a>. It takes a couple of minutes, and nothing goes to any club unless you say yes to that specific job.</p>
<p>Either way, no reply needed.</p>
${sign}
${privacy()}`,
  };
}

// ---------------------------------------------------------------------------
// Comp memo from the club's own 990 (a free, real deliverable for a follow-up)
// ---------------------------------------------------------------------------

type Raw = { club: string; ein: string; dept: string; title: string; name: string; total: number; revenue?: number; year: string; recent?: boolean };
const DATA = rawData as Raw[];

export type CompMemo = { year: string; title: string; comp: number; revenue: number | null; peers: number; median: number; p75: number } | null;

export function compMemo(ein: string | null, dept: string): CompMemo {
  if (!ein) return null;
  const own = DATA.filter((r) => r.ein === ein && r.dept === dept && r.total > 0).sort((a, b) => Number(b.year) - Number(a.year))[0];
  if (!own) return null;
  const rev = own.revenue ?? null;
  const peersRows = DATA.filter(
    (r) => r.dept === dept && r.recent && r.total > 0 && r.ein !== ein && (!rev || ((r.revenue ?? 0) >= rev * 0.5 && (r.revenue ?? 0) <= rev * 2)),
  );
  if (peersRows.length < 5) return null;
  const t = peersRows.map((r) => r.total).sort((a, b) => a - b);
  return { year: own.year, title: own.title, comp: own.total, revenue: rev, peers: t.length, median: t[Math.floor(t.length / 2)], p75: t[Math.floor(t.length * 0.75)] };
}

function memoHtml(m: NonNullable<CompMemo>, club: string): string {
  const mm = (n: number) => `$${(n / 1_000_000).toFixed(1)}M`;
  const size = m.revenue ? ` (roughly ${mm(m.revenue * 0.5)}–${mm(m.revenue * 2)} in revenue)` : '';
  return `<table style="border-collapse:collapse;font-size:14px;margin:8px 0">
<tr><td style="padding:4px 12px 4px 0;color:#64748b">${esc(club)}, ${esc(m.year)} 990 (${esc(m.title)})</td><td style="padding:4px 0"><strong>${usd(m.comp)}</strong></td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#64748b">Median at ${m.peers} similar clubs${size}</td><td style="padding:4px 0"><strong>${usd(m.median)}</strong></td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#64748b">Top quartile at those clubs</td><td style="padding:4px 0"><strong>${usd(m.p75)}</strong></td></tr>
</table>`;
}

// ---------------------------------------------------------------------------
// Club pitch
// ---------------------------------------------------------------------------

export type PitchData = {
  club: string;
  title: string;
  contactName: string | null;
  /** connect_job_interests with status 'interested'. The ONLY number a pitch cites. */
  interested: number;
  newSinceLast: number;
  memo: CompMemo;
  claimUrl: string;
};

export function interestedPhrase(n: number, title: string): string {
  return `${n} qualified director${n === 1 ? ' has' : 's have'} told us they're interested in your ${esc(title)} role and asked us to put them forward.`;
}
const COUNT_SPAN_RE = /<span data-cm-count="\d+">[\s\S]*?<\/span>/;
const countSpan = (n: number, title: string) => `<span data-cm-count="${n}">${interestedPhrase(n, title)}</span>`;

/** Interested count baked into a club draft, or null if the marker was edited out. */
export function draftedCount(html: string | null | undefined): number | null {
  const m = (html || '').match(/<span data-cm-count="(\d+)">/);
  return m ? Number(m[1]) : null;
}

/** Re-state the interested count right before sending. Null if the marker is gone (don't guess). */
export function refreshInterestedCount(html: string, n: number, title: string): string | null {
  if (!COUNT_SPAN_RE.test(html)) return null;
  return html.replace(COUNT_SPAN_RE, countSpan(n, title));
}

/** The club email for a touch. Every touch leads with what is NEW; none is a reminder. */
export function clubPitchEmail(touch: number, offers: Offer[], d: PitchData): { subject: string; html: string } {
  const first = firstName(d.contactName);
  const hi = `<p>${first ? `Hi ${esc(first)},` : 'Hello,'}</p>`;
  const terms = `<p>There's no retainer and nothing to pay to look or interview. You pay a flat $${PLACEMENT_FEE_USD.toLocaleString()} only if you hire someone we introduce.</p>`;
  const cta = button(d.claimUrl, 'See the candidates');
  const pool = countSpan(d.interested, d.title);

  if (touch === 1) {
    return {
      subject: `Candidates for your ${d.title} search`,
      html: `${hi}<p>I saw ${esc(d.club)} is hiring a ${esc(d.title)}. ${pool}</p>${terms}<p>If you'd like to see who they are, accept the terms here and their applications land in your pipeline today:</p>${cta}${sign}${offersMarker(offers)}`,
    };
  }
  const parts: string[] = [];
  let subject = `New candidates for your ${d.title} search`;
  if (offers.includes('new_candidates')) {
    parts.push(`<p>Since I last wrote, ${d.newSinceLast} more director${d.newSinceLast === 1 ? '' : 's'} asked to be put forward for your ${esc(d.title)} role. ${pool}</p>`);
  } else {
    parts.push(`<p>${pool}</p>`);
  }
  if (offers.includes('comp_memo') && d.memo) {
    if (!offers.includes('new_candidates')) subject = `A pay read for ${d.club}'s ${d.title} role`;
    parts.push(
      `<p>I also put together a quick pay read for the role from public 990 filings, yours and similar-size clubs'. It's yours whether or not we work together:</p>${memoHtml(d.memo, d.club)}`,
    );
  }
  return { subject, html: `${hi}${parts.join('')}${terms}${cta}${sign}${offersMarker(offers)}` };
}

export type PitchContact = { id: string; name: string | null; role: string | null; email: string | null; touches: number; last_contacted_at: string | null; do_not_contact: boolean };
export type PitchHistory = { contact_id: string | null; status: string; sent_at: string | null; body_html: string | null };
const PENDING = ['draft', 'approved', 'needs_email', 'sending'];

/**
 * Pure: should we draft a club pitch for this job now, to whom, and what does it say?
 * Ranked prospects are deliberately NOT a parameter: only confirmed interests count.
 */
export function planClubPitch(i: {
  job: { club_name: string | null; title: string | null; role_level?: string | null; status: string; opening_id: string | null; deadline: string | null };
  interests: { created_at: string; status: string }[];
  contacts: PitchContact[];
  pitches: PitchHistory[];
  memo: CompMemo;
  claimUrl: string;
  now: Date;
}): { draft: { contact: PitchContact; touch: number; offers: Offer[]; subject: string; html: string } | null; skipped: string[] } {
  // Assistant / teaching / coaching roles stay on the job board: never pitched, never billed.
  if (!feeEligible(i.job.role_level, i.job.title)) return { draft: null, skipped: ['club_pitch: job board only (not a director-level role)'] };
  const confirmed = i.interests.filter((x) => x.status === 'interested');
  if (!shouldPitchClub(confirmed.length)) return { draft: null, skipped: [`club_pitch: ${confirmed.length} confirmed interested (need 2+)`] };
  if (i.pitches.some((p) => PENDING.includes(p.status))) return { draft: null, skipped: ['club_pitch: a pitch is already awaiting approval'] };
  const lastSent = i.pitches.filter((p) => p.sent_at).map((p) => p.sent_at!).sort().pop() ?? null;
  if (lastSent && i.now.getTime() - new Date(lastSent).getTime() < 7 * 86_400_000) return { draft: null, skipped: ['club_pitch: club emailed < 7 days ago'] };
  const jobOpen = i.job.status === 'active' && !i.job.opening_id && !(i.job.deadline && i.job.deadline < i.now.toISOString().slice(0, 10));
  const ordered = i.contacts.filter((c) => c.email).sort((a, b) => (CONTACT_PRIORITY[a.role || ''] ?? 9) - (CONTACT_PRIORITY[b.role || ''] ?? 9));
  if (!ordered.length) return { draft: null, skipped: ['club_pitch: no contacts with email yet'] };
  const skipped: string[] = [];
  for (const c of ordered) {
    const mine = i.pitches.filter((p) => p.contact_id === c.id);
    const replied = mine.some((p) => p.status === 'replied');
    const since = c.last_contacted_at;
    const newSinceLast = since ? confirmed.filter((x) => x.created_at > since).length : 0;
    const plan = planClubTouch({
      touchesSoFar: c.touches,
      lastContactedAt: c.last_contacted_at,
      now: i.now,
      doNotContact: c.do_not_contact,
      replied,
      jobOpen,
      confirmedInterested: confirmed.length,
      newConfirmedSinceLast: newSinceLast,
      hasMemo: !!i.memo,
      usedOffers: mine.flatMap((p) => offersIn(p.body_html)),
    });
    if (!plan.eligible) {
      skipped.push(`club_pitch ${c.role}: ${plan.reason}`);
      if (replied || c.do_not_contact) break; // a reply or opt-out stops the whole club sequence
      continue;
    }
    const e = clubPitchEmail(plan.touch, plan.offers, {
      club: i.job.club_name || 'your club',
      title: roleOf(i.job),
      contactName: c.name,
      interested: confirmed.length,
      newSinceLast,
      memo: i.memo,
      claimUrl: i.claimUrl,
    });
    return { draft: { contact: c, touch: plan.touch, offers: plan.offers, ...e }, skipped };
  }
  return { draft: null, skipped };
}

// ---------------------------------------------------------------------------
// Drafting
// ---------------------------------------------------------------------------

type Target = {
  id: string; candidate_id: string | null; prospect_ein: string | null; prospect_name: string | null; prospect_club: string | null;
  prospect_comp: number | null; distance_miles: number | null; fit_score: number | null; tier: string | null; status: string; created_at: string;
};
type OutRow = { id: string; kind: string; target_id: string | null; contact_id: string | null; status: string; sent_at: string | null; body_html: string | null; touch_number: number };

async function candidateEmails(ids: string[]): Promise<Map<string, { email: string | null; full_name: string | null; open_to_work: boolean | null }>> {
  if (!ids.length) return new Map();
  const { data } = await getSupabaseAdmin().from('connect_candidates').select('id, email, full_name, open_to_work').in('id', ids);
  return new Map((data ?? []).map((c) => [c.id as string, c as { email: string | null; full_name: string | null; open_to_work: boolean | null }]));
}

const pick = (e: { subject: string; html: string }) => ({ subject: e.subject, body_html: e.html });
const TARGET_FIELDS = 'id, candidate_id, prospect_ein, prospect_name, prospect_club, prospect_comp, distance_miles, fit_score, tier, status, created_at';

export type DraftCounts = { candidate_invite: number; prospect_recruit: number; club_pitch: number; skipped: string[] };

export async function draftForSourcedJob(job: SourcedJob, now = new Date()): Promise<DraftCounts> {
  const db = getSupabaseAdmin();
  const counts: DraftCounts = { candidate_invite: 0, prospect_recruit: 0, club_pitch: 0, skipped: [] };
  const [{ data: tRows }, { data: oRows }, { data: iRows }, { data: cRows }] = await Promise.all([
    db.from('connect_prospect_targets').select(TARGET_FIELDS).eq('sourced_job_id', job.id).order('fit_score', { ascending: false }),
    db.from('connect_outreach').select('id, kind, target_id, contact_id, status, sent_at, body_html, touch_number').eq('sourced_job_id', job.id),
    db.from('connect_job_interests').select('candidate_id, created_at, status').eq('sourced_job_id', job.id),
    db.from('connect_club_contacts').select('id, name, role, email, touches, last_contacted_at, do_not_contact').eq('sourced_job_id', job.id),
  ]);
  const targets = (tRows as Target[] | null) ?? [];
  const outreach = (oRows as OutRow[] | null) ?? [];
  const interests = (iRows as { candidate_id: string; created_at: string; status: string }[] | null) ?? [];
  const touched = new Set(outreach.filter((o) => o.target_id).map((o) => `${o.kind}|${o.target_id}`));
  const raisedHand = new Set(interests.map((i) => i.candidate_id));
  const boardOnly = !feeEligible(job.role_level, job.title);
  const inserts: Record<string, unknown>[] = [];

  // (a) opted-in candidates: auto, no club involvement
  const cand = targets.filter((t) => t.candidate_id && (t.fit_score ?? 0) >= INVITE_MIN_SCORE && !touched.has(`candidate_invite|${t.id}`) && !raisedHand.has(t.candidate_id!));
  const emails = await candidateEmails(cand.map((t) => t.candidate_id!));
  for (const t of cand) {
    const c = emails.get(t.candidate_id!);
    if (!c?.email || !c.open_to_work) continue;
    inserts.push({ kind: 'candidate_invite', sourced_job_id: job.id, target_id: t.id, to_name: c.full_name, to_email: c.email, ...pick(candidateInviteEmail(job, c.full_name, sourcedJobLink(job.id), false, boardOnly)), status: 'draft', auto: true });
    counts.candidate_invite++;
  }

  // (b) 990 directors: never auto, no invented emails. Not for job-board-only roles.
  for (const t of boardOnly ? [] : targets.filter((t) => t.prospect_ein && (t.fit_score ?? 0) >= RECRUIT_MIN_SCORE && !touched.has(`prospect_recruit|${t.id}`)).slice(0, RECRUIT_MAX_PER_JOB)) {
    inserts.push({ kind: 'prospect_recruit', sourced_job_id: job.id, target_id: t.id, to_name: t.prospect_name, to_email: null, ...pick(prospectRecruitEmail(job, { name: t.prospect_name || '', club: t.prospect_club }, sourcedJobLink(job.id))), status: 'needs_email', auto: false });
    counts.prospect_recruit++;
  }

  // (c) the club: approval always, and only with 2+ confirmed interested candidates
  const plan = planClubPitch({
    job,
    interests,
    contacts: (cRows as PitchContact[] | null) ?? [],
    pitches: outreach.filter((o) => o.kind === 'club_pitch'),
    memo: compMemo(job.club_ein, job.evaluation?.dept ?? 'Tennis/Racquets'),
    claimUrl: claimLink(job.id),
    now,
  });
  counts.skipped.push(...plan.skipped);
  if (plan.draft) {
    const d = plan.draft;
    inserts.push({ kind: 'club_pitch', sourced_job_id: job.id, contact_id: d.contact.id, to_name: d.contact.name, to_email: d.contact.email, subject: d.subject, body_html: d.html, status: 'draft', auto: false, touch_number: d.touch });
    counts.club_pitch++;
  }

  if (inserts.length) {
    const { error } = await db.from('connect_outreach').insert(inserts);
    if (error) throw new Error(`outreach insert failed: ${error.message}`);
    const queued = inserts.map((r) => r.target_id).filter(Boolean) as string[];
    if (queued.length) await db.from('connect_prospect_targets').update({ status: 'queued' }).in('id', queued).eq('status', 'new');
  }
  return counts;
}

/** Retained openings: candidate invites + 990 recruit notes (the club is already a client). */
export async function draftForOpening(o: OpeningRow): Promise<DraftCounts> {
  const db = getSupabaseAdmin();
  const counts: DraftCounts = { candidate_invite: 0, prospect_recruit: 0, club_pitch: 0, skipped: [] };
  const [{ data: tRows }, { data: oRows }, { data: apps }] = await Promise.all([
    db.from('connect_prospect_targets').select(TARGET_FIELDS).eq('opening_id', o.id).order('fit_score', { ascending: false }),
    db.from('connect_outreach').select('id, kind, target_id').eq('opening_id', o.id),
    db.from('connect_applications').select('candidate_id').eq('opening_id', o.id),
  ]);
  const targets = (tRows as Target[] | null) ?? [];
  const touched = new Set(((oRows as OutRow[] | null) ?? []).map((r) => `${r.kind}|${r.target_id}`));
  const inPipeline = new Set((apps ?? []).map((a) => a.candidate_id as string));
  const job: JobLike = { club_name: o.club_name, title: o.title, comp_max: o.comp_max };
  const boardOnly = !feeEligible(null, o.title);
  const inserts: Record<string, unknown>[] = [];
  const cand = targets.filter((t) => t.candidate_id && (t.fit_score ?? 0) >= INVITE_MIN_SCORE && !touched.has(`candidate_invite|${t.id}`) && !inPipeline.has(t.candidate_id!));
  const emails = await candidateEmails(cand.map((t) => t.candidate_id!));
  for (const t of cand) {
    const c = emails.get(t.candidate_id!);
    if (!c?.email || !c.open_to_work) continue;
    inserts.push({ kind: 'candidate_invite', opening_id: o.id, target_id: t.id, to_name: c.full_name, to_email: c.email, ...pick(candidateInviteEmail(job, c.full_name, openingLink(o.id), true)), status: 'draft', auto: true });
    counts.candidate_invite++;
  }
  for (const t of boardOnly ? [] : targets.filter((t) => t.prospect_ein && (t.fit_score ?? 0) >= RECRUIT_MIN_SCORE && !touched.has(`prospect_recruit|${t.id}`)).slice(0, RECRUIT_MAX_PER_JOB)) {
    inserts.push({ kind: 'prospect_recruit', opening_id: o.id, target_id: t.id, to_name: t.prospect_name, to_email: null, ...pick(prospectRecruitEmail(job, { name: t.prospect_name || '', club: t.prospect_club }, openingLink(o.id), true)), status: 'needs_email', auto: false });
    counts.prospect_recruit++;
  }
  if (inserts.length) {
    const { error } = await db.from('connect_outreach').insert(inserts);
    if (error) throw new Error(`outreach insert failed: ${error.message}`);
  }
  return counts;
}

export async function draftAll(now = new Date()): Promise<DraftCounts & { jobs: number; openings: number }> {
  const db = getSupabaseAdmin();
  const total = { candidate_invite: 0, prospect_recruit: 0, club_pitch: 0, skipped: [] as string[], jobs: 0, openings: 0 };
  const add = (c: DraftCounts, label: string) => {
    total.candidate_invite += c.candidate_invite;
    total.prospect_recruit += c.prospect_recruit;
    total.club_pitch += c.club_pitch;
    total.skipped.push(...c.skipped.map((s) => `${label}: ${s}`));
  };
  const { data: jobs } = await db.from('connect_sourced_jobs').select(SOURCED_JOB_FIELDS).eq('status', 'active').is('opening_id', null).not('evaluation', 'is', null).limit(500);
  for (const j of (jobs as SourcedJob[] | null) ?? []) {
    try {
      add(await draftForSourcedJob(j, now), j.club_name || j.id);
      total.jobs++;
    } catch (err) {
      total.skipped.push(`${j.id}: ${(err as Error).message}`);
    }
  }
  const { data: openings } = await db.from('connect_openings').select(OPENING_FIELDS).eq('status', 'open').not('terms_accepted_at', 'is', null).limit(200);
  for (const o of (openings as OpeningRow[] | null) ?? []) {
    try {
      add(await draftForOpening(o), o.club_name || o.id);
      total.openings++;
    } catch (err) {
      total.skipped.push(`${o.id}: ${(err as Error).message}`);
    }
  }
  return total;
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendBilledEmail } from '@/lib/email';
import { evaluate, type Candidate, type Opening, type MatchEdge } from '@/lib/connect/match';

// DB-facing side of ClubMode Connect: run the pure matcher against live rows,
// persist the resulting edges, and fire the two-sided notifications. All reads
// + writes use a service-role client (passed in) so RLS doesn't block the
// cross-user matchmaking.

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://club.coachmode.ai';
const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
const DEPT_LABEL: Record<string, string> = {
  'Tennis/Racquets': 'Director of Tennis / Racquets',
  Golf: 'Director of Golf',
  GM: 'General Manager / COO',
};
const deptLabel = (d: string) => DEPT_LABEL[d] || d;

type CandidateRow = Candidate & {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  reveal_mode: string | null;
  profile_id: string;
};
type OpeningRow = Opening & {
  owner_id: string;
  club_name: string | null;
  title: string | null;
};

/** Match a freshly created/updated opening against all open-to-work candidates. */
export async function runMatchForOpening(
  svc: SupabaseClient,
  opening: OpeningRow
): Promise<number> {
  if ((opening.status ?? 'open') !== 'open') return 0;

  const { data: candidates } = await svc
    .from('connect_candidates')
    .select(
      'id, profile_id, dept, current_comp, min_comp, home_lat, home_lng, radius_miles, open_to_work, full_name, email, phone, reveal_mode'
    )
    .eq('dept', opening.dept)
    .eq('open_to_work', true);

  let created = 0;
  for (const c of (candidates || []) as CandidateRow[]) {
    const edge = evaluate(opening, c);
    if (!edge) continue;
    const did = await persistAndNotify(svc, opening, c, edge);
    if (did) created++;
  }
  return created;
}

/** Match a freshly opted-in/updated candidate against all open openings. */
export async function runMatchForCandidate(
  svc: SupabaseClient,
  candidate: CandidateRow
): Promise<number> {
  if (!candidate.open_to_work) return 0;

  const { data: openings } = await svc
    .from('connect_openings')
    .select('id, owner_id, dept, comp_max, lat, lng, status, club_name, title')
    .eq('dept', candidate.dept)
    .eq('status', 'open');

  let created = 0;
  for (const o of (openings || []) as OpeningRow[]) {
    const edge = evaluate(o, candidate);
    if (!edge) continue;
    const did = await persistAndNotify(svc, o, candidate, edge);
    if (did) created++;
  }
  return created;
}

/**
 * Insert the match edge (idempotent on the unique (opening,candidate) pair) and
 * send the two notifications. Returns true if this was a NEW match (and thus
 * notified), false if the edge already existed.
 */
async function persistAndNotify(
  svc: SupabaseClient,
  opening: OpeningRow,
  candidate: CandidateRow,
  edge: MatchEdge
): Promise<boolean> {
  const approveMode = (candidate.reveal_mode ?? 'auto') === 'approve';
  const status = approveMode ? 'pending_candidate' : 'revealed';

  const { data: inserted, error } = await svc
    .from('connect_matches')
    .insert({
      opening_id: opening.id,
      candidate_id: candidate.id,
      comp_delta: edge.comp_delta,
      distance_miles: edge.distance_miles,
      score: edge.score,
      status,
      club_notified_at: new Date().toISOString(),
      candidate_notified_at: new Date().toISOString(),
    })
    .select('id')
    .maybeSingle();

  // Unique-violation => match already existed; nothing new to notify.
  if (error || !inserted) return false;

  const dist = Math.round(edge.distance_miles);
  const role = deptLabel(opening.dept);
  const offer = usd(opening.comp_max);
  const clubName = opening.club_name || 'A club';

  // --- Email the club (look up the owner's email from profiles) ---
  const { data: clubProfile } = await svc
    .from('profiles')
    .select('email')
    .eq('id', opening.owner_id)
    .maybeSingle();

  if (clubProfile?.email) {
    const contactBlock = approveMode
      ? `<p style="margin:16px 0;padding:12px 16px;background:#f1f5f9;border-radius:8px">
           This candidate uses <strong>approve-first</strong> reveal. We've asked them to confirm — you'll get their contact details the moment they accept.
         </p>`
      : `<div style="margin:16px 0;padding:12px 16px;background:#ecfdf5;border-radius:8px">
           <strong>${candidate.full_name || 'Candidate'}</strong><br/>
           ${candidate.email || ''}${candidate.phone ? `<br/>${candidate.phone}` : ''}
         </div>
         <p style="margin:16px 0">They've opted in to being contacted — reply to them directly.</p>`;

    await sendBilledEmail(opening.owner_id, {
      to: clubProfile.email,
      subject: `New match: a ${role} open to ${offer}, ${dist} mi away`,
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
          <h2 style="margin:0 0 8px">You've got a match 🎾</h2>
          <p style="margin:0 0 16px;color:#475569">
            A passive candidate matches your opening
            ${opening.title ? `for <strong>${opening.title}</strong>` : `(${role})`}.
          </p>
          <ul style="margin:0 0 16px;padding-left:18px;color:#334155">
            <li>Role: <strong>${role}</strong></li>
            <li>Your offer: <strong>up to ${offer}</strong> (≈ ${usd(edge.comp_delta)} above their current comp)</li>
            <li>Distance: <strong>${dist} mi</strong> from them — inside their relocation radius</li>
          </ul>
          ${contactBlock}
          <p style="margin:24px 0 0">
            <a href="${BASE}/connect/clubs" style="background:#0f766e;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Open your match inbox</a>
          </p>
        </div>`,
    }).catch(() => {});
  }

  // --- Email the candidate ---
  if (candidate.email) {
    const html = approveMode
      ? `
        <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
          <h2 style="margin:0 0 8px">A club wants to talk 👀</h2>
          <p style="margin:0 0 16px;color:#475569">
            ${clubName} is hiring a <strong>${role}</strong> at <strong>up to ${offer}</strong>,
            about <strong>${dist} mi</strong> from you — that's ${usd(edge.comp_delta)} above your current comp.
          </p>
          <p style="margin:0 0 16px">You're in approve-first mode, so they don't have your contact info yet. Want them to reach out?</p>
          <p style="margin:24px 0 0">
            <a href="${BASE}/connect/candidate" style="background:#0f766e;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Review &amp; approve</a>
          </p>
        </div>`
      : `
        <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
          <h2 style="margin:0 0 8px">A club is interested in you 🎾</h2>
          <p style="margin:0 0 16px;color:#475569">
            ${clubName} is hiring a <strong>${role}</strong> at <strong>up to ${offer}</strong>,
            about <strong>${dist} mi</strong> from you — that's ${usd(edge.comp_delta)} above your current comp.
          </p>
          <p style="margin:0 0 16px">Because you opted in, they now have your contact info and may reach out directly. Expect to hear from them.</p>
          <p style="margin:24px 0 0">
            <a href="${BASE}/connect/candidate" style="background:#0f766e;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Manage your profile</a>
          </p>
        </div>`;

    await sendBilledEmail(candidate.profile_id, {
      to: candidate.email,
      subject: approveMode
        ? `A club wants to talk — ${role}, ${offer}`
        : `A club is interested — ${role}, ${offer}`,
      html,
    }).catch(() => {});
  }

  return true;
}

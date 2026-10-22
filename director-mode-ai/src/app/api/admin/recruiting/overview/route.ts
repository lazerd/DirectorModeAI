import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { requireOwner } from '@/lib/connect/recruiter/adminAuth';
import { MIN_CONFIRMED_FOR_PITCH } from '@/lib/connect/recruiter/policy';

export const dynamic = 'force-dynamic';

type Row = Record<string, any>;
const CONTACTED = ['contacted', 'interested', 'applied', 'not_interested'];

// GET — the flywheel at a glance: jobs with their funnel, the approval queue, the sent log.
export async function GET() {
  const gate = await requireOwner();
  if ('response' in gate) return gate.response;
  const db = getSupabaseAdmin();

  const { data: jobs } = await db
    .from('connect_sourced_jobs')
    .select('id, source, source_url, club_name, title, role_level, city, state, comp_min, comp_max, comp_text, est_comp, club_revenue, status, evaluation, evaluated_at, opening_id, first_seen_at, deadline')
    .in('status', ['active', 'claimed'])
    .order('first_seen_at', { ascending: false })
    .limit(150);
  const jobRows = (jobs as Row[] | null) ?? [];
  const ids = jobRows.map((j) => j.id);

  const none = { data: [] as Row[] };
  const [targets, interests, contacts, pitches] = ids.length
    ? await Promise.all([
        db.from('connect_prospect_targets').select('sourced_job_id, candidate_id, prospect_name, prospect_club, prospect_comp, distance_miles, fit_score, fit_reason, tier, status').in('sourced_job_id', ids).order('fit_score', { ascending: false }),
        db.from('connect_job_interests').select('sourced_job_id, status').in('sourced_job_id', ids),
        db.from('connect_club_contacts').select('sourced_job_id, name, role, email, touches, do_not_contact').in('sourced_job_id', ids),
        db.from('connect_outreach').select('sourced_job_id, kind, status').in('sourced_job_id', ids),
      ])
    : [none, none, none, none];

  const group = (rows: Row[] | null) => {
    const m = new Map<string, Row[]>();
    for (const r of rows ?? []) {
      const list = m.get(r.sourced_job_id) ?? [];
      list.push(r);
      m.set(r.sourced_job_id, list);
    }
    return m;
  };
  const tBy = group(targets.data as Row[]);
  const iBy = group(interests.data as Row[]);
  const cBy = group(contacts.data as Row[]);
  const oBy = group(pitches.data as Row[]);

  const outJobs = jobRows.map((j) => {
    const t = tBy.get(j.id) ?? [];
    const i = iBy.get(j.id) ?? [];
    const o = oBy.get(j.id) ?? [];
    const ev = j.evaluation as Row | null;
    const confirmed = i.filter((x) => x.status === 'interested' || x.status === 'presented').length;
    const waiting = i.filter((x) => x.status === 'interested').length;
    return {
      id: j.id,
      source: j.source,
      source_url: j.source_url,
      club_name: j.club_name,
      title: j.title,
      place: [j.city, j.state].filter(Boolean).join(', '),
      comp: j.comp_text || (j.comp_max ? `$${Math.round(j.comp_max / 1000)}k` : null),
      est_comp: j.est_comp,
      status: j.status,
      opening_id: j.opening_id,
      evaluation: ev
        ? {
            target_comp: ev.target_comp,
            comp_source: ev.comp_source,
            bands: ev.bands,
            ideal_candidate: ev.ideal_candidate,
            must_haves: ev.must_haves,
            screening_questions: ev.screening_questions,
            ai: ev.ai,
          }
        : null,
      contacts: (cBy.get(j.id) ?? []).map((c) => ({ name: c.name, role: c.role, hasEmail: !!c.email, touches: c.touches, dnc: c.do_not_contact })),
      top: t.slice(0, 5).map((p) => ({ name: p.prospect_name, club: p.prospect_club, fit: p.fit_score, reason: p.fit_reason, optedIn: !!p.candidate_id, status: p.status })),
      funnel: {
        ranked: t.length,
        contacted: t.filter((p) => CONTACTED.includes(p.status)).length,
        confirmed,
        pitched: o.filter((x) => x.kind === 'club_pitch' && x.status === 'sent').length,
        claimed: !!j.opening_id,
      },
      pitchReady: confirmed >= MIN_CONFIRMED_FOR_PITCH,
      // Claimed by someone we couldn't verify: candidates are waiting for a human OK.
      pendingVerification: !!j.opening_id && waiting > 0,
    };
  });

  const [{ data: queue }, { data: sent }] = await Promise.all([
    db
      .from('connect_outreach')
      .select('id, kind, sourced_job_id, opening_id, to_name, to_email, subject, body_html, status, auto, touch_number, created_at, error')
      .in('status', ['draft', 'approved', 'needs_email'])
      .order('created_at', { ascending: false })
      .limit(300),
    db
      .from('connect_outreach')
      .select('id, kind, sourced_job_id, to_name, to_email, subject, status, auto, touch_number, sent_at, updated_at, error')
      .in('status', ['sent', 'failed', 'skipped', 'replied', 'sending'])
      .order('updated_at', { ascending: false })
      .limit(150),
  ]);
  const clubOf = new Map(jobRows.map((j) => [j.id, j.club_name]));
  const label = (r: Row) => clubOf.get(r.sourced_job_id) ?? null;

  return NextResponse.json({
    jobs: outJobs,
    queue: ((queue as Row[] | null) ?? []).map((r) => ({ ...r, club: label(r) })),
    sent: ((sent as Row[] | null) ?? []).map((r) => ({ ...r, club: label(r) })),
    minConfirmedForPitch: MIN_CONFIRMED_FOR_PITCH,
  });
}

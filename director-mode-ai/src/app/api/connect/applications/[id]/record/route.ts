import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { isPlatformOwnerEmail } from '@/lib/platformOwner';
import { auditFilename, auditRecord, auditRecordText, type AuditInput } from '@/lib/connect/auditRecord';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/connect/applications/:id/record[?format=json] — the placement audit record
// for a hired applicant, as a download. Only the club that owns the opening, or the
// platform owner, may fetch it.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const db = getSupabaseAdmin();
  const { data: app } = await db
    .from('connect_applications')
    .select('id, opening_id, candidate_id, source, stage, consent_at, introduced_at, invited_at, created_at, hired_at, start_date')
    .eq('id', id)
    .maybeSingle();
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const { data: opening } = await db
    .from('connect_openings')
    .select('id, owner_id, club_name, title, dept, city, state, terms_version, terms_accepted_at, terms_accepted_by')
    .eq('id', app.opening_id)
    .maybeSingle();
  if (!opening) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const isOwner = isPlatformOwnerEmail(user.email);
  if (!isOwner && opening.owner_id !== user.id) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const [{ data: placement }, { data: events }, { data: cand }] = await Promise.all([
    db
      .from('connect_placements')
      .select('id, fee_cents, status, guarantee_until, start_date, terms_version, invoice_ref, candidate_name')
      .eq('application_id', app.id)
      .maybeSingle(),
    db.from('connect_application_events').select('from_stage, to_stage, actor_id, actor_role, note, at').eq('application_id', app.id).order('at'),
    db.from('connect_candidates').select('full_name').eq('id', app.candidate_id).maybeSingle(),
  ]);
  if (app.stage !== 'hired' && !placement) {
    return NextResponse.json({ error: 'A record is available once the applicant is marked hired.' }, { status: 404 });
  }

  // Account emails for the club / platform people who acted (candidates are shown by role only).
  const emailIds = new Set<string>([opening.owner_id]);
  if (opening.terms_accepted_by) emailIds.add(opening.terms_accepted_by);
  for (const e of events ?? []) if (e.actor_id && e.actor_role !== 'candidate') emailIds.add(e.actor_id);
  const emails = new Map<string, string>();
  await Promise.all(
    Array.from(emailIds).map(async (uid) => {
      const { data } = await db.auth.admin.getUserById(uid);
      if (data?.user?.email) emails.set(uid, data.user.email);
    }),
  );

  const input: AuditInput = {
    generated_at: new Date().toISOString(),
    club: { name: opening.club_name, owner_email: emails.get(opening.owner_id) ?? null },
    opening: { id: opening.id, title: opening.title, dept: opening.dept, city: opening.city, state: opening.state },
    terms: {
      version: opening.terms_version,
      accepted_at: opening.terms_accepted_at,
      accepted_by: opening.terms_accepted_by ? emails.get(opening.terms_accepted_by) ?? opening.terms_accepted_by : null,
    },
    application: {
      id: app.id, source: app.source, consent_at: app.consent_at, introduced_at: app.introduced_at, invited_at: app.invited_at,
      created_at: app.created_at, hired_at: app.hired_at, start_date: app.start_date, stage: app.stage,
    },
    candidate: { name: placement?.candidate_name ?? cand?.full_name ?? null },
    events: (events ?? []).map((e) => ({
      at: e.at,
      from_stage: e.from_stage,
      to_stage: e.to_stage,
      actor_role: e.actor_role,
      actor: e.actor_id && e.actor_role !== 'candidate' ? emails.get(e.actor_id) ?? e.actor_id : null,
      note: e.note,
    })),
    placement: placement
      ? {
          id: placement.id, fee_cents: placement.fee_cents, status: placement.status, guarantee_until: placement.guarantee_until,
          start_date: placement.start_date, terms_version: placement.terms_version, invoice_ref: placement.invoice_ref,
        }
      : null,
  };

  const json = new URL(req.url).searchParams.get('format') === 'json';
  const body = json ? JSON.stringify(auditRecord(input), null, 2) : auditRecordText(input);
  return new NextResponse(body, {
    headers: {
      'Content-Type': json ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${auditFilename(opening.club_name, app.id, json ? 'json' : 'txt')}"`,
      'Cache-Control': 'no-store',
    },
  });
}

import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { zipToLatLng, normalizeZip } from '@/lib/geo';
import { runMatchForOpening } from '@/lib/connect/engine';
import { PLACEMENT_TERMS_VERSION, PLACEMENT_FEE_USD } from '@/lib/connect/placement';

const DEPTS = ['Tennis/Racquets', 'Golf', 'GM'];

// POST — create or update a club opening. Geocodes the ZIP, persists the row,
// then runs the matcher against all open-to-work candidates and notifies both
// sides. Pass `id` in the body to update an existing opening (e.g. mark filled).
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const dept = String(body.dept || '');
  if (!DEPTS.includes(dept)) {
    return NextResponse.json({ error: 'invalid dept' }, { status: 400 });
  }
  const compMax = Number(body.comp_max);
  if (!Number.isFinite(compMax) || compMax <= 0) {
    return NextResponse.json({ error: 'comp_max required' }, { status: 400 });
  }

  const zip = normalizeZip(body.zip);
  const geo = zipToLatLng(zip);
  const status = ['open', 'filled', 'closed'].includes(body.status) ? body.status : 'open';

  const svc = await createServiceClient();
  const row: Record<string, any> = {
    owner_id: user.id,
    club_id: body.club_id || null,
    club_name: body.club_name ? String(body.club_name) : null,
    dept,
    title: body.title ? String(body.title) : null,
    comp_min: Number.isFinite(Number(body.comp_min)) ? Number(body.comp_min) : null,
    comp_max: compMax,
    zip: zip || null,
    lat: geo?.lat ?? null,
    lng: geo?.lng ?? null,
    description: body.description ? String(body.description) : null,
    status,
  };

  // Job-board fields. Only touched when sent, so a status-only update
  // (Mark filled / Reopen) never wipes them.
  const optText = (v: unknown, max: number) => (v == null || v === '' ? null : String(v).trim().slice(0, max) || null);
  if ('requirements' in body) row.requirements = optText(body.requirements, 5000);
  if ('job_url' in body) {
    const u = optText(body.job_url, 500);
    if (u && !/^https?:\/\//i.test(u)) {
      return NextResponse.json({ error: 'Job URL must start with http:// or https://' }, { status: 400 });
    }
    row.job_url = u;
  }
  if ('deadline' in body) {
    const d = optText(body.deadline, 10);
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      return NextResponse.json({ error: 'Deadline must be a date (YYYY-MM-DD).' }, { status: 400 });
    }
    row.deadline = d;
  }
  if ('city' in body) row.city = optText(body.city, 120);
  if ('state' in body) row.state = optText(body.state, 40)?.toUpperCase() ?? null;
  if ('is_public' in body) row.is_public = body.is_public !== false;
  const acceptTerms = body.accept_terms === true;

  // Update path: only touch a row this user owns.
  let saved: any;
  if (body.id) {
    const { data, error } = await svc
      .from('connect_openings')
      .update(row)
      .eq('id', body.id)
      .eq('owner_id', user.id)
      .select('*')
      .maybeSingle();
    if (error || !data) {
      return NextResponse.json({ error: error?.message || 'not found' }, { status: 404 });
    }
    saved = data;
    // Accepting terms on an older opening that never had them; existing acceptance is kept as-is.
    if (acceptTerms && !saved.terms_accepted_at) {
      const { data: accepted } = await svc
        .from('connect_openings')
        .update({ terms_accepted_at: new Date().toISOString(), terms_accepted_by: user.id, terms_version: PLACEMENT_TERMS_VERSION })
        .eq('id', saved.id)
        .eq('owner_id', user.id)
        .is('terms_accepted_at', null)
        .select('*')
        .maybeSingle();
      if (accepted) saved = accepted;
    }
  } else {
    if (!acceptTerms) {
      return NextResponse.json(
        { error: `Please accept the placement terms to post this opening: you pay a flat $${PLACEMENT_FEE_USD.toLocaleString()} only if you hire a candidate ClubMode introduces.` },
        { status: 400 },
      );
    }
    row.terms_accepted_at = new Date().toISOString();
    row.terms_version = PLACEMENT_TERMS_VERSION;
    row.terms_accepted_by = user.id;
    const { data, error } = await svc
      .from('connect_openings')
      .insert(row)
      .select('*')
      .single();
    if (error || !data) {
      return NextResponse.json({ error: error?.message || 'save failed' }, { status: 500 });
    }
    saved = data;
  }

  let newMatches = 0;
  if (saved.status === 'open' && saved.lat != null) {
    newMatches = await runMatchForOpening(svc, saved);
  }

  return NextResponse.json({ opening: saved, newMatches });
}

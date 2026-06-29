import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { zipToLatLng, normalizeZip } from '@/lib/geo';
import { runMatchForOpening } from '@/lib/connect/engine';

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
  } else {
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

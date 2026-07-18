/**
 * PATCH /api/tournaments/events/[id]
 *
 * Director-only. Updates editable settings on a tournament event: court count,
 * court names, match length, daily start/end, scoring format, name, dates.
 * This is what the desk Settings tab writes to (replacing the old "edit in
 * Supabase" stub) — the fix for the "stuck at 2 courts" problem.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await params;

  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data: ev } = await admin
    .from('events')
    .select('id, user_id')
    .eq('id', eventId)
    .maybeSingle();
  if (!ev) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  if ((ev as any).user_id !== user.id) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  const errors: string[] = [];

  if ('name' in body) {
    const name = String(body.name ?? '').trim();
    if (!name) errors.push('name cannot be empty');
    else update.name = name.slice(0, 200);
  }

  if ('num_courts' in body) {
    const n = Number(body.num_courts);
    if (!Number.isInteger(n) || n < 1 || n > 40) errors.push('num_courts must be 1–40');
    else {
      update.num_courts = n;
      // Clear any explicit court_names so the resolver falls back to 1..n,
      // unless the caller is also sending court_names.
      if (!('court_names' in body)) update.court_names = null;
    }
  }

  if ('court_names' in body) {
    const cn = body.court_names;
    if (cn === null) update.court_names = null;
    else if (Array.isArray(cn)) update.court_names = cn.map((c) => String(c).trim()).filter(Boolean);
    else errors.push('court_names must be an array or null');
  }

  if ('default_match_length_minutes' in body) {
    const m = Number(body.default_match_length_minutes);
    if (!Number.isInteger(m) || m < 5 || m > 240) errors.push('match length must be 5–240 minutes');
    else update.default_match_length_minutes = m;
  }

  if ('daily_start_time' in body) {
    const t = String(body.daily_start_time ?? '').trim();
    if (t && !TIME_RE.test(t)) errors.push('daily_start_time must be HH:MM');
    else update.daily_start_time = t || null;
  }

  if ('daily_end_time' in body) {
    const t = String(body.daily_end_time ?? '').trim();
    if (t && !TIME_RE.test(t)) errors.push('daily_end_time must be HH:MM');
    else update.daily_end_time = t || null;
  }

  if ('event_scoring_format' in body) {
    update.event_scoring_format = String(body.event_scoring_format ?? '').trim() || null;
  }

  if ('event_date' in body) {
    const d = String(body.event_date ?? '').trim();
    if (d && !DATE_RE.test(d)) errors.push('event_date must be YYYY-MM-DD');
    else update.event_date = d || null;
  }

  if ('end_date' in body) {
    const d = String(body.end_date ?? '').trim();
    if (d && !DATE_RE.test(d)) errors.push('end_date must be YYYY-MM-DD');
    else update.end_date = d || null;
  }

  if (errors.length) return NextResponse.json({ error: errors.join('; ') }, { status: 400 });
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });
  }

  const { data: updated, error } = await admin
    .from('events')
    .update(update)
    .eq('id', eventId)
    .select('id, name, num_courts, court_names, event_scoring_format, default_match_length_minutes, daily_start_time, daily_end_time, event_date, end_date')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, event: updated });
}

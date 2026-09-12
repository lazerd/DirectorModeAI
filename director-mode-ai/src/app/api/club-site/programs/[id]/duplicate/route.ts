/**
 * POST /api/club-site/programs/[id]/duplicate
 *
 * "Copy for next season" — the other half of the pain. A director does not
 * write a new class each term; they run the same one again with new dates. So
 * this clones everything, shifts the range forward by the length of the old
 * one (or to dates the caller supplies), CLEARS the skip dates, and starts as
 * a draft with nobody enrolled.
 *
 * Clearing exclusions is the deliberate bit: last season's holidays are not
 * this season's, and a stale skip date silently cancels a class nobody meant
 * to cancel.
 */

import { NextResponse } from 'next/server';
import { requireStaffForClub } from '@/lib/courtsheet/routeAuth';
import { slugifyTitle } from '@/lib/programs/schema';

export const dynamic = 'force-dynamic';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

const addDays = (ymd: string, days: number): string => {
  // Midday UTC so a DST shift cannot roll the date backwards.
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const dayDiff = (a: string, b: string): number =>
  Math.round(
    (new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86_400_000,
  );

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffForClub({ requireWrite: true });
  if ('error' in ctx) return ctx.error;
  const { id } = await params;

  const { data: source } = await ctx.db
    .from('club_programs')
    .select('*')
    .eq('id', id)
    .eq('club_id', ctx.club.id)
    .maybeSingle();
  if (!source) return NextResponse.json({ error: 'No such class.' }, { status: 404 });

  const src = source as Record<string, unknown>;
  const body = (await req.json().catch(() => ({}))) as {
    range_start?: string;
    range_end?: string;
    title?: string;
  };

  const oldStart = String(src.range_start).slice(0, 10);
  const oldEnd = String(src.range_end).slice(0, 10);
  const span = Math.max(0, dayDiff(oldStart, oldEnd));

  let rangeStart = body.range_start && YMD.test(body.range_start) ? body.range_start : null;
  let rangeEnd = body.range_end && YMD.test(body.range_end) ? body.range_end : null;
  if (!rangeStart) {
    // Default: the day after the old session ended, same length. A director
    // who wants different dates overrides in the form; nobody has to do
    // arithmetic to get a sensible starting point.
    rangeStart = addDays(oldEnd, 1);
  }
  if (!rangeEnd) rangeEnd = addDays(rangeStart, span);
  if (rangeEnd < rangeStart) {
    return NextResponse.json(
      { error: 'The last date cannot be before the first.' },
      { status: 400 },
    );
  }

  const title = (body.title || `${String(src.title)} (copy)`).slice(0, 160);
  const wanted = slugifyTitle(title);
  let slug = wanted;
  for (let n = 2; n < 50; n += 1) {
    const { data: clash } = await ctx.db
      .from('club_programs')
      .select('id')
      .eq('club_id', ctx.club.id)
      .eq('slug', slug)
      .maybeSingle();
    if (!clash) break;
    slug = `${wanted}-${n}`;
  }

  const { data, error } = await ctx.db
    .from('club_programs')
    .insert({
      club_id: ctx.club.id,
      created_by: ctx.user.id,
      slug,
      title,
      subtitle: src.subtitle,
      sport: src.sport,
      audience: src.audience,
      age_min: src.age_min,
      age_max: src.age_max,
      level_note: src.level_note,
      range_start: rangeStart,
      range_end: rangeEnd,
      days_of_week: src.days_of_week,
      // Last season's holidays are not this season's.
      exclusions: [],
      time_start: src.time_start,
      time_end: src.time_end,
      price_cents: src.price_cents,
      member_price_cents: src.member_price_cents,
      drop_in_price_cents: src.drop_in_price_cents,
      price_note: src.price_note,
      capacity: src.capacity,
      waitlist_enabled: src.waitlist_enabled,
      registration_mode: src.registration_mode,
      external_payment_url: src.external_payment_url,
      description: src.description,
      coach_name: src.coach_name,
      location_note: src.location_note,
      image_url: src.image_url,
      display_order: src.display_order,
      // A draft: nobody should be able to register for next season the instant
      // a director clicks copy, before they have checked the dates.
      status: 'draft',
      // Never carried over: a new session's registration window is its own,
      // and a stale series_id would point the new class at old court blocks.
      registration_opens_at: null,
      registration_closes_at: null,
      series_id: null,
    })
    .select('*')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, program: data });
}

import { NextResponse } from 'next/server';
import { requireCalendarContext, isAuthError, loadPlan } from '@/lib/calendar/server';
import { buildRepeatCandidates, type PastEvent } from '@/lib/calendar/repeat';
import { TOURNAMENT_FORMATS, MIXER_FORMATS } from '@/lib/eventCategory';

// GET  /api/calendar/repeat?year=2027[&from=2026] — what the club ran last year,
//      grouped into things worth repeating, with dates mapped forward.
// POST /api/calendar/repeat — add the chosen ones to the plan.
//
// This is the first step of planning a year, and it was the piece missing from
// the original build: past events were being imported as CONFLICTS to avoid
// rather than as a proven slate to repeat. A club's own events beat anything a
// catalog can suggest.
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const ctx = await requireCalendarContext();
  if (isAuthError(ctx)) return ctx.error;

  const url = new URL(req.url);
  const targetYear = Number(url.searchParams.get('year')) || new Date().getUTCFullYear() + 1;
  const sourceYear = Number(url.searchParams.get('from')) || targetYear - 1;

  // Scoped by user_id as well as club_id: club_id was backfilled later, so
  // older rows may still be null and a club-only filter would miss exactly the
  // history a director most wants to repeat.
  const { data: events } = await ctx.db
    .from('events')
    .select('id, name, event_date, end_date, match_format, entry_fee_cents, num_courts, start_time')
    .or(`club_id.eq.${ctx.club.id},user_id.eq.${ctx.user.id}`)
    .gte('event_date', `${sourceYear}-01-01`)
    .lte('event_date', `${sourceYear}-12-31`)
    .order('event_date', { ascending: true })
    .limit(500);

  const rows = ((events ?? []) as any[]).map((e) => ({
    ...e,
    event_date: String(e.event_date).slice(0, 10),
    end_date: e.end_date ? String(e.end_date).slice(0, 10) : null,
  })) as PastEvent[];

  const candidates = buildRepeatCandidates(rows, targetYear);

  return NextResponse.json({
    sourceYear,
    targetYear,
    scanned: rows.length,
    // How many raw rows were dropped as junk or folded into a series — shown
    // so the count difference never looks like data going missing.
    candidates,
  });
}

export async function POST(req: Request) {
  const ctx = await requireCalendarContext({ requirePro: true });
  if (isAuthError(ctx)) return ctx.error;

  const body = await req.json().catch(() => null);
  const planId = String(body?.planId || '');
  if (!planId) return NextResponse.json({ error: 'Missing planId.' }, { status: 400 });

  const plan = await loadPlan(ctx.db, ctx.club.id, planId);
  if (!plan) return NextResponse.json({ error: 'Plan not found.' }, { status: 404 });

  const picked: any[] = Array.isArray(body?.candidates) ? body.candidates : [];
  if (picked.length === 0) {
    return NextResponse.json({ error: 'Nothing selected.' }, { status: 400 });
  }

  const rows: Record<string, unknown>[] = [];

  for (const c of picked) {
    const title = String(c?.title ?? '').trim().slice(0, 200);
    const dates: string[] = Array.isArray(c?.proposedDates)
      ? c.proposedDates.filter((d: unknown) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))
      : [];
    if (!title || dates.length === 0) continue;

    const format = typeof c?.match_format === 'string'
      && (TOURNAMENT_FORMATS.has(c.match_format) || MIXER_FORMATS.has(c.match_format))
      ? c.match_format
      : null;

    // A series becomes one calendar item per occurrence, numbered, so the list
    // view shows the cadence and each one can be moved independently.
    dates.slice(0, 60).forEach((date, i) => {
      rows.push({
        plan_id: planId,
        club_id: ctx.club.id,
        title: dates.length > 1 ? `${title} #${i + 1}` : title,
        catalog_key: null,
        description: `Repeating from ${plan.year - 1}.`,
        department: 'tennis',
        audience: [],
        format_hint: format,
        status: 'scheduled',
        target_date: date,
        start_time: typeof c?.start_time === 'string' && /^\d{2}:\d{2}$/.test(c.start_time) ? c.start_time : null,
        courts_needed: Number.isFinite(Number(c?.num_courts)) ? Math.max(0, Math.min(30, Number(c.num_courts))) : null,
        entry_fee_cents: Number.isFinite(Number(c?.entry_fee_cents)) ? Math.max(0, Number(c.entry_fee_cents)) : null,
        score_breakdown: { reasons: [{ detail: `You ran this in ${plan.year - 1}.` }] },
      });
    });
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Nothing valid to add.' }, { status: 400 });
  }
  if (rows.length > 200) {
    return NextResponse.json({ error: 'That would add over 200 events — trim the selection.' }, { status: 400 });
  }

  const { data, error } = await ctx.db.from('calendar_items').insert(rows).select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ added: (data ?? []).length });
}

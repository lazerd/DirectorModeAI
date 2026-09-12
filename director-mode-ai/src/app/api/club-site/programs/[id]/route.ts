/**
 * GET / PATCH / DELETE one class.
 *
 * PATCH is where the money is. A director toggling a skip date sends
 * `{ exclusions: [...] }` and nothing else, and the response tells them what
 * that just did: how many sessions remain, which dates went, and how many
 * families are enrolled and therefore need telling. That last number is what
 * makes the difference between an editor and a thing that actually replaces
 * paying somebody every season.
 */

import { NextResponse } from 'next/server';
import { requireStaffForClub } from '@/lib/courtsheet/routeAuth';
import { programPatchSchema } from '@/lib/programs/schema';
import { programSessions } from '@/lib/programs/sessions';

export const dynamic = 'force-dynamic';

async function load(
  ctx: Awaited<ReturnType<typeof requireStaffForClub>> & { db: unknown },
  id: string,
) {
  const c = ctx as Extract<Awaited<ReturnType<typeof requireStaffForClub>>, { db: unknown }>;
  const { data } = await c.db
    .from('club_programs')
    .select('*')
    .eq('id', id)
    .eq('club_id', c.club.id)
    .maybeSingle();
  return data as Record<string, unknown> | null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffForClub();
  if ('error' in ctx) return ctx.error;
  const { id } = await params;

  const program = await load(ctx, id);
  if (!program) return NextResponse.json({ error: 'No such class.' }, { status: 404 });

  const { data: registrations } = await ctx.db
    .from('club_program_registrations')
    .select('*')
    .eq('program_id', id)
    .order('status')
    .order('created_at');

  return NextResponse.json({
    program,
    registrations: registrations ?? [],
    timezone: ctx.club.timezone,
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffForClub({ requireWrite: true });
  if ('error' in ctx) return ctx.error;
  const { id } = await params;

  const before = await load(ctx, id);
  if (!before) return NextResponse.json({ error: 'No such class.' }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const parsed = programPatchSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: `${first?.path?.join('.') || 'That'}: ${first?.message || 'not valid'}` },
      { status: 400 },
    );
  }

  // Only the keys the caller mentioned, so a one-field autosave cannot blank
  // the rest of the row. undefined becomes null so a cleared field clears.
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(body as Record<string, unknown>)) {
    if (!(key in parsed.data)) continue;
    const value = (parsed.data as Record<string, unknown>)[key];
    patch[key] = value === undefined ? null : value;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 });
  }

  // Cross-field rules the partial schema cannot see, because a PATCH changing
  // only range_end has to be checked against the stored range_start.
  const merged = { ...before, ...patch } as Record<string, string>;
  if (String(merged.range_end) < String(merged.range_start)) {
    return NextResponse.json(
      { error: 'The last date cannot be before the first.' },
      { status: 400 },
    );
  }
  if (String(merged.time_end) <= String(merged.time_start)) {
    return NextResponse.json(
      { error: 'The end time has to be after the start time.' },
      { status: 400 },
    );
  }

  const { data: after, error } = await ctx.db
    .from('club_programs')
    .update(patch)
    .eq('id', id)
    .eq('club_id', ctx.club.id)
    .select('*')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const tz = ctx.club.timezone;
  const wasSessions = programSessions(before as never, tz);
  const nowSessions = programSessions(after as never, tz);

  // Who this change lands on. The editor puts this number on the Notify
  // button, so a date change is never silently invisible to the families.
  const { count: affected } = await ctx.db
    .from('club_program_registrations')
    .select('id', { count: 'exact', head: true })
    .eq('program_id', id)
    .neq('status', 'cancelled');

  const priceChanged =
    'price_cents' in patch && Number(before.price_cents) !== Number(after?.price_cents);

  return NextResponse.json({
    ok: true,
    program: after,
    sessions: nowSessions,
    /** What to say in the notification, built from what actually changed. */
    changes: {
      dates_removed: nowSessions.skipped.filter((d) => !wasSessions.skipped.includes(d)),
      dates_restored: wasSessions.skipped.filter((d) => !nowSessions.skipped.includes(d)),
      price_changed: priceChanged,
      old_price_cents: priceChanged ? Number(before.price_cents) : null,
      session_count_was: wasSessions.count,
      session_count_now: nowSessions.count,
    },
    affected_registrations: affected ?? 0,
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffForClub({ requireWrite: true });
  if ('error' in ctx) return ctx.error;
  const { id } = await params;

  const program = await load(ctx, id);
  if (!program) return NextResponse.json({ error: 'No such class.' }, { status: 404 });

  const { count } = await ctx.db
    .from('club_program_registrations')
    .select('id', { count: 'exact', head: true })
    .eq('program_id', id)
    .neq('status', 'cancelled');

  // A class with families in it is archived, never deleted. Deleting would
  // cascade their registrations away, and those rows are the club's record of
  // who has ever played there.
  if ((count ?? 0) > 0) {
    const { error } = await ctx.db
      .from('club_programs')
      .update({ status: 'archived' })
      .eq('id', id)
      .eq('club_id', ctx.club.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({
      ok: true,
      archived: true,
      message: `Archived instead of deleted — ${count} ${count === 1 ? 'family is' : 'families are'} signed up, and their registrations are your record.`,
    });
  }

  const { error } = await ctx.db
    .from('club_programs')
    .delete()
    .eq('id', id)
    .eq('club_id', ctx.club.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, deleted: true });
}

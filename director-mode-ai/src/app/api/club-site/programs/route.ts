/**
 * GET  /api/club-site/programs  — every class, drafts included, with counts
 * POST /api/club-site/programs  — create one
 *
 * The GET carries enrollment counts because the editor's whole reason for
 * existing is that a director changes a date and immediately needs to know how
 * many families that affects.
 */

import { NextResponse } from 'next/server';
import { requireStaffForClub } from '@/lib/courtsheet/routeAuth';
import { programWriteSchema, slugifyTitle } from '@/lib/programs/schema';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await requireStaffForClub();
  if ('error' in ctx) return ctx.error;

  const { data: programs } = await ctx.db
    .from('club_programs')
    .select('*')
    .eq('club_id', ctx.club.id)
    .neq('status', 'archived')
    .order('display_order')
    .order('range_start');

  const rows = (programs as { id: string }[] | null) ?? [];

  // One query for every program's counts rather than one per program.
  const counts = new Map<string, { enrolled: number; waitlist: number; unpaid: number }>();
  if (rows.length) {
    const { data: regs } = await ctx.db
      .from('club_program_registrations')
      .select('program_id, status, payment_status')
      .in(
        'program_id',
        rows.map((r) => r.id),
      );
    for (const r of (regs as
      | { program_id: string; status: string; payment_status: string }[]
      | null) ?? []) {
      const c = counts.get(r.program_id) ?? { enrolled: 0, waitlist: 0, unpaid: 0 };
      if (r.status === 'enrolled') c.enrolled += 1;
      if (r.status === 'waitlist') c.waitlist += 1;
      if (r.status !== 'cancelled' && r.payment_status === 'pending') c.unpaid += 1;
      counts.set(r.program_id, c);
    }
  }

  return NextResponse.json({
    programs: rows.map((p) => ({
      ...p,
      counts: counts.get(p.id) ?? { enrolled: 0, waitlist: 0, unpaid: 0 },
    })),
    club: { id: ctx.club.id, slug: ctx.club.slug, name: ctx.club.name, timezone: ctx.club.timezone },
  });
}

export async function POST(req: Request) {
  const ctx = await requireStaffForClub({ requireWrite: true });
  if ('error' in ctx) return ctx.error;

  const body = await req.json().catch(() => null);
  const parsed = programWriteSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: `${first?.path?.join('.') || 'That'}: ${first?.message || 'not valid'}` },
      { status: 400 },
    );
  }

  const wanted = parsed.data.slug || slugifyTitle(parsed.data.title);

  // Two seasons of "After-School Juniors" is the normal case, not a mistake, so
  // the second one gets -2 rather than an error a director has to decode.
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
    .insert({ ...parsed.data, slug, club_id: ctx.club.id, created_by: ctx.user.id })
    .select('*')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, program: data });
}

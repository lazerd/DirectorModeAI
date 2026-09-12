/**
 * Who has ever registered for a class here.
 *
 * Answers "We send out emails to all past participants" — the club's own list,
 * built as a side effect of every registration rather than maintained by hand
 * in a spreadsheet that goes stale the week after it is made.
 *
 * Grouped by the class they came through, because that is the useful cut: a
 * director promoting next term's after-school juniors wants last term's
 * after-school parents, not the adult clinic.
 */

import { NextResponse } from 'next/server';
import { requireStaffForClub } from '@/lib/courtsheet/routeAuth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await requireStaffForClub();
  if ('error' in ctx) return ctx.error;

  const { data: programs } = await ctx.db
    .from('club_programs')
    .select('id, title, slug, range_start, range_end, audience, sport, status')
    .eq('club_id', ctx.club.id)
    .order('range_start', { ascending: false });

  const rows = (programs as
    | {
        id: string;
        title: string;
        slug: string;
        range_start: string;
        range_end: string;
        audience: string;
        sport: string;
        status: string;
      }[]
    | null) ?? [];

  if (rows.length === 0) {
    return NextResponse.json({ sources: [], upcoming: [], total_people: 0 });
  }

  const { data: regs } = await ctx.db
    .from('club_program_registrations')
    .select('program_id, parent_email, participant_name, status')
    .in(
      'program_id',
      rows.map((r) => r.id),
    )
    .neq('status', 'cancelled');

  const byProgram = new Map<string, Set<string>>();
  const everyone = new Set<string>();
  for (const r of (regs as { program_id: string; parent_email: string }[] | null) ?? []) {
    const email = r.parent_email.toLowerCase();
    const set = byProgram.get(r.program_id) ?? new Set<string>();
    set.add(email);
    byProgram.set(r.program_id, set);
    everyone.add(email);
  }

  const today = new Date().toISOString().slice(0, 10);

  return NextResponse.json({
    /*
     * The audience picker. Only classes somebody actually registered for —
     * a list of empty classes is noise a director has to read past.
     *
     * `people` is FAMILIES, deduped by email: two children in one class is one
     * email, and a director choosing who to write to is counting households.
     */
    sources: rows
      .filter((r) => (byProgram.get(r.id)?.size ?? 0) > 0)
      .map((r) => ({
        id: r.id,
        title: r.title,
        range_start: r.range_start,
        range_end: r.range_end,
        audience: r.audience,
        sport: r.sport,
        people: byProgram.get(r.id)!.size,
        finished: String(r.range_end).slice(0, 10) < today,
      })),
    /** What they could be invited TO — published classes still to come. */
    upcoming: rows
      .filter((r) => r.status === 'published' && String(r.range_end).slice(0, 10) >= today)
      .map((r) => ({
        id: r.id,
        title: r.title,
        slug: r.slug,
        range_start: r.range_start,
        audience: r.audience,
      })),
    total_people: everyone.size,
  });
}

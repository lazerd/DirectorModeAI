/**
 * The roster for one class: who is in, who is waiting, who still owes.
 *
 * PATCH does the three things a director actually does with a list — mark a
 * payment received, cancel somebody, and promote the next family off the
 * waitlist. Cancelling an enrolled family promotes the head of the waitlist
 * automatically, because the spot opening and nobody being told is exactly how
 * a waitlist quietly stops working.
 */

import { NextResponse } from 'next/server';
import { requireStaffForClub } from '@/lib/courtsheet/routeAuth';
import { resolveTheme } from '@/lib/clubSite/theme';
import { sendProgramPromoted, type ProgramEmailContext } from '@/lib/programs/emails';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffForClub();
  if ('error' in ctx) return ctx.error;
  const { id } = await params;

  const { data: program } = await ctx.db
    .from('club_programs')
    .select('id, title, capacity, price_cents')
    .eq('id', id)
    .eq('club_id', ctx.club.id)
    .maybeSingle();
  if (!program) return NextResponse.json({ error: 'No such class.' }, { status: 404 });

  const { data: registrations } = await ctx.db
    .from('club_program_registrations')
    .select('*')
    .eq('program_id', id)
    // Enrolled first, then the waitlist in the order they joined — a waitlist
    // that is not FIFO is a waitlist nobody trusts.
    .order('status')
    .order('created_at');

  return NextResponse.json({ program, registrations: registrations ?? [] });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffForClub({ requireWrite: true });
  if ('error' in ctx) return ctx.error;
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as {
    registration_id?: string;
    payment_status?: 'pending' | 'paid' | 'waived' | 'refunded';
    status?: 'enrolled' | 'waitlist' | 'cancelled';
  };
  const regId = (body.registration_id || '').trim();
  if (!regId) return NextResponse.json({ error: 'Which registration?' }, { status: 400 });

  const { data: program } = await ctx.db
    .from('club_programs')
    .select('*')
    .eq('id', id)
    .eq('club_id', ctx.club.id)
    .maybeSingle();
  if (!program) return NextResponse.json({ error: 'No such class.' }, { status: 404 });

  const { data: before } = await ctx.db
    .from('club_program_registrations')
    .select('*')
    .eq('id', regId)
    .eq('program_id', id)
    .maybeSingle();
  if (!before) return NextResponse.json({ error: 'No such registration.' }, { status: 404 });

  const patch: Record<string, unknown> = {};
  if (body.payment_status) patch.payment_status = body.payment_status;
  if (body.status) {
    patch.status = body.status;
    // Moving someone off the waitlist into a real spot means they now owe the
    // class price; moving them the other way means they owe nothing.
    if (body.status === 'enrolled' && (before as { status: string }).status === 'waitlist') {
      patch.amount_cents = Number(program.price_cents) || 0;
    }
    if (body.status === 'cancelled') patch.payment_status = 'refunded';
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 });
  }

  const { error } = await ctx.db
    .from('club_program_registrations')
    .update(patch)
    .eq('id', regId)
    .eq('program_id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  /*
   * A spot just opened. Promote the longest-waiting family and tell them —
   * this is the whole point of collecting a waitlist, and the step a club
   * doing it on paper always forgets.
   */
  let promoted: { name: string; email: string } | null = null;
  const freedASpot =
    body.status === 'cancelled' && (before as { status: string }).status === 'enrolled';

  if (freedASpot && program.capacity != null) {
    const { count: enrolled } = await ctx.db
      .from('club_program_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('program_id', id)
      .eq('status', 'enrolled');

    if ((enrolled ?? 0) < Number(program.capacity)) {
      const { data: next } = await ctx.db
        .from('club_program_registrations')
        .select('*')
        .eq('program_id', id)
        .eq('status', 'waitlist')
        .order('created_at')
        .limit(1)
        .maybeSingle();

      if (next) {
        const nextReg = next as {
          id: string;
          participant_name: string;
          parent_name: string | null;
          parent_email: string;
        };
        await ctx.db
          .from('club_program_registrations')
          .update({
            status: 'enrolled',
            amount_cents: Number(program.price_cents) || 0,
            payment_status: Number(program.price_cents) > 0 ? 'pending' : 'waived',
          })
          .eq('id', nextReg.id);

        const [{ data: clubRow }, { data: siteRow }] = await Promise.all([
          ctx.db
            .from('cc_clubs')
            .select('email, phone, owner_id')
            .eq('id', ctx.club.id)
            .maybeSingle(),
          ctx.db
            .from('club_site')
            .select('color_primary, color_secondary, color_ink, color_cream, color_surface, font_choice')
            .eq('club_id', ctx.club.id)
            .maybeSingle(),
        ]);
        const clubInfo = clubRow as { email: string | null; phone: string | null; owner_id: string } | null;

        const emailCtx: ProgramEmailContext = {
          ownerId: clubInfo?.owner_id ?? null,
          clubName: ctx.club.name,
          clubSlug: ctx.club.slug,
          clubEmail: clubInfo?.email ?? null,
          clubPhone: clubInfo?.phone ?? null,
          timeZone: ctx.club.timezone,
          accent: resolveTheme(siteRow as Record<string, unknown> | null).primary,
          program: program as never,
          registration: {
            participant_name: nextReg.participant_name,
            parent_name: nextReg.parent_name,
            parent_email: nextReg.parent_email,
            amount_cents: Number(program.price_cents) || 0,
          },
        };
        try {
          await sendProgramPromoted(emailCtx);
        } catch {
          /* they are promoted either way; the director can see it on the list */
        }
        promoted = { name: nextReg.participant_name, email: nextReg.parent_email };
      }
    }
  }

  return NextResponse.json({ ok: true, promoted });
}

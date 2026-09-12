/**
 * Hosting: the packages a club sells, and the teams asking to buy one.
 *
 *   GET    — packages + requests
 *   POST   — add a package
 *   PATCH  — edit a package, or decide a request
 *   DELETE — retire a package (?package_id=…)
 *
 * Approving a request is the moment money is asked for, so that branch emails
 * the captain with the payment link resolved the same way every other surface
 * resolves it.
 */

import { NextResponse } from 'next/server';
import { requireStaffForClub } from '@/lib/courtsheet/routeAuth';
import { getClubPayments, paymentOffer } from '@/lib/courts/payments';
import { resolveTheme } from '@/lib/clubSite/theme';
import { sendHostApprovedEmail } from '@/lib/host/emails';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const money = z.number().int().min(0).max(10_000_000);

const packageBase = z.object({
  label: z.string().trim().min(1).max(120),
  courts: z.number().int().min(1).max(40),
  matches_included: z.number().int().min(1).max(40),
  price_cents: money,
  playoff_price_cents: money.nullable().optional(),
  blurb: z
    .string()
    .trim()
    .max(600)
    .transform((s) => (s.length ? s : null))
    .nullable()
    .optional(),
  includes: z.array(z.string().trim().min(1).max(200)).max(12).optional(),
  active: z.boolean().optional(),
  display_order: z.number().int().min(0).max(9999).optional(),
});

const packagePatch = packageBase.partial().strict();

export async function GET() {
  const ctx = await requireStaffForClub();
  if ('error' in ctx) return ctx.error;

  const [{ data: packages }, { data: requests }] = await Promise.all([
    ctx.db
      .from('club_host_packages')
      .select('*')
      .eq('club_id', ctx.club.id)
      .order('display_order'),
    ctx.db
      .from('club_host_requests')
      .select('*')
      .eq('club_id', ctx.club.id)
      .order('created_at', { ascending: false })
      .limit(200),
  ]);

  const rows = (requests as { status: string }[] | null) ?? [];
  return NextResponse.json({
    packages: packages ?? [],
    requests: rows,
    // The number a director wants at a glance: who is waiting on them.
    waiting: rows.filter((r) => r.status === 'requested').length,
    club: { slug: ctx.club.slug, name: ctx.club.name },
  });
}

export async function POST(req: Request) {
  const ctx = await requireStaffForClub({ requireWrite: true });
  if ('error' in ctx) return ctx.error;

  const parsed = packageBase.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: `${first?.path?.join('.') || 'That'}: ${first?.message || 'not valid'}` },
      { status: 400 },
    );
  }

  const { data, error } = await ctx.db
    .from('club_host_packages')
    .insert({ ...parsed.data, club_id: ctx.club.id })
    .select('*')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, package: data });
}

export async function PATCH(req: Request) {
  const ctx = await requireStaffForClub({ requireWrite: true });
  if ('error' in ctx) return ctx.error;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // ------------------------------------------------- deciding a request
  const requestId = typeof body.request_id === 'string' ? body.request_id.trim() : '';
  if (requestId) {
    const status = body.status;
    if (status !== 'approved' && status !== 'declined' && status !== 'paid' && status !== 'cancelled') {
      return NextResponse.json({ error: 'Unknown decision.' }, { status: 400 });
    }
    const staffNote =
      typeof body.staff_note === 'string' && body.staff_note.trim()
        ? body.staff_note.trim().slice(0, 1000)
        : null;

    const { data: existing } = await ctx.db
      .from('club_host_requests')
      .select('*')
      .eq('id', requestId)
      .eq('club_id', ctx.club.id)
      .maybeSingle();
    if (!existing) return NextResponse.json({ error: 'No such request.' }, { status: 404 });
    const request = existing as Record<string, unknown>;

    const { error } = await ctx.db
      .from('club_host_requests')
      .update({
        status,
        staff_note: staffNote ?? (request.staff_note as string | null),
        decided_at: new Date().toISOString(),
      })
      .eq('id', requestId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Approving is when the club asks for the money, so that is when the
    // captain hears — with the payment link resolved the way every other
    // surface resolves it.
    let emailed = false;
    if (status === 'approved') {
      const [{ data: clubRow }, { data: siteRow }, clubPayments] = await Promise.all([
        ctx.db.from('cc_clubs').select('email, phone, owner_id').eq('id', ctx.club.id).maybeSingle(),
        ctx.db
          .from('club_site')
          .select('color_primary, color_secondary, color_ink, color_cream, color_surface, font_choice')
          .eq('club_id', ctx.club.id)
          .maybeSingle(),
        getClubPayments(ctx.club.id),
      ]);
      const info = clubRow as { email: string | null; phone: string | null; owner_id: string } | null;

      const total =
        Number(request.quoted_cents ?? 0) +
        Number(request.quoted_playoff_cents ?? 0) * Number(request.expected_playoffs ?? 0);
      const offer = paymentOffer({
        amountCents: total,
        clubPayments,
        surface: 'program',
      });

      try {
        emailed = await sendHostApprovedEmail({
          ownerId: info?.owner_id ?? null,
          clubName: ctx.club.name,
          clubSlug: ctx.club.slug,
          clubEmail: info?.email ?? null,
          clubPhone: info?.phone ?? null,
          accent: resolveTheme(siteRow as Record<string, unknown> | null).primary,
          paymentUrl: offer.kind === 'link' ? offer.url : null,
          paymentLabel: offer.kind === 'link' ? offer.label : 'Pay now',
          staffNote,
          request: {
            teamName: String(request.team_name),
            league: (request.league as string) ?? null,
            division: (request.division as string) ?? null,
            captainName: String(request.captain_name),
            captainEmail: String(request.captain_email),
            captainPhone: (request.captain_phone as string) ?? null,
            preferredDay: (request.preferred_day as string) ?? null,
            preferredTime: (request.preferred_time as string) ?? null,
            seasonNote: (request.season_note as string) ?? null,
            expectedPlayoffs: Number(request.expected_playoffs ?? 0),
          },
          pkg: {
            label: String(request.quoted_label ?? 'Hosting'),
            courts: Number(request.quoted_courts ?? 0),
            matches_included: Number(request.quoted_matches ?? 0),
            price_cents: Number(request.quoted_cents ?? 0),
            playoff_price_cents: request.quoted_playoff_cents as number | null,
          },
        });
      } catch {
        /* the decision stands; the director can see it was not emailed */
      }
    }

    return NextResponse.json({ ok: true, status, emailed });
  }

  // -------------------------------------------------- editing a package
  const packageId = typeof body.package_id === 'string' ? body.package_id.trim() : '';
  if (!packageId) {
    return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 });
  }
  const { package_id: _ignored, ...rest } = body;
  const parsed = packagePatch.safeParse(rest);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: `${first?.path?.join('.') || 'That'}: ${first?.message || 'not valid'}` },
      { status: 400 },
    );
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 });
  }

  const { data, error } = await ctx.db
    .from('club_host_packages')
    .update(parsed.data)
    .eq('id', packageId)
    .eq('club_id', ctx.club.id)
    .select('*')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, package: data });
}

export async function DELETE(req: Request) {
  const ctx = await requireStaffForClub({ requireWrite: true });
  if ('error' in ctx) return ctx.error;

  const packageId = new URL(req.url).searchParams.get('package_id') || '';
  if (!packageId) return NextResponse.json({ error: 'Which package?' }, { status: 400 });

  const { count } = await ctx.db
    .from('club_host_requests')
    .select('id', { count: 'exact', head: true })
    .eq('package_id', packageId);

  /*
   * A package somebody has asked for is retired, not deleted. The request rows
   * keep their own copy of the price, but the club's record of what it was
   * selling is worth keeping too.
   */
  if ((count ?? 0) > 0) {
    const { error } = await ctx.db
      .from('club_host_packages')
      .update({ active: false })
      .eq('id', packageId)
      .eq('club_id', ctx.club.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({
      ok: true,
      retired: true,
      message: `Taken off your page. Kept on file because ${count} ${count === 1 ? 'team has' : 'teams have'} asked for it.`,
    });
  }

  const { error } = await ctx.db
    .from('club_host_packages')
    .delete()
    .eq('id', packageId)
    .eq('club_id', ctx.club.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, deleted: true });
}

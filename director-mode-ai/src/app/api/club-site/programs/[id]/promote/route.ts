/**
 * POST /api/club-site/programs/[id]/promote
 *
 * "Tell everyone who came last time that the new season is up."
 *
 * The email a club sends most and dreads most, because doing it by hand means
 * exporting a spreadsheet, pasting a hundred addresses into BCC, and rewriting
 * the dates every term. Here the list is a side effect of registration and the
 * dates come off the class, so the whole job is choosing who and pressing send.
 *
 * Runs through the campaigns engine (preview | test | live), so a director sees
 * exactly what goes out before it goes out.
 */

import { NextResponse } from 'next/server';
import { requireStaffForClub } from '@/lib/courtsheet/routeAuth';
import { runCampaign, type CampaignData, type Person } from '@/lib/campaigns/core';
import { APP_URL } from '@/lib/appUrl';
import {
  daysLabel,
  formatPrice,
  formatSessionDate,
  formatTimeRange,
  programSessions,
} from '@/lib/programs/sessions';

export const dynamic = 'force-dynamic';

const esc = (s: string) =>
  (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffForClub({ requireWrite: true });
  if ('error' in ctx) return ctx.error;
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as {
    mode?: 'preview' | 'test' | 'live';
    /** Past classes whose registrants to write to. Empty = everyone, ever. */
    source_program_ids?: string[];
    note?: string;
  };
  const mode = body.mode === 'live' ? 'live' : body.mode === 'test' ? 'test' : 'preview';

  const { data: programRow } = await ctx.db
    .from('club_programs')
    .select('*')
    .eq('id', id)
    .eq('club_id', ctx.club.id)
    .maybeSingle();
  if (!programRow) return NextResponse.json({ error: 'No such class.' }, { status: 404 });
  const program = programRow as Record<string, unknown>;

  if (program.status !== 'published') {
    // Inviting people to a page they cannot register on is the one way this
    // email can waste a club's reputation as well as its credits.
    return NextResponse.json(
      { error: 'Publish the class first — otherwise the link in the email goes nowhere.' },
      { status: 409 },
    );
  }

  // ------------------------------------------------------------- the audience
  const sourceIds = (body.source_program_ids || []).filter(
    (s) => typeof s === 'string' && s.length > 0,
  );

  let query = ctx.db
    .from('club_program_registrations')
    .select('parent_email, parent_name, program_id, status')
    .eq('club_id', ctx.club.id)
    .neq('status', 'cancelled');
  if (sourceIds.length) query = query.in('program_id', sourceIds);

  const { data: regs } = await query;
  const rows = (regs as { parent_email: string; parent_name: string | null }[] | null) ?? [];

  // Already in THIS class? Then they do not need inviting to it, and being
  // asked to sign up for something you already paid for reads as a mistake.
  const { data: already } = await ctx.db
    .from('club_program_registrations')
    .select('parent_email')
    .eq('program_id', id)
    .neq('status', 'cancelled');
  const skip = new Set(
    ((already as { parent_email: string }[] | null) ?? []).map((r) => r.parent_email.toLowerCase()),
  );

  // One email per family, not per child.
  const byEmail = new Map<string, Person>();
  for (const r of rows) {
    const key = r.parent_email.toLowerCase();
    if (skip.has(key) || byEmail.has(key)) continue;
    byEmail.set(key, {
      email: r.parent_email,
      firstName: (r.parent_name || '').trim().split(/\s+/)[0] || 'there',
    });
  }
  const everyone = [...byEmail.values()];

  if (everyone.length === 0) {
    return NextResponse.json(
      {
        error: rows.length
          ? 'Everyone from those classes is already signed up for this one.'
          : 'Nobody has registered for a class here yet, so there is no list to write to.',
      },
      { status: 409 },
    );
  }

  const [{ data: clubRow }, { data: profileRow }] = await Promise.all([
    ctx.db.from('cc_clubs').select('email, phone, owner_id').eq('id', ctx.club.id).maybeSingle(),
    ctx.db.from('profiles').select('full_name').eq('id', ctx.user.id).maybeSingle(),
  ]);
  const clubInfo = clubRow as { email: string | null; phone: string | null; owner_id: string } | null;

  const tz = ctx.club.timezone;
  const sessions = programSessions(program as never, tz);
  const title = String(program.title);
  const programUrl = `${APP_URL}/c/${ctx.club.slug}/programs/${String(program.slug)}`;
  const priceCents = Number(program.price_cents) || 0;
  const capacity = program.capacity == null ? null : Number(program.capacity);

  const campaign: CampaignData = {
    ownerId: clubInfo?.owner_id ?? ctx.user.id,
    clubName: ctx.club.name,
    senderName: (profileRow as { full_name?: string } | null)?.full_name || ctx.club.name,
    replyTo: clubInfo?.email || ctx.user.email,
    title,
    liveUrl: programUrl,
    liveUrlLabel: 'Sign up',
    deadlineNote: null,
    stats: [],
    everyone,
    nudge: [],
    copy: {
      updateSubject: `${title} — sign-ups are open`,
      updateIntro: `${title} is open for registration.`,
      nudgeSubject: '',
      nudgeLead: () => '',
    },
    /**
     * Its own layout: this is a promotion, not a status check-in. A parent
     * deciding whether to sign up again needs the dates, the price and one
     * button — the generic stat board would bury all three.
     */
    renderUpdate: (d, person) => {
      const row = (label: string, value: string) =>
        `<tr><td style="padding:5px 14px 5px 0;font-weight:700;white-space:nowrap;vertical-align:top">${esc(label)}</td><td style="padding:5px 0;color:#374151">${esc(value)}</td></tr>`;

      const rows2 = [
        row(
          'When',
          `${daysLabel(program.days_of_week as number[])}, ${formatTimeRange(String(program.time_start), String(program.time_end))}`,
        ),
        sessions.count
          ? row(
              `${sessions.count} ${sessions.count === 1 ? 'date' : 'dates'}`,
              `${formatSessionDate(sessions.dates[0], tz)}–${formatSessionDate(sessions.dates[sessions.dates.length - 1], tz)}`,
            )
          : '',
        sessions.skipped.length
          ? row('We skip', sessions.skipped.map((x) => formatSessionDate(x, tz)).join(' · '))
          : '',
        priceCents > 0 ? row('Price', formatPrice(priceCents)) : '',
        program.coach_name ? row('Coach', String(program.coach_name)) : '',
      ]
        .filter(Boolean)
        .join('');

      const inner = `<p>Hi ${esc(person.firstName)} —</p>
        <p><strong>${esc(title)}</strong> is open for sign-ups${
          capacity ? `, and there are ${capacity} spots` : ''
        }.</p>
        ${body.note ? `<p>${esc(body.note)}</p>` : ''}
        <table style="border-collapse:collapse;margin:12px 0 4px;background:#f6f8fb;border:1px solid #e5e7eb;border-radius:10px;padding:8px">${rows2}</table>
        <p style="margin:18px 0"><a href="${programUrl}" style="display:inline-block;background:#16a34a;color:#fff;font-weight:700;text-decoration:none;padding:13px 24px;border-radius:9px;font-size:16px">Sign up</a></p>
        <p style="font-size:13px;color:#6b7280">You're getting this because you've had a player in one of our classes before. Every date is on the page, including the weeks we skip.</p>
        <p style="margin:2px 0 0">— ${esc(d.senderName)}</p>`;

      return {
        subject: `${title} — sign-ups are open`,
        html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2937;line-height:1.55;max-width:640px;margin:0 auto">
  <div style="background:#1F4FA0;border-radius:14px 14px 0 0;padding:20px 26px;color:#fff">
    <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#FFD24F;font-weight:700">${esc(d.clubName)}</div>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 14px 14px;padding:22px 26px">${inner}</div>
</div>`,
      };
    },
  };

  try {
    const result = await runCampaign(campaign, 'update', mode);
    return NextResponse.json({ ok: true, mode, families: everyone.length, result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not send.' },
      { status: 500 },
    );
  }
}

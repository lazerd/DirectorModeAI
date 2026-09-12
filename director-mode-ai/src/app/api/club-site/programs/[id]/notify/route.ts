/**
 * POST /api/club-site/programs/[id]/notify
 *
 * "Tell the enrolled families what just changed."
 *
 * This is the half of the feature that actually replaces paying somebody every
 * season. An editor where a director changes a skip date and then still has to
 * write the email themselves has not saved them the phone call — so the change
 * and the announcement are one gesture, and the email is built from the class's
 * real dates rather than from a sentence somebody has to remember to update.
 *
 * Runs through the existing campaigns engine (preview | test | live) so the
 * director sees exactly what will be sent before anything leaves.
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

/**
 * "We've dropped Nov 27 and the price is now $240."
 *
 * Assembled from what actually changed, not typed by the director — the point
 * is that they click one button, not that they compose a careful sentence at
 * 9pm.
 */
function changeSentence(
  removed: string[],
  restored: string[],
  priceCents: number | null,
  timeZone: string,
): string {
  const parts: string[] = [];
  const list = (dates: string[]) =>
    dates.map((d) => formatSessionDate(d, timeZone, { weekday: true })).join(', ');

  if (removed.length) {
    parts.push(
      `we're no longer meeting on ${list(removed)}${removed.length > 1 ? '' : ''}`,
    );
  }
  if (restored.length) parts.push(`we've added ${list(restored)} back`);
  if (priceCents != null) parts.push(`the price is now ${formatPrice(priceCents)}`);
  if (parts.length === 0) return 'a quick update on your class';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffForClub({ requireWrite: true });
  if ('error' in ctx) return ctx.error;
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as {
    mode?: 'preview' | 'test' | 'live';
    dates_removed?: string[];
    dates_restored?: string[];
    price_cents?: number | null;
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

  const { data: regs } = await ctx.db
    .from('club_program_registrations')
    .select('participant_name, parent_name, parent_email, status, payment_status')
    .eq('program_id', id)
    .neq('status', 'cancelled');

  const rows = (regs as
    | {
        participant_name: string;
        parent_name: string | null;
        parent_email: string;
        status: string;
        payment_status: string;
      }[]
    | null) ?? [];

  if (rows.length === 0) {
    return NextResponse.json(
      { error: 'Nobody is signed up for this class yet, so there is nobody to tell.' },
      { status: 409 },
    );
  }

  // One email per FAMILY, not per child. A parent with two kids in the class
  // getting the same notice twice is how a club teaches people to ignore it.
  const byEmail = new Map<string, Person>();
  for (const r of rows) {
    const key = r.parent_email.toLowerCase();
    if (byEmail.has(key)) continue;
    byEmail.set(key, {
      email: r.parent_email,
      firstName: (r.parent_name || '').trim().split(/\s+/)[0] || 'there',
    });
  }
  const everyone = [...byEmail.values()];

  const [{ data: clubRow }, { data: profileRow }] = await Promise.all([
    ctx.db.from('cc_clubs').select('email, phone, owner_id').eq('id', ctx.club.id).maybeSingle(),
    ctx.db.from('profiles').select('full_name').eq('id', ctx.user.id).maybeSingle(),
  ]);
  const clubInfo = clubRow as { email: string | null; phone: string | null; owner_id: string } | null;

  const tz = ctx.club.timezone;
  const sessions = programSessions(program as never, tz);
  const removed = (body.dates_removed || []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  const restored = (body.dates_restored || []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  const priceCents =
    typeof body.price_cents === 'number' ? body.price_cents : null;

  const headline = changeSentence(removed, restored, priceCents, tz);
  const programUrl = `${APP_URL}/c/${ctx.club.slug}/programs/${String(program.slug)}`;
  const title = String(program.title);

  const campaign: CampaignData = {
    ownerId: clubInfo?.owner_id ?? ctx.user.id,
    clubName: ctx.club.name,
    senderName: (profileRow as { full_name?: string } | null)?.full_name || ctx.club.name,
    replyTo: clubInfo?.email || ctx.user.email,
    title,
    liveUrl: programUrl,
    liveUrlLabel: 'See the updated dates',
    deadlineNote: null,
    stats: [
      { label: 'Class', value: title },
      {
        label: 'When',
        value: `${daysLabel(program.days_of_week as number[])}, ${formatTimeRange(String(program.time_start), String(program.time_end))}`,
      },
      { label: 'Sessions left', value: String(sessions.count) },
      { label: 'Families', value: String(everyone.length) },
    ],
    everyone,
    // No per-person action is outstanding here — this is an announcement, so
    // the nudge half of the engine stays empty on purpose.
    nudge: [],
    copy: {
      updateSubject: `${title} — schedule update`,
      updateIntro: `A change to ${title}: ${headline}.`,
      nudgeSubject: '',
      nudgeLead: () => '',
    },
    /**
     * Its own layout rather than the generic status template: a parent needs
     * the dates in full, not a stat board. renderUpdate exists for exactly
     * this, and preview/test/live all flow through it, so what the director
     * approves is what gets sent.
     */
    renderUpdate: (d, person) => {
      const dateRow = (label: string, value: string) =>
        `<tr><td style="padding:5px 14px 5px 0;font-weight:700;white-space:nowrap;vertical-align:top">${esc(label)}</td><td style="padding:5px 0;color:#374151">${esc(value)}</td></tr>`;

      const rowsHtml = [
        dateRow(
          'When',
          `${daysLabel(program.days_of_week as number[])}, ${formatTimeRange(String(program.time_start), String(program.time_end))}`,
        ),
        sessions.count
          ? dateRow(
              `Your ${sessions.count} ${sessions.count === 1 ? 'date' : 'dates'}`,
              sessions.dates.map((x) => formatSessionDate(x, tz)).join(' · '),
            )
          : '',
        sessions.skipped.length
          ? dateRow('We skip', sessions.skipped.map((x) => formatSessionDate(x, tz)).join(' · '))
          : '',
      ].join('');

      const inner = `<p>Hi ${esc(person.firstName)} —</p>
        <p>A change to <strong>${esc(title)}</strong>: ${esc(headline)}.</p>
        ${body.note ? `<p>${esc(body.note)}</p>` : ''}
        <p style="margin-top:14px;font-weight:700">Here is the full schedule as it stands now:</p>
        <table style="border-collapse:collapse;margin:8px 0 4px;background:#f6f8fb;border:1px solid #e5e7eb;border-radius:10px;padding:8px">${rowsHtml}</table>
        <p style="margin:18px 0"><a href="${programUrl}" style="display:inline-block;background:#16a34a;color:#fff;font-weight:700;text-decoration:none;padding:13px 24px;border-radius:9px;font-size:16px">See the updated dates</a></p>
        <p>Nothing else changes, and you don't need to do anything. Questions? Just reply.</p>
        <p style="margin:2px 0 0">— ${esc(d.senderName)}</p>`;

      return {
        subject: `${title} — schedule update`,
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

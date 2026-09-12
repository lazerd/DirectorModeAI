/**
 * What a parent gets after signing up.
 *
 * The confirmation carries EVERY DATE, and names the weeks the class skips.
 * That is the whole feature arriving in an inbox: a parent who has only ever
 * received "10 weeks starting Sep 15" from a club website can put these dates
 * straight into their calendar, and nobody has to field the "is there class on
 * Thanksgiving?" phone call.
 *
 * Billed to the club owner through sendBilledEmail, same as every other club
 * email, so a club's own mail is on its own account.
 */

import { sendBilledEmail, CreditLimitError, type SafeSendResult } from '@/lib/email';
import { APP_URL } from '@/lib/appUrl';
import {
  daysLabel,
  formatPrice,
  formatSessionDate,
  formatTimeRange,
  programSessions,
} from './sessions';

const esc = (s: string) =>
  (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The verified sending domain — same constant the campaigns engine uses. */
const RESEND_DOMAIN = 'noreply@mail.clubmode.ai';

/**
 * A From line that says the CLUB's name, so a parent's inbox shows "Lafayette
 * Tennis Club" and not "ClubMode".
 *
 * Quotes and angle brackets are stripped because they would break the header,
 * and a non-ASCII name is RFC 2047 encoded rather than sent raw — a club with
 * an accent in its name otherwise arrives as mojibake or gets the header
 * rejected outright.
 */
const fromLine = (clubName: string) => {
  const clean = (clubName || 'Club').replace(/["<>\r\n]/g, '').trim() || 'Club';
  const display = /^[\x20-\x7E]*$/.test(clean)
    ? clean
    : `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
  return `${display} <${RESEND_DOMAIN}>`;
};

/** The same visual shell the campaigns engine uses, in the club's color. */
const shell = (clubName: string, accent: string, inner: string) =>
  `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2937;line-height:1.55;max-width:640px;margin:0 auto">
  <div style="background:${accent};border-radius:14px 14px 0 0;padding:20px 26px;color:#fff">
    <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;font-weight:700;opacity:.85">${esc(clubName)}</div>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 14px 14px;padding:22px 26px">${inner}</div>
</div>`;

const button = (href: string, label: string, accent: string) =>
  href
    ? `<p style="margin:18px 0"><a href="${href}" style="display:inline-block;background:${accent};color:#fff;font-weight:700;text-decoration:none;padding:13px 24px;border-radius:9px;font-size:16px">${esc(label)}</a></p>`
    : '';

export type ProgramEmailContext = {
  ownerId: string | null;
  clubName: string;
  clubSlug: string;
  clubEmail: string | null;
  clubPhone: string | null;
  timeZone: string;
  accent: string;
  program: {
    slug: string;
    title: string;
    days_of_week: number[] | null;
    exclusions: string[] | null;
    range_start: string;
    range_end: string;
    time_start: string;
    time_end: string;
    price_cents: number;
    coach_name: string | null;
    location_note: string | null;
    external_payment_url: string | null;
  };
  registration: {
    participant_name: string;
    parent_name: string | null;
    parent_email: string;
    amount_cents: number | null;
  };
};

const firstName = (full: string | null, fallback: string) =>
  (full || '').trim().split(/\s+/)[0] || fallback;

/** The dates block — the part of this email that does the work. */
function datesHtml(ctx: ProgramEmailContext): string {
  const s = programSessions(ctx.program, ctx.timeZone);
  const rows: string[] = [];

  rows.push(
    `<tr><td style="padding:5px 14px 5px 0;font-weight:700;white-space:nowrap;vertical-align:top">When</td><td style="padding:5px 0;color:#374151">${esc(
      `${daysLabel(ctx.program.days_of_week)}, ${formatTimeRange(ctx.program.time_start, ctx.program.time_end)}`,
    )}</td></tr>`,
  );

  if (s.count > 0) {
    rows.push(
      `<tr><td style="padding:5px 14px 5px 0;font-weight:700;white-space:nowrap;vertical-align:top">Your ${s.count} ${
        s.count === 1 ? 'date' : 'dates'
      }</td><td style="padding:5px 0;color:#374151">${esc(
        s.dates.map((d) => formatSessionDate(d, ctx.timeZone)).join(' · '),
      )}</td></tr>`,
    );
  }
  if (s.skipped.length > 0) {
    rows.push(
      `<tr><td style="padding:5px 14px 5px 0;font-weight:700;white-space:nowrap;vertical-align:top">We skip</td><td style="padding:5px 0;color:#374151">${esc(
        s.skipped.map((d) => formatSessionDate(d, ctx.timeZone)).join(' · '),
      )}</td></tr>`,
    );
  }
  if (ctx.program.coach_name) {
    rows.push(
      `<tr><td style="padding:5px 14px 5px 0;font-weight:700;white-space:nowrap">Coach</td><td style="padding:5px 0;color:#374151">${esc(ctx.program.coach_name)}</td></tr>`,
    );
  }
  if (ctx.program.location_note) {
    rows.push(
      `<tr><td style="padding:5px 14px 5px 0;font-weight:700;white-space:nowrap">Where</td><td style="padding:5px 0;color:#374151">${esc(ctx.program.location_note)}</td></tr>`,
    );
  }

  return `<table style="border-collapse:collapse;margin:14px 0 4px;background:#f6f8fb;border:1px solid #e5e7eb;border-radius:10px;padding:8px">${rows.join('')}</table>`;
}

const signOff = (ctx: ProgramEmailContext) => {
  const contact: string[] = [];
  if (ctx.clubPhone) contact.push(esc(ctx.clubPhone));
  if (ctx.clubEmail) contact.push(esc(ctx.clubEmail));
  return `<p>Questions, or need to change something? Just reply to this email${
    contact.length ? ` or call ${contact[0]}` : ''
  }.</p>
  <p style="margin:2px 0 0">— ${esc(ctx.clubName)}</p>`;
};

export async function sendProgramConfirmation(ctx: ProgramEmailContext): Promise<SafeSendResult> {
  const owed = ctx.registration.amount_cents ?? 0;
  const pay = ctx.program.external_payment_url;
  const programUrl = `${APP_URL}/c/${ctx.clubSlug}/programs/${ctx.program.slug}`;

  const inner = `<p>Hi ${esc(firstName(ctx.registration.parent_name, 'there'))} —</p>
    <p><strong>${esc(ctx.registration.participant_name)}</strong> is signed up for <strong>${esc(ctx.program.title)}</strong>.</p>
    ${datesHtml(ctx)}
    ${
      owed > 0
        ? pay
          ? `<p style="margin-top:16px"><strong>${esc(formatPrice(owed))}</strong> is due to hold the spot.</p>${button(pay, `Pay ${formatPrice(owed)} now`, ctx.accent)}`
          : `<p style="margin-top:16px"><strong>${esc(formatPrice(owed))}</strong> is due — we'll be in touch about payment.</p>`
        : ''
    }
    <p style="font-size:13px;color:#6b7280">All the details stay here: <a href="${programUrl}" style="color:${ctx.accent}">${esc(programUrl.replace(/^https?:\/\//, ''))}</a></p>
    ${signOff(ctx)}`;

  return sendBilledEmail(ctx.ownerId, {
    to: ctx.registration.parent_email,
    subject: `You're in — ${ctx.program.title}`,
    html: shell(ctx.clubName, ctx.accent, inner),
    replyTo: ctx.clubEmail || undefined,
    from: fromLine(ctx.clubName),
  });
}

export async function sendProgramWaitlist(
  ctx: ProgramEmailContext,
  position: number,
): Promise<SafeSendResult> {
  const inner = `<p>Hi ${esc(firstName(ctx.registration.parent_name, 'there'))} —</p>
    <p><strong>${esc(ctx.program.title)}</strong> is full, so <strong>${esc(ctx.registration.participant_name)}</strong> is on the waitlist${
      position > 0 ? ` at number <strong>${position}</strong>` : ''
    }. We'll email you the moment a spot opens, and nothing is owed until then.</p>
    ${datesHtml(ctx)}
    <p>Plenty of spots do open up — people's schedules change. You don't need to do anything.</p>
    ${signOff(ctx)}`;

  return sendBilledEmail(ctx.ownerId, {
    to: ctx.registration.parent_email,
    subject: `Waitlisted — ${ctx.program.title}`,
    html: shell(ctx.clubName, ctx.accent, inner),
    replyTo: ctx.clubEmail || undefined,
    from: fromLine(ctx.clubName),
  });
}

/** A waitlisted family promoted into a real spot. */
export async function sendProgramPromoted(ctx: ProgramEmailContext): Promise<SafeSendResult> {
  const owed = ctx.registration.amount_cents ?? 0;
  const pay = ctx.program.external_payment_url;

  const inner = `<p>Hi ${esc(firstName(ctx.registration.parent_name, 'there'))} —</p>
    <p>Good news: a spot opened in <strong>${esc(ctx.program.title)}</strong> and <strong>${esc(ctx.registration.participant_name)}</strong> is in.</p>
    ${datesHtml(ctx)}
    ${
      owed > 0
        ? pay
          ? `${button(pay, `Pay ${formatPrice(owed)} now`, ctx.accent)}`
          : `<p style="margin-top:16px"><strong>${esc(formatPrice(owed))}</strong> is due — we'll be in touch about payment.</p>`
        : ''
    }
    ${signOff(ctx)}`;

  return sendBilledEmail(ctx.ownerId, {
    to: ctx.registration.parent_email,
    subject: `A spot opened — ${ctx.program.title}`,
    html: shell(ctx.clubName, ctx.accent, inner),
    replyTo: ctx.clubEmail || undefined,
    from: fromLine(ctx.clubName),
  });
}

export { CreditLimitError };

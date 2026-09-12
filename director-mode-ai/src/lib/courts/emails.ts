/**
 * The court booking confirmation.
 *
 * Carries the cancel link, because the alternative is the club's phone ringing
 * every time someone's plans change — and a booking a stranger cannot release
 * is a court that sits empty.
 */

import { sendBilledEmail, type SafeSendResult } from '@/lib/email';
import { APP_URL } from '@/lib/appUrl';
import { formatPrice, formatSessionDate } from '@/lib/programs/sessions';
import { toHHMM, toMinutes, type PriceSegment } from './pricing';
import { paymentSentence, type PaymentOffer } from './payments';

const esc = (s: string) =>
  (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const RESEND_DOMAIN = 'noreply@mail.clubmode.ai';

/** Club-named From line, RFC 2047 encoded when the name is not plain ASCII. */
const fromLine = (clubName: string) => {
  const clean = (clubName || 'Club').replace(/["<>\r\n]/g, '').trim() || 'Club';
  const display = /^[\x20-\x7E]*$/.test(clean)
    ? clean
    : `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
  return `${display} <${RESEND_DOMAIN}>`;
};

/** 3:30 PM — a time a person reads, from club-local 'HH:MM'. */
function pretty(hhmm: string): string {
  const [h, m] = hhmm.split(':').map((s) => parseInt(s, 10));
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour}:${String(m).padStart(2, '0')} ${suffix}` : `${hour} ${suffix}`;
}

export type CourtBookingEmail = {
  ownerId: string | null;
  clubName: string;
  clubSlug: string;
  clubEmail: string | null;
  clubPhone: string | null;
  accent: string;
  timeZone: string;
  booking: {
    id: string;
    cancelToken: string;
    name: string;
    email: string;
    /** Club-local. */
    date: string;
    time: string;
    minutes: number;
    courtName: string;
    amountCents: number;
    segments: PriceSegment[];
    audience: 'member' | 'public';
  };
  /**
   * How the club wants to be paid, resolved ONCE by the caller and shared with
   * the response — so the page and the inbox cannot tell the same person two
   * different things about paying.
   */
  offer: PaymentOffer;
};

export async function sendCourtBookingEmail(ctx: CourtBookingEmail): Promise<SafeSendResult> {
  const b = ctx.booking;
  const endTime = toHHMM(toMinutes(b.time) + b.minutes);
  const cancelUrl = `${APP_URL}/c/${ctx.clubSlug}/courts/cancel/${b.cancelToken}`;
  const firstName = b.name.trim().split(/\s+/)[0] || 'there';

  const row = (label: string, value: string) =>
    `<tr><td style="padding:5px 14px 5px 0;font-weight:700;white-space:nowrap;vertical-align:top">${esc(label)}</td><td style="padding:5px 0;color:#374151">${esc(value)}</td></tr>`;

  const rows = [
    row('When', `${formatSessionDate(b.date, ctx.timeZone, { weekday: true })}, ${pretty(b.time)} – ${pretty(endTime)}`),
    row('Court', b.courtName),
    row('Length', `${b.minutes} minutes`),
    b.amountCents > 0
      ? row('Cost', formatPrice(b.amountCents))
      : row('Cost', b.audience === 'member' ? 'Free — member court time' : 'Free'),
    // Only worth showing when the price was actually made of parts. A single
    // flat rate explained as a breakdown is noise.
    b.segments.length > 1
      ? row(
          'Made up of',
          b.segments
            .map((s) => `${s.minutes} min at ${formatPrice(s.price_cents_per_hour)}/hr (${s.label})`)
            .join(' + '),
        )
      : '',
  ]
    .filter(Boolean)
    .join('');

  const inner = `<p>Hi ${esc(firstName)} —</p>
    <p>Your court at <strong>${esc(ctx.clubName)}</strong> is booked.</p>
    <table style="border-collapse:collapse;margin:14px 0 4px;background:#f6f8fb;border:1px solid #e5e7eb;border-radius:10px;padding:8px">${rows}</table>
    ${
      b.amountCents > 0
        ? ctx.offer.kind === 'link'
          ? `<p style="margin-top:14px">${esc(paymentSentence(ctx.offer, 'court'))}</p>
             <p style="margin:16px 0"><a href="${ctx.offer.url}" style="display:inline-block;background:${ctx.accent};color:#fff;font-weight:700;text-decoration:none;padding:13px 24px;border-radius:9px;font-size:16px">${esc(ctx.offer.label)}</a></p>`
          : `<p style="margin-top:14px">${esc(paymentSentence(ctx.offer, 'court'))}</p>`
        : ''
    }
    <p style="margin:18px 0 6px">Plans change — <a href="${cancelUrl}" style="color:${ctx.accent};font-weight:700">cancel this booking</a> and the court goes back to whoever wants it.</p>
    <p>Questions? Just reply${ctx.clubPhone ? ` or call ${esc(ctx.clubPhone)}` : ''}.</p>
    <p style="margin:2px 0 0">— ${esc(ctx.clubName)}</p>`;

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2937;line-height:1.55;max-width:640px;margin:0 auto">
  <div style="background:${ctx.accent};border-radius:14px 14px 0 0;padding:20px 26px;color:#fff">
    <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;font-weight:700;opacity:.85">${esc(ctx.clubName)}</div>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 14px 14px;padding:22px 26px">${inner}</div>
</div>`;

  return sendBilledEmail(ctx.ownerId, {
    to: b.email,
    subject: `Court booked — ${formatSessionDate(b.date, ctx.timeZone, { weekday: true })} at ${pretty(b.time)}`,
    html,
    replyTo: ctx.clubEmail || undefined,
    from: fromLine(ctx.clubName),
  });
}

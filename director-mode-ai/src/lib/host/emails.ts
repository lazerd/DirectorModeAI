/**
 * Emails for a team asking to host its season at a club.
 *
 * Two go out at once, and they say different things on purpose:
 *
 *   - The CAPTAIN gets a receipt of what they asked for and, crucially, that it
 *     is not confirmed yet. A team that thinks it has courts and turns up to
 *     find it does not has a ruined match day and a story about the club.
 *   - The CLUB gets everything it needs to decide without opening the app: the
 *     team, the day they need, the money, and the captain's phone number.
 */

import { sendBilledEmail } from '@/lib/email';
import { APP_URL } from '@/lib/appUrl';
import { formatPrice } from '@/lib/programs/sessions';

const esc = (s: string) =>
  (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const RESEND_DOMAIN = 'noreply@mail.clubmode.ai';

const fromLine = (clubName: string) => {
  const clean = (clubName || 'Club').replace(/["<>\r\n]/g, '').trim() || 'Club';
  const display = /^[\x20-\x7E]*$/.test(clean)
    ? clean
    : `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
  return `${display} <${RESEND_DOMAIN}>`;
};

const shell = (clubName: string, accent: string, inner: string) =>
  `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2937;line-height:1.55;max-width:640px;margin:0 auto">
  <div style="background:${accent};border-radius:14px 14px 0 0;padding:20px 26px;color:#fff">
    <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;font-weight:700;opacity:.85">${esc(clubName)}</div>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 14px 14px;padding:22px 26px">${inner}</div>
</div>`;

export type HostRequestEmail = {
  ownerId: string | null;
  clubName: string;
  clubSlug: string;
  clubEmail: string | null;
  clubPhone: string | null;
  accent: string;
  request: {
    teamName: string;
    league: string | null;
    division: string | null;
    captainName: string;
    captainEmail: string;
    captainPhone: string | null;
    preferredDay: string | null;
    preferredTime: string | null;
    seasonNote: string | null;
    expectedPlayoffs: number;
  };
  pkg: {
    label: string;
    courts: number;
    matches_included: number;
    price_cents: number;
    playoff_price_cents: number | null;
  };
};

const row = (label: string, value: string) =>
  `<tr><td style="padding:5px 14px 5px 0;font-weight:700;white-space:nowrap;vertical-align:top">${esc(label)}</td><td style="padding:5px 0;color:#374151">${esc(value)}</td></tr>`;

/** The money, spelled out — package plus any playoffs they expect. */
function moneyRows(ctx: HostRequestEmail): string {
  const { pkg, request } = ctx;
  const rows = [
    row(
      'Package',
      `${pkg.label} — ${pkg.courts} courts, ${pkg.matches_included} home ${
        pkg.matches_included === 1 ? 'match' : 'matches'
      }`,
    ),
    row('Season fee', formatPrice(pkg.price_cents)),
  ];
  if (pkg.playoff_price_cents != null && pkg.playoff_price_cents > 0) {
    rows.push(row('Playoffs', `${formatPrice(pkg.playoff_price_cents)} per match, on top`));
    if (request.expectedPlayoffs > 0) {
      const total = pkg.price_cents + pkg.playoff_price_cents * request.expectedPlayoffs;
      rows.push(
        row(
          `If you play ${request.expectedPlayoffs} playoff ${
            request.expectedPlayoffs === 1 ? 'match' : 'matches'
          }`,
          `${formatPrice(total)} in total`,
        ),
      );
    }
  }
  return rows.join('');
}

export async function sendHostRequestEmails(
  ctx: HostRequestEmail,
): Promise<{ captain: boolean; club: boolean }> {
  const { request: r } = ctx;
  const firstName = r.captainName.trim().split(/\s+/)[0] || 'there';
  const hostUrl = `${APP_URL}/c/${ctx.clubSlug}/host`;

  // ------------------------------------------------------------- captain
  const captainInner = `<p>Hi ${esc(firstName)} —</p>
    <p>We have your request to host <strong>${esc(r.teamName)}</strong>'s home matches at ${esc(ctx.clubName)}.</p>
    <table style="border-collapse:collapse;margin:14px 0 4px;background:#f6f8fb;border:1px solid #e5e7eb;border-radius:10px;padding:8px">
      ${moneyRows(ctx)}
      ${r.preferredDay ? row('You asked for', `${r.preferredDay}${r.preferredTime ? `, ${r.preferredTime}` : ''}`) : ''}
    </table>
    <p style="margin-top:16px;padding:12px 14px;background:#fffbeb;border-left:3px solid #f59e0b;border-radius:4px">
      <strong>Nothing is booked yet.</strong> We check the season calendar before confirming a
      block of match days, so we will come back to you — usually within a couple of days — and
      payment happens once it is confirmed.
    </p>
    <p>Anything to add in the meantime? Just reply${ctx.clubPhone ? ` or call ${esc(ctx.clubPhone)}` : ''}.</p>
    <p style="margin:2px 0 0">— ${esc(ctx.clubName)}</p>`;

  // ---------------------------------------------------------------- club
  const clubInner = `<p><strong>${esc(r.teamName)}</strong> wants to host its home matches here.</p>
    <table style="border-collapse:collapse;margin:14px 0 4px;background:#f6f8fb;border:1px solid #e5e7eb;border-radius:10px;padding:8px">
      ${moneyRows(ctx)}
      ${r.league ? row('League', `${r.league}${r.division ? ` · ${r.division}` : ''}`) : ''}
      ${row('Captain', `${r.captainName} · ${r.captainEmail}${r.captainPhone ? ` · ${r.captainPhone}` : ''}`)}
      ${r.preferredDay ? row('Wants', `${r.preferredDay}${r.preferredTime ? `, ${r.preferredTime}` : ''}`) : ''}
      ${r.seasonNote ? row('Notes', r.seasonNote) : ''}
    </table>
    <p style="margin-top:14px">
      <strong>Check the day against your season before you say yes</strong> — this is
      ${ctx.pkg.matches_included} match ${ctx.pkg.matches_included === 1 ? 'day' : 'days'} on
      ${ctx.pkg.courts} courts.
    </p>
    <p style="margin:16px 0"><a href="${APP_URL}/run/site/hosting" style="display:inline-block;background:${ctx.accent};color:#fff;font-weight:700;text-decoration:none;padding:13px 24px;border-radius:9px;font-size:16px">Approve or decline</a></p>
    <p style="font-size:13px;color:#6b7280">Your hosting page: <a href="${hostUrl}" style="color:${ctx.accent}">${esc(hostUrl.replace(/^https?:\/\//, ''))}</a></p>`;

  const [captain, club] = await Promise.all([
    sendBilledEmail(ctx.ownerId, {
      to: r.captainEmail,
      subject: `Your hosting request — ${ctx.clubName}`,
      html: shell(ctx.clubName, ctx.accent, captainInner),
      replyTo: ctx.clubEmail || undefined,
      from: fromLine(ctx.clubName),
    }).catch(() => ({ sent: false })),
    // Only if the club has an address on file. A request nobody is told about
    // is a request that rots.
    ctx.clubEmail
      ? sendBilledEmail(ctx.ownerId, {
          to: ctx.clubEmail,
          subject: `Hosting request: ${r.teamName}`,
          html: shell(ctx.clubName, ctx.accent, clubInner),
          replyTo: r.captainEmail,
          from: fromLine(ctx.clubName),
        }).catch(() => ({ sent: false }))
      : Promise.resolve({ sent: false }),
  ]);

  return { captain: !!captain?.sent, club: !!club?.sent };
}

/** Sent when the club says yes, with how to pay. */
export async function sendHostApprovedEmail(
  ctx: HostRequestEmail & { paymentUrl: string | null; paymentLabel: string; staffNote: string | null },
): Promise<boolean> {
  const { request: r } = ctx;
  const firstName = r.captainName.trim().split(/\s+/)[0] || 'there';

  const inner = `<p>Hi ${esc(firstName)} —</p>
    <p>Good news: <strong>${esc(r.teamName)}</strong> is confirmed to host its home matches at
    ${esc(ctx.clubName)}.</p>
    <table style="border-collapse:collapse;margin:14px 0 4px;background:#f6f8fb;border:1px solid #e5e7eb;border-radius:10px;padding:8px">
      ${moneyRows(ctx)}
      ${r.preferredDay ? row('Match days', `${r.preferredDay}${r.preferredTime ? `, ${r.preferredTime}` : ''}`) : ''}
    </table>
    ${ctx.staffNote ? `<p style="margin-top:14px">${esc(ctx.staffNote)}</p>` : ''}
    ${
      ctx.paymentUrl
        ? `<p style="margin:18px 0"><a href="${ctx.paymentUrl}" style="display:inline-block;background:${ctx.accent};color:#fff;font-weight:700;text-decoration:none;padding:13px 24px;border-radius:9px;font-size:16px">${esc(ctx.paymentLabel)}</a></p>`
        : `<p style="margin-top:14px">We'll be in touch about payment.</p>`
    }
    <p>Send us your fixture list when the league publishes it and we'll get the courts blocked.</p>
    <p style="margin:2px 0 0">— ${esc(ctx.clubName)}</p>`;

  const res = await sendBilledEmail(ctx.ownerId, {
    to: r.captainEmail,
    subject: `Confirmed — hosting at ${ctx.clubName}`,
    html: shell(ctx.clubName, ctx.accent, inner),
    replyTo: ctx.clubEmail || undefined,
    from: fromLine(ctx.clubName),
  }).catch(() => ({ sent: false }));
  return !!res?.sent;
}

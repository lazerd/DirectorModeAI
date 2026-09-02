/**
 * Quads tournament emails — confirmation, waitlist, promoted-from-waitlist,
 * doubles-round-set, plus the request → invite → pay flow used by dated
 * multi-division events. All sends go through `safeResendSend()` so the
 * unsubscribe blocklist + footer apply automatically.
 */

import { Resend } from 'resend';
import { safeResendSend } from './emailUnsubscribe';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM =
  process.env.RESEND_FROM_EMAIL || 'ClubMode <noreply@mail.clubmode.ai>';

function htmlShell(title: string, body: string) {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; color: #111;">
      <h2 style="color: #ea580c;">${title}</h2>
      ${body}
      <p style="color: #888; font-size: 12px; margin-top: 24px;">
        Sent by CoachMode Quads. Reply to this email for help.
      </p>
    </div>
  `;
}

export async function sendQuadsConfirmEmail(args: {
  to: string;
  playerName: string;
  tournamentName: string;
  tournamentDate: string | null;
  publicUrl: string;
}) {
  return safeResendSend(resend, {
    from: FROM,
    to: args.to,
    subject: `You're in: ${args.tournamentName}`,
    html: htmlShell(
      `${args.playerName} — you're registered!`,
      `<p>Thanks for registering for <strong>${args.tournamentName}</strong>${args.tournamentDate ? ` on ${args.tournamentDate}` : ''}.</p>
      <p>You'll get more details (flight assignment, court times) closer to the tournament date.</p>
      <p><a href="${args.publicUrl}" style="color: #ea580c;">View tournament page →</a></p>`
    ),
  });
}

export async function sendQuadsWaitlistEmail(args: {
  to: string;
  playerName: string;
  tournamentName: string;
  publicUrl: string;
}) {
  return safeResendSend(resend, {
    from: FROM,
    to: args.to,
    subject: `Waitlist: ${args.tournamentName}`,
    html: htmlShell(
      `${args.playerName} — you're on the waitlist`,
      `<p>The <strong>${args.tournamentName}</strong> tournament is full, but you're on the waitlist.</p>
      <p>If a spot opens up, we'll email you immediately.</p>
      <p><a href="${args.publicUrl}" style="color: #ea580c;">View tournament page →</a></p>`
    ),
  });
}

export async function sendQuadsPromotedEmail(args: {
  to: string;
  playerName: string;
  tournamentName: string;
  publicUrl: string;
}) {
  return safeResendSend(resend, {
    from: FROM,
    to: args.to,
    subject: `A spot opened up: ${args.tournamentName}`,
    html: htmlShell(
      `${args.playerName} — you're in!`,
      `<p>A spot opened up in <strong>${args.tournamentName}</strong> and we promoted you from the waitlist. You're confirmed.</p>
      <p><a href="${args.publicUrl}" style="color: #ea580c;">View tournament page →</a></p>`
    ),
  });
}

export async function sendQuadsScheduleEmail(args: {
  to: string;
  playerName: string;
  tournamentName: string;
  tournamentDate: string | null;
  flightName: string | null;
  matches: Array<{
    label: string; // e.g. "R1 Singles vs John Smith"
    timeDisplay: string; // e.g. "9:00 AM"
    court: string; // e.g. "1"
  }>;
  scoringUrl: string;
}) {
  const rows = args.matches
    .map(
      (m) => `
        <tr>
          <td style="padding: 8px 12px; border-bottom: 1px solid #eee; font-size: 13px;">${m.label}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #eee; font-size: 13px; text-align: right; white-space: nowrap;">
            <strong>${m.timeDisplay}</strong>${m.court ? ` · Court ${m.court}` : ''}
          </td>
        </tr>`
    )
    .join('');

  return safeResendSend(resend, {
    from: FROM,
    to: args.to,
    subject: `Your match schedule: ${args.tournamentName}`,
    html: htmlShell(
      `${args.playerName} — your match schedule`,
      `<p>Here's your schedule for <strong>${args.tournamentName}</strong>${args.tournamentDate ? ` on ${args.tournamentDate}` : ''}${args.flightName ? ` (${args.flightName})` : ''}.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        ${rows || '<tr><td style="padding: 8px; color: #888;">No matches scheduled yet.</td></tr>'}
      </table>
      <p style="margin: 24px 0;">
        <a href="${args.scoringUrl}" style="display: inline-block; padding: 10px 18px; background: #ea580c; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;">
          Open my page (score matches)
        </a>
      </p>
      <p style="color: #888; font-size: 12px;">Schedules can change. Watch your inbox for updates.</p>`
    ),
  });
}

export async function sendQuadsScoringLinkEmail(args: {
  to: string;
  playerName: string;
  tournamentName: string;
  flightName: string | null;
  scoringUrl: string;
}) {
  return safeResendSend(resend, {
    from: FROM,
    to: args.to,
    subject: `Score your matches: ${args.tournamentName}`,
    html: htmlShell(
      `${args.playerName} — your match scoring link`,
      `<p>You're playing in <strong>${args.tournamentName}</strong>${args.flightName ? ` (${args.flightName})` : ''}.</p>
      <p>Use this link to enter scores for your matches as you finish them. The page lists every match you're in — just tap "Enter Score" after each one.</p>
      <p style="margin: 24px 0;">
        <a href="${args.scoringUrl}" style="display: inline-block; padding: 12px 24px; background: #ea580c; color: white; text-decoration: none; border-radius: 8px; font-weight: 600;">
          Open my scoring page
        </a>
      </p>
      <p style="color: #888; font-size: 13px;">Or paste this URL into your browser:<br><code>${args.scoringUrl}</code></p>
      <p style="color: #888; font-size: 13px;">This link is personal to you — don't share it with other players.</p>`
    ),
  });
}

export async function sendQuadsDoublesPairingEmail(args: {
  to: string;
  playerName: string;
  tournamentName: string;
  flightName: string;
  partnerName: string;
  opponentNames: string;
  rank: number;
}) {
  return safeResendSend(resend, {
    from: FROM,
    to: args.to,
    subject: `R4 doubles pairing: ${args.flightName}`,
    html: htmlShell(
      `Round 4 doubles pairing — ${args.flightName}`,
      `<p>${args.playerName}, you finished <strong>${ordinal(args.rank)}</strong> in singles.</p>
      <p>For the round-4 doubles match, you'll partner with <strong>${args.partnerName}</strong> against <strong>${args.opponentNames}</strong>.</p>
      <p>Tournament: ${args.tournamentName}</p>`
    ),
  });
}

function ordinal(n: number) {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}

// ---------------------------------------------------------------------------
// request → invite → pay flow (multi-division dated events)
// ---------------------------------------------------------------------------

/**
 * Sent the moment a parent submits the form. Nobody has paid anything yet —
 * this email's whole job is to set the expectation that a payment link with a
 * deadline is what actually secures the spot.
 */
export async function sendQuadRequestReceivedEmail(args: {
  to: string;
  playerName: string;
  tournamentName: string;
  divisionLabel: string;
  dateLabel: string;
  feeLabel: string;
  positionInLine: number;
  publicUrl: string;
}) {
  const inLine =
    args.positionInLine <= 4
      ? `You're <strong>#${args.positionInLine}</strong> in line for ${args.divisionLabel} — the first four get the spots.`
      : `You're <strong>#${args.positionInLine}</strong> in line for ${args.divisionLabel}, so you're on the waitlist for now. Divisions that don't fill get folded into ones that do, which often frees up spots.`;

  return safeResendSend(resend, {
    from: FROM,
    to: args.to,
    subject: `Request received: ${args.tournamentName}`,
    html: htmlShell(
      `${args.playerName} — we've got your request`,
      `<p>You asked for a spot in <strong>${args.divisionLabel}</strong> on <strong>${args.dateLabel}</strong>.</p>
      <p>${inLine}</p>
      <p><strong>Nothing has been charged.</strong> Once registration closes we confirm which divisions are running and email accepted players a payment link. You'll have <strong>24 hours</strong> to pay the ${args.feeLabel} entry fee and lock in the spot.</p>
      <p><a href="${args.publicUrl}" style="color: #ea580c;">View the event page →</a></p>`
    ),
  });
}

/**
 * The accept email. Contains the Square payment link and a hard deadline —
 * this is the only thing that converts a request into a confirmed entry.
 */
export async function sendQuadInviteEmail(args: {
  to: string;
  playerName: string;
  tournamentName: string;
  divisionLabel: string;
  dateLabel: string;
  timeLabel: string;
  venue: string | null;
  feeLabel: string;
  deadlineLabel: string;
  paymentUrl: string;
}) {
  return safeResendSend(resend, {
    from: FROM,
    to: args.to,
    subject: `You're in — pay by ${args.deadlineLabel} to confirm: ${args.tournamentName}`,
    html: htmlShell(
      `${args.playerName} — you've got a spot!`,
      `<p><strong>${args.divisionLabel}</strong> is running and you're in.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
        <tr><td style="padding: 6px 0; color: #666;">Date</td><td style="padding: 6px 0; text-align: right;"><strong>${args.dateLabel}</strong></td></tr>
        <tr><td style="padding: 6px 0; color: #666;">Time</td><td style="padding: 6px 0; text-align: right;"><strong>${args.timeLabel}</strong></td></tr>
        ${args.venue ? `<tr><td style="padding: 6px 0; color: #666;">Where</td><td style="padding: 6px 0; text-align: right;"><strong>${args.venue}</strong></td></tr>` : ''}
        <tr><td style="padding: 6px 0; color: #666;">Entry fee</td><td style="padding: 6px 0; text-align: right;"><strong>${args.feeLabel}</strong></td></tr>
      </table>
      <p style="color: #555; font-size: 13px; margin: -6px 0 16px;">
        All four matches finish inside that window — drop off at the start, pick up at the end.
      </p>
      <p style="background: #FFF7EF; border-left: 4px solid #FF6E0C; padding: 12px 14px; margin: 16px 0;">
        Pay by <strong>${args.deadlineLabel}</strong> to confirm. After that the spot goes to the next player in line.
      </p>
      <p style="margin: 24px 0;">
        <a href="${args.paymentUrl}" style="display: inline-block; padding: 14px 28px; background: #FF6E0C; color: white; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 15px;">
          Pay ${args.feeLabel} and confirm my spot
        </a>
      </p>
      <p style="color: #888; font-size: 13px;">Or paste this into your browser:<br><code>${args.paymentUrl}</code></p>`
    ),
  });
}

/** Sent when the 24-hour payment window lapses without payment. */
export async function sendQuadInviteExpiredEmail(args: {
  to: string;
  playerName: string;
  tournamentName: string;
  divisionLabel: string;
  publicUrl: string;
}) {
  return safeResendSend(resend, {
    from: FROM,
    to: args.to,
    subject: `Spot released: ${args.tournamentName}`,
    html: htmlShell(
      `${args.playerName} — your hold expired`,
      `<p>The 24-hour window to pay for your <strong>${args.divisionLabel}</strong> spot has passed, so we've released it to the next player in line.</p>
      <p>If you still want to play, reply to this email — if there's room we'll get you back in.</p>
      <p><a href="${args.publicUrl}" style="color: #ea580c;">View the event page →</a></p>`
    ),
  });
}

/** Accepted on a full comp code — no payment link, just a confirmation. */
export async function sendQuadCompConfirmedEmail(args: {
  to: string;
  playerName: string;
  tournamentName: string;
  divisionLabel: string;
  dateLabel: string;
  timeLabel: string;
  venue: string | null;
  couponCode: string | null;
}) {
  return safeResendSend(resend, {
    from: FROM,
    to: args.to,
    subject: `Confirmed (entry comped): ${args.tournamentName}`,
    html: htmlShell(
      `${args.playerName} — you're confirmed`,
      `<p><strong>${args.divisionLabel}</strong> is running and your spot is locked in.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
        <tr><td style="padding: 6px 0; color: #666;">Date</td><td style="padding: 6px 0; text-align: right;"><strong>${args.dateLabel}</strong></td></tr>
        <tr><td style="padding: 6px 0; color: #666;">Time</td><td style="padding: 6px 0; text-align: right;"><strong>${args.timeLabel}</strong></td></tr>
        ${args.venue ? `<tr><td style="padding: 6px 0; color: #666;">Where</td><td style="padding: 6px 0; text-align: right;"><strong>${args.venue}</strong></td></tr>` : ''}
        <tr><td style="padding: 6px 0; color: #666;">Entry fee</td><td style="padding: 6px 0; text-align: right;"><strong>Comped${args.couponCode ? ` (${args.couponCode})` : ''}</strong></td></tr>
      </table>
      <p style="color: #555; font-size: 13px; margin: -6px 0 16px;">
        All four matches finish inside that window — drop off at the start, pick up at the end.
      </p>
      <p style="background: #ECFDF5; border-left: 4px solid #10B981; padding: 12px 14px; margin: 16px 0;">
        Nothing to pay — there's no payment link to act on. We'll email the match schedule before the event.
      </p>`
    ),
  });
}

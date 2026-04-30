/**
 * Quads tournament emails — confirmation, waitlist, promoted-from-waitlist,
 * doubles-round-set. All sends go through `safeResendSend()` so the
 * unsubscribe blocklist + footer apply automatically.
 */

import { Resend } from 'resend';
import { safeResendSend } from './emailUnsubscribe';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM =
  process.env.RESEND_FROM_EMAIL || 'CoachMode <noreply@mail.coachmode.ai>';

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

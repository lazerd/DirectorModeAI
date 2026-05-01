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

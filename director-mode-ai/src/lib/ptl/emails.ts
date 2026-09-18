/**
 * PTL transactional email.
 *
 * Everything goes through safeResendSend, which carries the unsubscribe footer
 * and the demo guard. On top of that, every function here takes a `seasonIsDemo`
 * flag and refuses outright when it's set — the same belt-and-braces as the
 * enrolment route, and for the same reason: a committee member clicking through
 * a demo draft must not cause a stranger to receive mail about a league that
 * does not exist.
 *
 * All sends are fire-and-forget at the call site. A draft pick that succeeded
 * must never fail because an inbox was unreachable.
 */

import 'server-only';
import { Resend } from 'resend';
import { safeResendSend } from '@/lib/emailUnsubscribe';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = process.env.RESEND_FROM_EMAIL || 'Premier Tennis League <noreply@mail.clubmode.ai>';

/** One shell so every PTL email looks like the same league. */
function shell(title: string, body: string, cta?: { href: string; label: string }): string {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#0f172a;">
      <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#64748b;">Premier Tennis League</div>
      <h2 style="margin:6px 0 16px;font-size:24px;line-height:1.2;">${title}</h2>
      ${body}
      ${
        cta
          ? `<p style="margin:26px 0 8px;"><a href="${cta.href}" style="display:inline-block;background:#0f766e;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">${cta.label}</a></p>`
          : ''
      }
    </div>
  `;
}

type Base = { to: string; seasonIsDemo: boolean; origin: string };

/** Sends unless the season is a demo. Returns whether it actually went. */
async function send(
  { to, seasonIsDemo }: Base,
  subject: string,
  html: string,
): Promise<boolean> {
  if (seasonIsDemo) return false;
  if (!to || !to.includes('@')) return false;
  try {
    await safeResendSend(resend, { from: FROM, to, subject, html });
    return true;
  } catch (err) {
    console.error('[ptl] email failed', subject, err);
    return false;
  }
}

/**
 * A captain's draft-room link.
 *
 * The link IS the credential, so the email says so plainly — a captain who
 * forwards it to their team has handed over their picks, and nobody reads a
 * warning written in small print at the bottom.
 */
export async function sendCaptainInvite(
  base: Base,
  opts: { captainName: string | null; teamName: string; seasonName: string; token: string; rosterSize: number },
) {
  const url = `${base.origin}/ptl/draft/${opts.token}`;
  return send(
    base,
    `Your draft room — ${opts.teamName}`,
    shell(
      `You're captaining ${opts.teamName}.`,
      `
        <p style="line-height:1.6;">${opts.captainName ? `${opts.captainName.split(' ')[0]}, y` : 'Y'}ou're
        drafting a roster of ${opts.rosterSize} for <strong>${opts.seasonName}</strong>.</p>
        <div style="background:#f8fafc;border-left:4px solid #0f766e;padding:14px 18px;border-radius:6px;margin:18px 0;">
          <div style="font-weight:600;margin-bottom:6px;">Before draft night</div>
          <p style="margin:0;line-height:1.6;color:#334155;">Open your room and build a queue. If your
          clock runs out we take the top name still available from it — so you can't lose a pick by
          being on a court, in a car, or asleep.</p>
        </div>
        <p style="line-height:1.6;color:#b91c1c;"><strong>This link is your credential.</strong> Anyone
        who has it can draft as ${opts.teamName}, so don't forward it to your team.</p>
      `,
      { href: url, label: 'Open your draft room' },
    ),
  );
}

/** You're on the clock. The one email that has to arrive within seconds. */
export async function sendOnTheClock(
  base: Base,
  opts: { teamName: string; token: string; pickNo: number; roundNo: number; seconds: number },
) {
  const url = `${base.origin}/ptl/draft/${opts.token}`;
  const mins = Math.round(opts.seconds / 60);
  return send(
    base,
    `You're on the clock — pick ${opts.pickNo}`,
    shell(
      `${opts.teamName} is on the clock.`,
      `
        <p style="line-height:1.6;">Pick ${opts.pickNo}, round ${opts.roundNo}. You have about
        ${mins} minute${mins === 1 ? '' : 's'}.</p>
        <p style="line-height:1.6;color:#334155;">If the clock runs out we'll take the top player
        still available on your queue.</p>
      `,
      { href: url, label: 'Make your pick' },
    ),
  );
}

/** You've been drafted. The email a player actually wants. */
export async function sendDrafted(
  base: Base,
  opts: { playerName: string; teamName: string; captainName: string | null; seasonName: string; seasonSlug: string; roundNo: number },
) {
  return send(
    base,
    `You're on ${opts.teamName}`,
    shell(
      `${opts.teamName} drafted you.`,
      `
        <p style="line-height:1.6;">${opts.playerName.split(' ')[0]}, you went in round
        ${opts.roundNo} of the <strong>${opts.seasonName}</strong> draft${
          opts.captainName ? ` to ${opts.captainName}` : ''
        }.</p>
        <p style="line-height:1.6;color:#334155;">Your season grid is published — every date, up
        front — and your captain will be in touch about the first night.</p>
      `,
      { href: `${base.origin}/ptl/schedule?season=${opts.seasonSlug}`, label: 'See your schedule' },
    ),
  );
}

/** Match night is coming. Sent to a whole roster, so it batches at the call site. */
export async function sendNightReminder(
  base: Base,
  opts: { playerName: string; teamName: string; dateLabel: string; siteName: string | null; startTime: string | null; seasonSlug: string },
) {
  return send(
    base,
    `${opts.teamName} play ${opts.dateLabel}`,
    shell(
      `${opts.dateLabel}.`,
      `
        <p style="line-height:1.6;">${opts.playerName.split(' ')[0]}, ${opts.teamName} are on
        ${opts.dateLabel}${opts.startTime ? ` at ${opts.startTime.slice(0, 5)}` : ''}${
          opts.siteName ? `, ${opts.siteName}` : ''
        }.</p>
        <p style="line-height:1.6;color:#334155;">A division of four plays a full round robin in the
        evening, so you face all three rivals. Expect about three hours.</p>
      `,
      { href: `${base.origin}/ptl/schedule?season=${opts.seasonSlug}`, label: 'See the grid' },
    ),
  );
}

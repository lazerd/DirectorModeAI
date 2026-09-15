/**
 * Telling a waiting group their court is ready.
 *
 * The phone page is the primary channel: it polls and shows "Court 4 is
 * yours" the moment the offer exists. Email is for the group that put the
 * phone in a bag. SMS is the obvious third channel and is deliberately not
 * wired: the Twilio number is blocked on A2P 10DLC registration, and a text
 * that silently never arrives is worse than no text. `sendSms` is the seam —
 * implement it and the offer path picks it up.
 */

import { sendBilledEmail } from '@/lib/email';
import { APP_URL } from '@/lib/appUrl';
import { normalizeTimeZone } from '@/lib/captain/clubTime';
import type { CheckinClub, WaitRow } from './server';

const esc = (s: string) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const fromLine = (clubName: string) => {
  const clean = (clubName || 'Club').replace(/["<>\r\n]/g, '').trim() || 'Club';
  const display = /^[\x20-\x7E]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
  return `${display} <noreply@mail.clubmode.ai>`;
};

/** 10:42 AM in the club's zone. Never the server's: Vercel is UTC. */
export function clubClock(ms: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: normalizeTimeZone(timezone),
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(ms));
}

export const groupUrl = (groupToken: string) => `${APP_URL}/q/s/${groupToken}`;

/** Not implemented — see the note at the top. Returns false so callers fall back. */
export async function sendSms(_to: string, _body: string): Promise<boolean> {
  return false;
}

export async function notifyOffer(opts: {
  club: CheckinClub;
  wait: WaitRow;
  spaceName: string;
  expiresAt: number;
}): Promise<boolean> {
  const { club, wait } = opts;
  if (!wait.contact_email) return false;
  const first = wait.players[0]?.name?.trim().split(/\s+/)[0] || 'there';
  const by = clubClock(opts.expiresAt, club.timezone);
  const link = groupUrl(wait.group_token);

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:17px;color:#1f2937;line-height:1.55;max-width:560px;margin:0 auto">
  <p>Hi ${esc(first)} —</p>
  <p style="font-size:24px;font-weight:700;margin:14px 0">${esc(opts.spaceName)} is yours.</p>
  <p>Head over and tap <strong>Start playing</strong> by <strong>${esc(by)}</strong>, or the court goes to the next group on the list.</p>
  <p style="margin:22px 0"><a href="${link}" style="display:inline-block;background:#155e6d;color:#fff;font-weight:700;text-decoration:none;padding:15px 26px;border-radius:10px;font-size:18px">Open my court page</a></p>
  <p style="color:#6b7280;font-size:14px">— ${esc(club.name)}</p>
</div>`;

  const result = await sendBilledEmail(club.owner_id, {
    to: wait.contact_email,
    subject: `${opts.spaceName} is ready for you — start by ${by}`,
    html,
    replyTo: club.email || undefined,
    from: fromLine(club.name),
  });
  return !!result?.sent;
}

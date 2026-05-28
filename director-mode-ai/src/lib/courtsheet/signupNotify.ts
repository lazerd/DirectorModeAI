/**
 * Notify signups when their reservation changes.
 *
 * Fired from the engine wrapper any time a reservation with active
 * signups is moved (court/time/date) or cancelled. Looks up the active
 * signup recipients, sends a Resend email through the existing
 * safeResendSend() footer pipeline.
 *
 * Resend is best-effort — failures are logged, never thrown.
 */

import { sendBilledEmails } from '@/lib/email';
import type { Reservation, Signup, Court, Club } from './types';
import { utcToLocalDate, utcToLocalTime } from './timezones';

interface NotifyArgs {
  reservation: Reservation;
  newReservation?: Reservation; // for change notifications
  signups: Signup[];
  court: Court | null;
  club: Club;
  kind: 'cancelled' | 'changed';
  /** The user id of the actor responsible for billing the emails. */
  actor_user_id: string | null;
}

/**
 * Fan out email to every active signup recipient. Skips waitlist + cancelled.
 * Uses guest_email when set, otherwise needs auth.users.email lookup (skipped
 * in this version — vault_player_id lookups TBD when PlayerVault has email).
 */
export async function notifySignupsOfReservationChange(args: NotifyArgs): Promise<void> {
  try {
    const recipients = args.signups
      .filter((s) => s.status === 'requested' || s.status === 'confirmed')
      .map((s) => ({
        email: s.guest_email,
        name: s.guest_name,
      }))
      .filter((r): r is { email: string; name: string | null } => Boolean(r.email));

    if (recipients.length === 0) return;

    const courtLabel = args.court ? args.court.name ?? `Court ${args.court.number}` : 'court';
    const oldDate = utcToLocalDate(args.reservation.starts_at, args.club.timezone);
    const oldStart = utcToLocalTime(args.reservation.starts_at, args.club.timezone);
    const oldEnd = utcToLocalTime(args.reservation.ends_at, args.club.timezone);

    const subject =
      args.kind === 'cancelled'
        ? `Cancelled: ${args.reservation.title}`
        : `Updated: ${args.reservation.title}`;

    const payloads = recipients.map((r) => ({
      to: r.email,
      subject,
      html: htmlBody({
        recipientName: r.name,
        clubName: args.club.name,
        kind: args.kind,
        title: args.reservation.title,
        court: courtLabel,
        oldDate,
        oldStart,
        oldEnd,
        newReservation: args.newReservation,
        timezone: args.club.timezone,
      }),
    }));

    await sendBilledEmails(args.actor_user_id, payloads);
  } catch (err) {
    console.error('[courtsheet signupNotify] failed:', err);
  }
}

function htmlBody(args: {
  recipientName: string | null;
  clubName: string;
  kind: 'cancelled' | 'changed';
  title: string;
  court: string;
  oldDate: string;
  oldStart: string;
  oldEnd: string;
  newReservation?: Reservation;
  timezone: string;
}): string {
  const lead =
    args.kind === 'cancelled'
      ? `Your signup for <strong>${escapeHtml(args.title)}</strong> at <strong>${escapeHtml(args.clubName)}</strong> has been cancelled.`
      : `Your signup for <strong>${escapeHtml(args.title)}</strong> at <strong>${escapeHtml(args.clubName)}</strong> has been updated.`;

  let body = `
    <div style="font-family: -apple-system, Inter, system-ui, sans-serif; color: #0f172a; max-width: 560px; margin: 0 auto;">
      <p>Hi${args.recipientName ? ` ${escapeHtml(args.recipientName)}` : ''},</p>
      <p>${lead}</p>
      <div style="background:#f8fafc; border-radius:12px; padding:14px 16px; margin:18px 0;">
        <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:#64748b;">Originally</div>
        <div style="font-weight:600; margin-top:2px;">${escapeHtml(args.court)}</div>
        <div style="color:#475569; font-variant-numeric:tabular-nums;">${args.oldDate} · ${args.oldStart} – ${args.oldEnd}</div>
      </div>
  `;

  if (args.newReservation && args.kind === 'changed') {
    const newDate = utcToLocalDate(args.newReservation.starts_at, args.timezone);
    const newStart = utcToLocalTime(args.newReservation.starts_at, args.timezone);
    const newEnd = utcToLocalTime(args.newReservation.ends_at, args.timezone);
    body += `
      <div style="background:#ecfccb; border-radius:12px; padding:14px 16px; margin:18px 0;">
        <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:#3f6212;">Now</div>
        <div style="font-weight:600; margin-top:2px; color:#1a2e05;">${escapeHtml(args.court)}</div>
        <div style="color:#3f6212; font-variant-numeric:tabular-nums;">${newDate} · ${newStart} – ${newEnd}</div>
      </div>
    `;
  }

  body += `
      <p style="color:#64748b; font-size:13px;">
        If you can no longer make it, head back to the club's sheet to cancel your spot so someone else can grab it.
      </p>
      <p style="color:#94a3b8; font-size:12px; margin-top:24px;">
        — ${escapeHtml(args.clubName)} via CourtSheet AI
      </p>
    </div>
  `;
  return body;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

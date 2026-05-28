/**
 * CourtSheet — SMS confirmations via the existing Twilio integration.
 *
 * Reuses src/lib/twilio.ts (same Twilio account, same phone number, same
 * Pro-tier 200 SMS/mo budget enforced via consumeSmsCredits). No new env
 * vars required — TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN /
 * TWILIO_PHONE_NUMBER are already set in Vercel from the other SMS
 * routes (lesson-reminder, match-time, stringing-pickup).
 *
 * Send paths:
 *   sendBookingConfirmation — staff books a court and opted into SMS
 *   sendSignupConfirmation  — public member signs up and opted into SMS
 *
 * Best-effort — failures are logged, never thrown back to the caller.
 * CreditLimitError (the Pro 200/mo cap) is swallowed; the booking still
 * succeeds, the SMS just doesn't go out.
 */

import { sendSms } from '@/lib/twilio';
import { CreditLimitError } from '@/lib/billing';
import type { Reservation, Court, Club, Signup } from './types';
import { utcToLocalDate, utcToLocalTime } from './timezones';

const APP_NAME = 'CourtSheet';

interface BookingArgs {
  reservation: Reservation;
  court: Court | null;
  club: Club;
  /** Owner of the booking — billed for SMS credits. */
  actor_user_id: string;
}

export async function sendBookingConfirmation(args: BookingArgs): Promise<void> {
  try {
    const meta = args.reservation.meta ?? {};
    const optIn = Boolean((meta as any).booker_sms_opt_in);
    const phone = (meta as any).booker_sms_phone as string | undefined;
    if (!optIn || !phone) return;

    const body = formatBookingConfirmation({
      title: args.reservation.title,
      court: args.court,
      club: args.club,
      starts_at: args.reservation.starts_at,
      ends_at: args.reservation.ends_at,
    });

    await sendSms(args.actor_user_id, phone, body);
  } catch (err) {
    if (err instanceof CreditLimitError) {
      console.warn('[courtsheet sms] booker SMS skipped — over monthly cap');
      return;
    }
    console.error('[courtsheet sms] sendBookingConfirmation failed:', err);
  }
}

interface SignupArgs {
  signup: Signup;
  reservation: Reservation;
  court: Court | null;
  club: Club;
  /** Owner of the club — billed for SMS credits. */
  club_owner_user_id: string;
}

export async function sendSignupConfirmation(args: SignupArgs): Promise<void> {
  try {
    if (!args.signup.sms_opt_in || !args.signup.sms_phone) return;

    const body = formatSignupConfirmation({
      reservation: args.reservation,
      court: args.court,
      club: args.club,
      isWaitlist: args.signup.status === 'waitlist',
    });

    await sendSms(args.club_owner_user_id, args.signup.sms_phone, body);
  } catch (err) {
    if (err instanceof CreditLimitError) {
      console.warn('[courtsheet sms] signup SMS skipped — over monthly cap');
      return;
    }
    console.error('[courtsheet sms] sendSignupConfirmation failed:', err);
  }
}

// -------- formatters --------

function formatBookingConfirmation(args: {
  title: string;
  court: Court | null;
  club: Club;
  starts_at: string;
  ends_at: string;
}): string {
  const courtLabel = args.court
    ? args.court.name ?? `Court ${args.court.number}`
    : 'court';
  const date = utcToLocalDate(args.starts_at, args.club.timezone);
  const start = utcToLocalTime(args.starts_at, args.club.timezone);
  const end = utcToLocalTime(args.ends_at, args.club.timezone);
  return [
    `${APP_NAME}: "${args.title}"`,
    `${courtLabel} · ${date}`,
    `${start}–${end}`,
    `— ${args.club.name}`,
  ].join('\n');
}

function formatSignupConfirmation(args: {
  reservation: Reservation;
  court: Court | null;
  club: Club;
  isWaitlist: boolean;
}): string {
  const courtLabel = args.court
    ? args.court.name ?? `Court ${args.court.number}`
    : 'court';
  const date = utcToLocalDate(args.reservation.starts_at, args.club.timezone);
  const start = utcToLocalTime(args.reservation.starts_at, args.club.timezone);
  const end = utcToLocalTime(args.reservation.ends_at, args.club.timezone);
  const lead = args.isWaitlist
    ? `${APP_NAME}: You're on the waitlist`
    : `${APP_NAME}: You're in!`;
  return [
    lead,
    `"${args.reservation.title}"`,
    `${courtLabel} · ${date}`,
    `${start}–${end}`,
    `— ${args.club.name}`,
  ].join('\n');
}

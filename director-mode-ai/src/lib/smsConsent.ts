/**
 * The exact opt-in wording shown on /sms. Carriers review this string during
 * A2P 10DLC vetting, and the same text is stored with every consent row as the
 * record of what the person agreed to. Do not shorten it.
 */
export const SMS_CONSENT_TEXT =
  'I agree to receive text messages from ClubMode about my club and team activity: ' +
  'match lineups, confirmation requests, court assignments, schedule changes, reminders, ' +
  'and match-day group messages with the other players in my match. ' +
  'Message frequency varies (typically 1–4 per match). Msg & data rates may apply. ' +
  'Reply STOP to unsubscribe or HELP for help. Consent is not a condition of joining any team or club.';

/** US numbers only: returns +1XXXXXXXXXX or null. */
export function toE164US(raw: string): string | null {
  const d = raw.replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return null;
}

/**
 * Turning what a captain types into what a carrier needs.
 *
 * A captain types "925-555-0148". Twilio needs "+19255550148". Storing the
 * former means the number looks perfectly fine on the roster and then fails at
 * send time — hours later, in a batch, when someone needed telling their court
 * had changed. Normalising on the way IN makes a bad number a visible error at
 * the moment it is typed, which is the only time it is cheap to fix.
 */

/**
 * US-centric on purpose: this is a club roster, and a bare 10-digit number
 * typed by a captain is a US mobile. Anything already carrying a `+` is passed
 * through untouched so an international number still works.
 *
 * Returns null for anything it cannot confidently read — the caller reports it
 * rather than storing a number that will quietly fail later.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  // Keep digits and a leading +; drop the spaces, dots, dashes and brackets
  // people put in phone numbers.
  const cleaned = trimmed.replace(/[^\d+]/g, '');
  if (!cleaned || cleaned === '+') return null;

  if (cleaned.startsWith('+')) {
    // A + with nothing but a country code behind it is not a number.
    return cleaned.length >= 8 ? cleaned : null;
  }

  const digits = cleaned.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

/** How a normalised number should read back to a human: (925) 555-0148. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

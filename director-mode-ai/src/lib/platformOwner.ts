/**
 * Who may use "view as".
 *
 * Deliberately NOT the club `owner` role: that is a customer, and a customer
 * borrowing a member's session is a different product decision with its own
 * consent questions. This is the platform operator — us — and the list lives
 * in the environment so adding someone is a deploy, not a row a compromised
 * account could write.
 *
 *     PLATFORM_OWNER_EMAILS=darrinjco@gmail.com,someone@else.com
 *
 * Unset means only the founding address, so a fresh environment is neither
 * wide open nor locked out.
 */

const FALLBACK = ['darrinjco@gmail.com'];

export function platformOwnerEmails(): string[] {
  const raw = process.env.PLATFORM_OWNER_EMAILS;
  if (!raw) return FALLBACK;
  const list = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.length ? list : FALLBACK;
}

export function isPlatformOwnerEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return platformOwnerEmails().includes(email.trim().toLowerCase());
}

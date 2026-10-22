/**
 * Founding-network referrals. Pure: code format, validation and the rule for when a
 * referral counts. DB work lives in the candidate route.
 *
 * A referral counts only when the person who arrived on someone's link saves their
 * FIRST candidate profile themselves. Nobody is enrolled by clicking a link, and an
 * existing candidate can't be re-attributed.
 */

/** Unambiguous alphabet (no 0/O, 1/I/L). */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const REFERRAL_CODE_LENGTH = 8;
export const REF_COOKIE = 'cm_ref';
export const REF_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function makeReferralCode(random: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) s += ALPHABET[Math.floor(random() * ALPHABET.length) % ALPHABET.length];
  return s;
}

/** A well-formed code (upper-cased), or null. */
export function normalizeRefCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toUpperCase();
  if (s.length !== REFERRAL_CODE_LENGTH) return null;
  for (const ch of s) if (!ALPHABET.includes(ch)) return null;
  return s;
}

export function shouldRecordReferral(i: {
  isNewProfile: boolean;
  referrerId: string | null | undefined;
  referredId: string;
  referrerDeleted?: boolean;
}): boolean {
  if (!i.isNewProfile) return false;
  if (!i.referrerId || i.referrerDeleted) return false;
  return i.referrerId !== i.referredId;
}

export const referralPath = (code: string) => `/connect/join?ref=${encodeURIComponent(code)}`;

/** Top referrers from connect_referrals rows. */
export function topReferrers(rows: { referrer_candidate_id: string }[], limit = 5): { candidate_id: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.referrer_candidate_id, (m.get(r.referrer_candidate_id) ?? 0) + 1);
  return Array.from(m, ([candidate_id, count]) => ({ candidate_id, count }))
    .sort((a, b) => b.count - a.count || a.candidate_id.localeCompare(b.candidate_id))
    .slice(0, limit);
}

import { createHmac, timingSafeEqual } from 'crypto';

/*
 * The members' pass: a signed cookie that says "this browser entered a valid member
 * code". It only opens the clubhouse pages (what ClubMode is, the staff, the rooms);
 * it is not a login and grants no club data. Signing in still works as before.
 */

export const PASS_COOKIE = 'cm_member_pass';
export const PASS_DAYS = 60;

const secret = () => 'member-pass:' + (process.env.UNSUBSCRIBE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'dev-member-pass');
const sig = (body: string) => createHmac('sha256', secret()).update(body).digest('base64url');

export const normalizeCode = (raw: unknown) => String(raw ?? '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 32);

export function signPass(code: string, now = Date.now()): string {
  const body = `${normalizeCode(code)}.${now + PASS_DAYS * 86_400_000}`;
  return `${body}.${sig(body)}`;
}

/** The code on a valid, unexpired pass; null otherwise. */
export function verifyPass(value: string | undefined | null, now = Date.now()): string | null {
  if (!value) return null;
  const i = value.lastIndexOf('.');
  if (i < 0) return null;
  const body = value.slice(0, i);
  const want = sig(body);
  const got = value.slice(i + 1);
  if (want.length !== got.length || !timingSafeEqual(Buffer.from(want), Buffer.from(got))) return null;
  const [code, exp] = body.split('.');
  if (!code || !(Number(exp) > now)) return null;
  return code;
}

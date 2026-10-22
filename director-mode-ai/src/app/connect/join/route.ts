import { NextResponse } from 'next/server';
import { normalizeRefCode, REF_COOKIE, REF_COOKIE_MAX_AGE } from '@/lib/connect/referrals';

export const dynamic = 'force-dynamic';

// GET /connect/join?ref=<code> — a candidate's private invite link. Remembers the code
// (cookie, plus ?ref on the next page) through sign-up, then lands on the founding
// network page. Nothing is created here: the referral is recorded only if this person
// later saves their own candidate profile on /connect/candidate.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ref = normalizeRefCode(url.searchParams.get('ref'));
  const dest = new URL('/connect/founding', url.origin);
  if (ref) dest.searchParams.set('ref', ref);
  const res = NextResponse.redirect(dest);
  if (ref) {
    res.cookies.set(REF_COOKIE, ref, { path: '/', maxAge: REF_COOKIE_MAX_AGE, httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:' });
  }
  return res;
}

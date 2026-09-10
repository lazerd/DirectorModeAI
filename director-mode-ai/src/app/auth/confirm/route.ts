import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { safeNext } from '@/lib/postLogin';

/**
 * /auth/confirm — where confirmation, magic-link, invite and password-reset
 * emails land.
 *
 * Supabase's default PKCE links only work in the browser that asked for them:
 * the code verifier sits in that browser's storage. A director who signs up on
 * a laptop and taps the email on their phone got a dead link. A `token_hash`
 * link is verified here, server-side, so it works on any device.
 *
 * The email templates must point at this route for it to matter:
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup
 * (type=recovery for the reset template, and so on).
 */
const OTP_TYPES: EmailOtpType[] = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email'];

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get('token_hash');
  const rawType = searchParams.get('type');
  const type = OTP_TYPES.find((t) => t === rawType);

  if (!tokenHash || !type) redirect('/login?error=link');

  // The cookie-scoped server client, so a successful verify writes the session
  // cookies onto this response and the user arrives signed in.
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) redirect('/login?error=link');

  const next = safeNext(searchParams.get('next'));
  if (next) redirect(next);
  redirect(type === 'recovery' ? '/reset-password' : '/welcome');
}

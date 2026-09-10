/**
 * authErrors.ts — Supabase auth error strings, rewritten for a club director.
 *
 * Supabase returns messages like "email rate limit exceeded" verbatim; shown
 * as-is they read like the product is broken. Match loosely (Supabase rewords
 * these between versions) and fall back to the caller's copy.
 */
const RULES: { test: RegExp; copy: (m: RegExpMatchArray) => string }[] = [
  {
    test: /only request this after (\d+) seconds?/i,
    copy: (m) => `Please wait ${m[1]} seconds before requesting another link.`,
  },
  {
    test: /rate limit|too many requests/i,
    copy: () => 'Too many emails have been sent to this address recently. Please wait a few minutes and try again.',
  },
  {
    test: /invalid login credentials/i,
    copy: () => "That email and password don't match an account.",
  },
  {
    test: /email not confirmed/i,
    copy: () => 'Please confirm your email first — check your inbox for the link we sent.',
  },
  {
    test: /unable to validate email|invalid email|invalid format/i,
    copy: () => "That doesn't look like a valid email address.",
  },
  {
    test: /failed to fetch|network/i,
    copy: () => "We couldn't reach the server. Check your connection and try again.",
  },
];

export function friendlyAuthError(message: string | null | undefined, fallback: string): string {
  if (!message) return fallback;
  for (const rule of RULES) {
    const m = message.match(rule.test);
    if (m) return rule.copy(m);
  }
  return fallback;
}

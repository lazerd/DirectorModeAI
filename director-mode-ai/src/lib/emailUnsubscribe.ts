/**
 * Email unsubscribe helpers.
 *
 * Every outbound transactional email goes through `safeResendSend()`, which:
 *   1. Queries `email_unsubscribes` to see if the recipient has opted out
 *   2. Short-circuits (returns without calling Resend) if they have
 *   3. Otherwise appends a signed unsubscribe footer to the HTML and sends
 *
 * Tokens are HMAC-SHA256 signatures over `email:scope`, base64url-encoded
 * alongside the payload so the /unsubscribe page can verify them without a
 * database lookup. Secret derivation: UNSUBSCRIBE_SECRET env var, with
 * SUPABASE_SERVICE_ROLE_KEY as fallback so production always has a strong
 * secret by default. Dev falls through to a static string.
 *
 * Compliance: CAN-SPAM § 5 requires a working opt-out for every commercial
 * email to US recipients, honored within 10 business days. One-click GET
 * unsubscribe from the footer link satisfies the "working" requirement;
 * immediate insert into the blocklist + pre-send filter honors the
 * "process within 10 business days" requirement instantly.
 */

import crypto from 'crypto';
import type { Resend } from 'resend';
import { getSupabaseAdmin } from './supabase/admin';

export type UnsubscribeScope = 'all';

// ----- token signing -----

function getSecret(): string {
  return (
    process.env.UNSUBSCRIBE_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    'dev-unsubscribe-secret-do-not-use-in-prod'
  );
}

/**
 * Sign an HMAC token encoding (email, scope). Output is URL-safe base64,
 * suitable for `/unsubscribe?token=...`. The same email always produces
 * the same token with the same secret, so we don't need to store tokens
 * anywhere — the /unsubscribe page just verifies and inserts.
 */
export function signUnsubscribeToken(
  email: string,
  scope: UnsubscribeScope = 'all'
): string {
  const payload = `${email.toLowerCase()}:${scope}`;
  const sig = crypto
    .createHmac('sha256', getSecret())
    .update(payload)
    .digest('hex')
    .slice(0, 24); // 96 bits is plenty for a non-authentication use case
  return Buffer.from(`${payload}:${sig}`, 'utf8').toString('base64url');
}

/**
 * Decode + verify a token. Returns the email + scope on success, or null
 * if the signature doesn't match or the format is wrong. Constant-time
 * comparison to avoid timing oracles.
 */
export function verifyUnsubscribeToken(
  token: string
): { email: string; scope: UnsubscribeScope } | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length !== 3) return null;
    const [email, scope, sig] = parts;
    if (!email || !scope || !sig) return null;
    const expected = crypto
      .createHmac('sha256', getSecret())
      .update(`${email}:${scope}`)
      .digest('hex')
      .slice(0, 24);
    // timingSafeEqual requires same-length buffers
    if (sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    if (scope !== 'all') return null;
    return { email, scope: 'all' };
  } catch {
    return null;
  }
}

// ----- blocklist queries -----

/**
 * Check whether an address has opted out of all email. Case-insensitive.
 * Returns false on any DB error so a flaky query never blocks sending
 * (we err toward deliverability rather than silent failure).
 */
export async function isUnsubscribed(email: string): Promise<boolean> {
  if (!email) return false;
  try {
    const admin = getSupabaseAdmin();
    const { data } = await admin
      .from('email_unsubscribes')
      .select('id')
      .eq('email', email.toLowerCase())
      .eq('scope', 'all')
      .maybeSingle();
    return !!data;
  } catch (e) {
    console.error('isUnsubscribed query failed:', e);
    return false;
  }
}

/**
 * Upsert an unsubscribe row. Called from the /unsubscribe page after the
 * token verifies. Idempotent via the (email, scope) unique constraint.
 */
export async function recordUnsubscribe(
  email: string,
  scope: UnsubscribeScope = 'all'
): Promise<{ success: boolean; error?: string }> {
  try {
    const admin = getSupabaseAdmin();
    const { error } = await admin
      .from('email_unsubscribes')
      .upsert(
        { email: email.toLowerCase(), scope, unsubscribed_at: new Date().toISOString() },
        { onConflict: 'email,scope' }
      );
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message || 'unknown' };
  }
}

/**
 * Remove an unsubscribe row — lets a user resubscribe after opting out.
 */
export async function removeUnsubscribe(
  email: string,
  scope: UnsubscribeScope = 'all'
): Promise<{ success: boolean; error?: string }> {
  try {
    const admin = getSupabaseAdmin();
    const { error } = await admin
      .from('email_unsubscribes')
      .delete()
      .eq('email', email.toLowerCase())
      .eq('scope', scope);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message || 'unknown' };
  }
}

// ----- HTML footer -----

/**
 * Build the standard unsubscribe footer HTML that appends to every email.
 * Returns a thin gray section with a link to the one-click /unsubscribe
 * page signed for this specific recipient.
 */
export function buildUnsubscribeFooterHtml(email: string): string {
  const token = signUnsubscribeToken(email);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://club.coachmode.ai';
  const url = `${baseUrl}/unsubscribe?token=${token}`;
  return `
    <div style="max-width: 600px; margin: 0 auto; padding: 0 20px;">
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0 12px;" />
      <p style="color: #9ca3af; font-size: 11px; text-align: center; margin: 0 0 8px; font-family: -apple-system, sans-serif;">
        Sent by ClubMode AI · <a href="${url}" style="color: #6b7280; text-decoration: underline;">Unsubscribe from these emails</a>
      </p>
    </div>
  `;
}

// ----- drop-in Resend wrapper -----

type ResendSendInput = {
  from: string;
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
};

export type SafeSendResult =
  | { sent: true; messageId?: string }
  | { sent: false; reason: 'unsubscribed' | 'error'; error?: string };

/**
 * Drop-in replacement for `resend.emails.send(...)`. Usage:
 *
 *   import { safeResendSend } from '@/lib/emailUnsubscribe';
 *   await safeResendSend(resend, { from, to, subject, html });
 *
 * Behavior:
 *   - If the recipient is in email_unsubscribes, returns {sent: false,
 *     reason: 'unsubscribed'} without calling Resend (no quota burn).
 *   - Otherwise, appends the unsubscribe footer HTML and calls
 *     resend.emails.send with the augmented body.
 *   - Logs errors and returns {sent: false, reason: 'error'} on failure
 *     instead of throwing, so calling code's fire-and-forget patterns
 *     don't need to add new try/catch.
 */
export async function safeResendSend(
  resend: Resend,
  input: ResendSendInput
): Promise<SafeSendResult> {
  if (!input.to) {
    return { sent: false, reason: 'error', error: 'missing recipient' };
  }
  if (await isUnsubscribed(input.to)) {
    return { sent: false, reason: 'unsubscribed' };
  }
  const htmlWithFooter = input.html + buildUnsubscribeFooterHtml(input.to);
  try {
    const resendInput: any = {
      from: input.from,
      to: input.to,
      subject: input.subject,
      html: htmlWithFooter,
    };
    if (input.replyTo) resendInput.replyTo = input.replyTo;
    const result = await resend.emails.send(resendInput);
    return { sent: true, messageId: (result as any)?.data?.id };
  } catch (e: any) {
    console.error('safeResendSend failed:', e);
    return { sent: false, reason: 'error', error: e?.message || 'unknown' };
  }
}

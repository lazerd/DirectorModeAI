import { Resend } from 'resend';
import { consumeEmailCredits, CreditLimitError } from '@/lib/billing';
import { createServiceClient } from '@/lib/supabase/server';
import { safeResendSend, type SafeSendResult } from '@/lib/emailUnsubscribe';

const resend = new Resend(process.env.RESEND_API_KEY);

interface EmailPayload {
  from?: string;
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}

const DEFAULT_FROM = process.env.RESEND_FROM_EMAIL || 'ClubMode <onboarding@resend.dev>';

/**
 * Drop-in send that does TWO things at once:
 *   1. Consumes one email credit on the owning user's plan (throws CreditLimitError if over cap)
 *   2. Routes through safeResendSend so unsubscribed recipients are skipped + footer is appended
 *
 * Returns the SafeSendResult so callers can branch on `r.sent`. If the recipient was
 * unsubscribed or the send failed, the credit was still consumed — keeps the implementation
 * simple and avoids race conditions.
 */
export async function sendBilledEmail(userId: string | null, payload: EmailPayload): Promise<SafeSendResult> {
  if (userId) {
    await consumeEmailCredits(userId, 1);
  }
  return safeResendSend(resend, {
    from: payload.from || DEFAULT_FROM,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    ...(payload.replyTo ? { replyTo: payload.replyTo } : {}),
  });
}

export async function sendBilledEmails(userId: string | null, payloads: EmailPayload[]): Promise<SafeSendResult[]> {
  if (userId) {
    await consumeEmailCredits(userId, payloads.length);
  }
  return Promise.all(
    payloads.map((p) =>
      safeResendSend(resend, {
        from: p.from || DEFAULT_FROM,
        to: p.to,
        subject: p.subject,
        html: p.html,
        ...(p.replyTo ? { replyTo: p.replyTo } : {}),
      })
    )
  );
}

export async function resolveCoachUserId(coachId?: string | null, coachEmail?: string | null): Promise<string | null> {
  if (!coachId && !coachEmail) return null;
  const supabase = await createServiceClient();
  if (coachId) {
    const { data } = await supabase
      .from('lesson_coaches')
      .select('profile_id')
      .eq('id', coachId)
      .maybeSingle();
    if (data?.profile_id) return data.profile_id;
  }
  if (coachEmail) {
    const { data } = await supabase
      .from('lesson_coaches')
      .select('profile_id')
      .eq('email', coachEmail)
      .maybeSingle();
    if (data?.profile_id) return data.profile_id;
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', coachEmail)
      .maybeSingle();
    return profile?.id || null;
  }
  return null;
}

export async function resolveStringerUserId(jobId?: string | null): Promise<string | null> {
  if (!jobId) return null;
  const supabase = await createServiceClient();
  const { data } = await supabase
    .from('stringing_jobs')
    .select('stringer_id, profile_id, user_id')
    .eq('id', jobId)
    .maybeSingle();
  return (data as any)?.stringer_id || (data as any)?.profile_id || (data as any)?.user_id || null;
}

export async function resolveCcEventOwner(eventId?: string | null): Promise<string | null> {
  if (!eventId) return null;
  const supabase = await createServiceClient();
  const { data } = await supabase
    .from('cc_events')
    .select('organizer_id, created_by, user_id')
    .eq('id', eventId)
    .maybeSingle();
  return (data as any)?.organizer_id || (data as any)?.created_by || (data as any)?.user_id || null;
}

export function creditLimitResponse(err: CreditLimitError) {
  return Response.json(
    {
      error: 'credit_limit',
      kind: err.kind,
      tier: err.tier,
      limit: err.limit,
      message: `You've reached your ${err.kind} limit on the ${err.tier} plan (${err.limit}). Upgrade to keep sending.`,
      upgradeUrl: '/pricing',
    },
    { status: 402 }
  );
}

export { CreditLimitError };
export type { SafeSendResult };

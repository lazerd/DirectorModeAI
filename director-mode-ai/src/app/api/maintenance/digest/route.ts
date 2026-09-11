/**
 * GET  /api/maintenance/digest — preview today's digest for this club. Sends nothing.
 * POST /api/maintenance/digest — send a test copy to the caller only.
 * Owner / director. The daily send is /api/cron/maintenance-digest.
 */
import { NextResponse } from 'next/server';
import { requireMaintenanceContext, isAuthError, bad } from '@/lib/maintenance/server';
import { buildClubDigest } from '@/lib/maintenance/digestRunner';
import { sendBilledEmails } from '@/lib/email';
import { CreditLimitError } from '@/lib/billing';
import { creditLimitResponse } from '@/lib/email';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await requireMaintenanceContext({ manage: true });
  if (isAuthError(ctx)) return ctx.error;
  const { date, digest } = await buildClubDigest(ctx.db, ctx.club, new Date());
  return NextResponse.json({ date, subject: digest.subject, html: digest.html, isEmpty: digest.isEmpty });
}

export async function POST() {
  const ctx = await requireMaintenanceContext({ manage: true });
  if (isAuthError(ctx)) return ctx.error;
  if (!ctx.user.email) return bad('Your account has no email address.');
  const { digest } = await buildClubDigest(ctx.db, ctx.club, new Date());
  try {
    const [r] = await sendBilledEmails(ctx.club.owner_id, [
      { to: ctx.user.email, subject: `[Test] ${digest.subject}`, html: digest.html },
    ]);
    if (!r?.sent) return bad('The test email did not go out — try again in a minute.', 502);
    return NextResponse.json({ ok: true, to: ctx.user.email });
  } catch (err) {
    if (err instanceof CreditLimitError) return creditLimitResponse(err);
    return bad('Could not send the test email.', 502);
  }
}

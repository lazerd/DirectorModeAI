import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { isAdminRequest } from '@/lib/adminAuth';
import { safeResendSend } from '@/lib/emailUnsubscribe';
import {
  getFlexState,
  buildNudgeRecipients,
  buildUpdateRecipients,
  updateEmailHtml,
  nudgeEmailHtml,
  FLEX_FROM,
  FLEX_REPLY_TO,
} from '@/lib/flexLeague';

export const dynamic = 'force-dynamic';

const resend = new Resend(process.env.RESEND_API_KEY);
const TEST_TO = 'darrinjco@gmail.com';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { kind, mode } = (await req.json().catch(() => ({}))) as {
    kind?: 'update' | 'nudge';
    mode?: 'preview' | 'test' | 'live';
  };
  if (kind !== 'update' && kind !== 'nudge') {
    return NextResponse.json({ error: 'bad kind' }, { status: 400 });
  }
  if (mode !== 'preview' && mode !== 'test' && mode !== 'live') {
    return NextResponse.json({ error: 'bad mode' }, { status: 400 });
  }

  const state = await getFlexState();

  // -------- UPDATE (broadcast to everyone) --------
  if (kind === 'update') {
    const recipients = await buildUpdateRecipients();
    const sample = updateEmailHtml(recipients[0]?.firstName || 'there', state);

    if (mode === 'preview') {
      return NextResponse.json({
        kind,
        count: recipients.length,
        recipients: recipients.map((r) => r.email),
        subject: sample.subject,
        sampleHtml: sample.html,
      });
    }
    if (mode === 'test') {
      const t = updateEmailHtml('Darrin', state);
      const res = await safeResendSend(resend, {
        from: FLEX_FROM,
        to: TEST_TO,
        replyTo: FLEX_REPLY_TO,
        subject: `[TEST] ${t.subject}`,
        html: t.html,
      });
      return NextResponse.json({ kind, mode, to: TEST_TO, result: res });
    }
    // live
    let sent = 0;
    const failures: { email: string; reason: string }[] = [];
    for (const r of recipients) {
      const { subject, html } = updateEmailHtml(r.firstName, state);
      const res = await safeResendSend(resend, { from: FLEX_FROM, to: r.email, replyTo: FLEX_REPLY_TO, subject, html });
      if (res.sent) sent++;
      else failures.push({ email: r.email, reason: res.reason });
      await sleep(650); // stay under Resend 2/sec
    }
    return NextResponse.json({ kind, mode, attempted: recipients.length, sent, failures });
  }

  // -------- NUDGE (personalized, only players who owe matches) --------
  const recipients = await buildNudgeRecipients();

  if (mode === 'preview') {
    const sample = recipients[0] ? nudgeEmailHtml(recipients[0], state) : null;
    return NextResponse.json({
      kind,
      count: recipients.length,
      recipients: recipients.map((r) => ({ email: r.email, outstanding: r.outstandingTotal })),
      subject: sample?.subject,
      sampleHtml: sample?.html,
      sampleFor: recipients[0]?.email,
    });
  }
  if (mode === 'test') {
    if (!recipients[0]) return NextResponse.json({ kind, mode, note: 'no players owe matches right now' });
    const { subject, html } = nudgeEmailHtml(recipients[0], state);
    const res = await safeResendSend(resend, {
      from: FLEX_FROM,
      to: TEST_TO,
      replyTo: FLEX_REPLY_TO,
      subject: `[TEST → ${recipients[0].email}] ${subject}`,
      html,
    });
    return NextResponse.json({ kind, mode, to: TEST_TO, sampleFor: recipients[0].email, result: res });
  }
  // live
  let sent = 0;
  const failures: { email: string; reason: string }[] = [];
  for (const r of recipients) {
    const { subject, html } = nudgeEmailHtml(r, state);
    const res = await safeResendSend(resend, { from: FLEX_FROM, to: r.email, replyTo: FLEX_REPLY_TO, subject, html });
    if (res.sent) sent++;
    else failures.push({ email: r.email, reason: res.reason });
    await sleep(650);
  }
  return NextResponse.json({ kind, mode, attempted: recipients.length, sent, failures });
}

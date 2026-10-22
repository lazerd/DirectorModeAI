import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/adminAuth';
import { sendBilledEmail, sendBilledEmails } from '@/lib/email';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import {
  FLEX_DIVISIONS,
  getFlexState,
  buildNudgeRecipients,
  buildUpdateRecipients,
  updateEmailHtml,
  nudgeEmailHtml,
  FLEX_FROM,
  FLEX_REPLY_TO,
} from '@/lib/flexLeague';
import { buildPlayoffRecipients, playoffEmailHtml } from '@/lib/flexPlayoffEmail';

export const dynamic = 'force-dynamic';

const TEST_TO = 'darrinjco@gmail.com';

/**
 * Who pays for flex-league mail: the owner (events.user_id) of the flex
 * division events, plus their club. Null if none is found, which sends unbilled.
 */
async function flexBilling(): Promise<{ userId: string | null; clubId: string | null }> {
  const { data } = await getSupabaseAdmin()
    .from('events')
    .select('user_id, club_id')
    .in('slug', FLEX_DIVISIONS.map((d) => d.slug))
    .not('user_id', 'is', null)
    .limit(1)
    .maybeSingle();
  const ev = data as { user_id: string | null; club_id: string | null } | null;
  return { userId: ev?.user_id ?? null, clubId: ev?.club_id ?? null };
}

/** Live broadcast: paced + retried by sendBilledEmails, tallied as before. */
async function sendAll(
  billing: { userId: string | null; clubId: string | null },
  messages: { email: string; subject: string; html: string }[]
) {
  const results = await sendBilledEmails(
    billing.userId,
    messages.map((m) => ({ from: FLEX_FROM, to: m.email, replyTo: FLEX_REPLY_TO, subject: m.subject, html: m.html, clubId: billing.clubId }))
  );
  let sent = 0;
  const failures: { email: string; reason: string }[] = [];
  results.forEach((res, i) => {
    if (res.sent) sent++;
    else failures.push({ email: messages[i].email, reason: res.reason });
  });
  return { sent, failures };
}

export async function POST(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { kind, mode, audience } = (await req.json().catch(() => ({}))) as {
    kind?: 'update' | 'nudge' | 'playoffs';
    mode?: 'preview' | 'test' | 'live';
    /** playoffs only: 'playoff' restricts to players actually IN a playoff match. */
    audience?: 'all' | 'playoff';
  };
  if (kind !== 'update' && kind !== 'nudge' && kind !== 'playoffs') {
    return NextResponse.json({ error: 'bad kind' }, { status: 400 });
  }
  if (mode !== 'preview' && mode !== 'test' && mode !== 'live') {
    return NextResponse.json({ error: 'bad mode' }, { status: 400 });
  }
  const billing = await flexBilling();

  // -------- PLAYOFFS (broadcast, personalized with each player's matchup) ----
  if (kind === 'playoffs') {
    const { recipients: everyone, snapshot } = await buildPlayoffRecipients();
    // 'playoff' = only players who actually have a playoff match to schedule.
    // Anyone whose match is already scored is excluded — there's nothing to do.
    const recipients =
      audience === 'playoff'
        ? everyone.filter((r) => r.mine.some((m) => m.info.status !== 'completed'))
        : everyone;

    if (mode === 'preview') {
      const sample = recipients[0] ? playoffEmailHtml(recipients[0], snapshot) : null;
      return NextResponse.json({
        kind,
        audience: audience || 'all',
        count: recipients.length,
        recipients: recipients.map((r) => ({ email: r.email, firstName: r.firstName, playoffMatches: r.mine.length })),
        subject: sample?.subject,
        sampleHtml: sample?.html,
        sampleFor: recipients[0]?.email,
      });
    }
    if (mode === 'test') {
      if (!recipients[0]) return NextResponse.json({ kind, mode, note: 'no playoff matches generated yet' });
      const { subject, html } = playoffEmailHtml(recipients[0], snapshot);
      const res = await sendBilledEmail(billing.userId, {
        clubId: billing.clubId,
        from: FLEX_FROM,
        to: TEST_TO,
        replyTo: FLEX_REPLY_TO,
        subject: `[TEST → ${recipients[0].email}] ${subject}`,
        html,
      });
      return NextResponse.json({ kind, mode, to: TEST_TO, sampleFor: recipients[0].email, result: res });
    }
    const { sent, failures } = await sendAll(
      billing,
      recipients.map((r) => ({ email: r.email, ...playoffEmailHtml(r, snapshot) }))
    );
    return NextResponse.json({ kind, mode, audience: audience || 'all', attempted: recipients.length, sent, failures });
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
      const res = await sendBilledEmail(billing.userId, {
        clubId: billing.clubId,
        from: FLEX_FROM,
        to: TEST_TO,
        replyTo: FLEX_REPLY_TO,
        subject: `[TEST] ${t.subject}`,
        html: t.html,
      });
      return NextResponse.json({ kind, mode, to: TEST_TO, result: res });
    }
    // live
    const { sent, failures } = await sendAll(
      billing,
      recipients.map((r) => ({ email: r.email, ...updateEmailHtml(r.firstName, state) }))
    );
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
    const res = await sendBilledEmail(billing.userId, {
      clubId: billing.clubId,
      from: FLEX_FROM,
      to: TEST_TO,
      replyTo: FLEX_REPLY_TO,
      subject: `[TEST → ${recipients[0].email}] ${subject}`,
      html,
    });
    return NextResponse.json({ kind, mode, to: TEST_TO, sampleFor: recipients[0].email, result: res });
  }
  // live
  const { sent, failures } = await sendAll(
    billing,
    recipients.map((r) => ({ email: r.email, ...nudgeEmailHtml(r, state) }))
  );
  return NextResponse.json({ kind, mode, attempted: recipients.length, sent, failures });
}

/**
 * POST /api/webhooks/resend — bounces and complaints.
 *
 * The app had no Resend webhook before this. Cold mail is the thing that
 * makes one necessary: a bounce on a transactional email is a support ticket,
 * a bounce on a cold email is a reputation problem, and 729 addresses scraped
 * out of a members-only directory in June will contain dead ones.
 *
 * Two events act:
 *   email.bounced     hard bounce → suppress the ADDRESS forever.
 *                     A soft bounce (mailbox full, greylisted) is not the
 *                     address's fault and is ignored.
 *   email.complained  they hit "spam" → suppress the address AND the club,
 *                     and add a global unsubscribe. A complaint is the
 *                     strongest possible "never again", and it must cover
 *                     every email this app sends, not only the deck.
 *
 * SIGNATURE: Resend signs with Svix. Without RESEND_WEBHOOK_SECRET set this
 * route refuses everything — an unauthenticated endpoint that writes to a
 * suppression list is a way for a stranger to delete our pipeline.
 */
import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { recordUnsubscribe } from '@/lib/emailUnsubscribe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Svix: HMAC-SHA256 over "<id>.<timestamp>.<body>" with the base64 secret,
 * compared against any of the space-separated "v1,<sig>" values.
 */
function verify(raw: string, headers: Headers): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET || '';
  if (!secret) return false;
  const id = headers.get('svix-id');
  const ts = headers.get('svix-timestamp');
  const sigHeader = headers.get('svix-signature');
  if (!id || !ts || !sigHeader) return false;

  // Five minutes, so a captured request cannot be replayed tomorrow.
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > 300) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = crypto.createHmac('sha256', key).update(`${id}.${ts}.${raw}`).digest('base64');
  return sigHeader
    .split(' ')
    .map((part) => part.split(',')[1])
    .filter(Boolean)
    .some((sig) => sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)));
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verify(raw, req.headers)) {
    return NextResponse.json({ error: 'bad_signature' }, { status: 400 });
  }

  let payload: {
    type?: string;
    data?: { email_id?: string; to?: string[] | string; bounce?: { type?: string; subType?: string } };
  };
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }

  const type = payload.type ?? '';
  if (type !== 'email.bounced' && type !== 'email.complained') {
    return NextResponse.json({ ok: true, ignored: type });
  }

  const to = Array.isArray(payload.data?.to) ? payload.data?.to?.[0] : payload.data?.to;
  const email = (to ?? '').toLowerCase().trim();
  if (!email) return NextResponse.json({ ok: true, ignored: 'no_recipient' });

  // A soft bounce is a full mailbox or a bad afternoon, not a dead address.
  const bounceType = (payload.data?.bounce?.type ?? '').toLowerCase();
  if (type === 'email.bounced' && bounceType && bounceType !== 'hard' && bounceType !== 'permanent') {
    return NextResponse.json({ ok: true, ignored: `soft_bounce:${bounceType}` });
  }

  const db = getSupabaseAdmin();

  // Which club, if we know. Suppressing the org too is right for a complaint
  // and wrong for a bounce: one dead address does not mean the club is a no.
  const { data: contact } = await db
    .from('crm_contacts')
    .select('id, org_id')
    .ilike('email', email)
    .limit(1)
    .maybeSingle();
  const orgId = (contact as { org_id?: string } | null)?.org_id ?? null;

  const complaint = type === 'email.complained';
  await db.from('crm_outreach_suppression').insert({
    email,
    org_id: complaint ? orgId : null,
    reason: complaint ? 'complaint' : 'bounced',
    note: `Resend ${type}${bounceType ? ` (${bounceType})` : ''}`,
  });

  if (complaint) {
    // Global, not just the deck: someone who marked us as spam must not get a
    // league reminder from us next week either.
    await recordUnsubscribe(email);
  }

  // Any approved card still waiting for this address is now unsendable. The
  // sender re-checks suppression anyway; this just keeps the deck honest.
  if (contact) {
    await db
      .from('crm_outreach_queue')
      .update({ status: 'failed', detail: `resend:${type}` })
      .eq('contact_id', (contact as { id: string }).id)
      .in('status', ['planned', 'approved']);
  }

  return NextResponse.json({ ok: true, suppressed: email, org_suppressed: complaint && !!orgId });
}

/**
 * The write half of /unsubscribe. POST only.
 *
 * The page used to opt someone out on a plain GET: visiting the footer link was
 * enough. That meant any mail-security scanner, link preview or prefetch that
 * followed the link could unsubscribe the recipient without a human ever
 * touching it — which is exactly what happened to darrinjco@gmail.com on
 * 2026-09-08, silencing eight days of his own captain alerts. A GET must never
 * change anything; the page now shows a button that posts here.
 *
 * No auth: the signed token in the form is the credential, same as before.
 */
import { NextResponse } from 'next/server';
import { recordUnsubscribe, removeUnsubscribe, verifyUnsubscribeToken } from '@/lib/emailUnsubscribe';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const token = String(form?.get('token') || '');
  const resubscribe = form?.get('action') === 'resubscribe';
  const payload = token ? verifyUnsubscribeToken(token) : null;

  const to = new URL(req.url);
  to.pathname = '/unsubscribe';
  to.search = '';
  if (token) to.searchParams.set('token', token);

  if (!payload) {
    to.searchParams.set('state', 'invalid-token');
    return NextResponse.redirect(to, 303);
  }

  const result = resubscribe
    ? await removeUnsubscribe(payload.email, payload.scope)
    : await recordUnsubscribe(payload.email, payload.scope);

  if (!result.success) {
    to.searchParams.set('state', 'error');
    to.searchParams.set('m', result.error || 'Could not save that.');
    return NextResponse.redirect(to, 303);
  }

  to.searchParams.set('state', resubscribe ? 'resubscribed' : 'unsubscribed');
  return NextResponse.redirect(to, 303);
}

/**
 * POST /api/unsubscribe/one-click?token=… — the machine end of unsubscribing.
 *
 * This is the URL in the List-Unsubscribe header (RFC 8058). Gmail and Yahoo
 * show their own "Unsubscribe" button next to the sender's name, and when it is
 * pressed THEY post here — no browser, no page, no human. Bulk senders without
 * this are filtered harder, which is most of why a club's first blast lands in
 * spam with clean SPF and DKIM.
 *
 * Deliberately separate from /api/unsubscribe, which serves the footer link and
 * answers a form post with a redirect to a page. A provider wants a status
 * code, and it sends `List-Unsubscribe=One-Click` as the body rather than our
 * token, so the token has to travel in the URL.
 *
 * POST ONLY. There is no GET handler and there must never be one: a link
 * scanner following this URL would opt the recipient out without anybody
 * touching it, which is exactly how darrinjco@gmail.com lost eight days of his
 * own captain alerts on 2026-09-08.
 */
import { NextResponse } from 'next/server';
import { recordUnsubscribe, verifyUnsubscribeToken } from '@/lib/emailUnsubscribe';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const token = new URL(req.url).searchParams.get('token') || '';
  const payload = token ? verifyUnsubscribeToken(token) : null;

  // A provider is not a person: it gets a status code, not an explanation.
  if (!payload) return new NextResponse('Invalid token', { status: 400 });

  const result = await recordUnsubscribe(payload.email, payload.scope);
  if (!result.success) {
    console.error('[unsubscribe/one-click]', payload.email, result.error);
    // 500 rather than a quiet 200: a provider that is told the opt-out
    // succeeded will not retry, and the person would keep getting mail.
    return new NextResponse('Could not record that', { status: 500 });
  }

  return new NextResponse('Unsubscribed', { status: 200 });
}

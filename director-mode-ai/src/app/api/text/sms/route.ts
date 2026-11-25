/**
 * Twilio inbound SMS webhook: a director texting their staff.
 * Set as the Messaging Service's inbound URL: https://clubmode.ai/api/text/sms
 * The reply goes out through the REST API (the staff can take longer than Twilio's
 * 15-second webhook window), so this answers with empty TwiML.
 */
import { NextResponse } from 'next/server';
import twilio from 'twilio';
import { handleInbound } from '@/lib/textstaff/inbound';
import { toE164US } from '@/lib/smsConsent';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const EMPTY = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
const twiml = () => new NextResponse(EMPTY, { headers: { 'content-type': 'text/xml' } });

export async function POST(req: Request) {
  const raw = await req.text();
  const params = Object.fromEntries(new URLSearchParams(raw));
  const token = process.env.TWILIO_AUTH_TOKEN;
  const sig = req.headers.get('x-twilio-signature') || '';
  const host = req.headers.get('x-forwarded-host') || new URL(req.url).host;
  const url = `https://${host}${new URL(req.url).pathname}`;
  if (!token || !twilio.validateRequest(token, sig, url, params)) {
    return new NextResponse('forbidden', { status: 403 });
  }
  const from = toE164US(params.From || '') || params.From;
  if (!from) return twiml();
  try {
    await handleInbound({
      channel: 'sms',
      address: from,
      body: params.Body || '',
      providerId: params.MessageSid,
      hasMedia: Number(params.NumMedia || 0) > 0,
    });
  } catch (e) {
    console.error('text staff sms inbound failed', e);
  }
  return twiml();
}

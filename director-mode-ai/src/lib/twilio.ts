import twilio from 'twilio';
import { consumeSmsCredits, CreditLimitError } from '@/lib/billing';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_PHONE_NUMBER;

let client: ReturnType<typeof twilio> | null = null;
function getClient() {
  if (!accountSid || !authToken) {
    throw new Error('Twilio not configured (set TWILIO_ACCOUNT_SID & TWILIO_AUTH_TOKEN)');
  }
  if (!client) client = twilio(accountSid, authToken);
  return client;
}

export interface SmsResult {
  to: string;
  status: 'sent' | 'skipped' | 'failed';
  reason?: string;
  sid?: string;
}

function normalize(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, '');
  if (!digits) return null;
  if (digits.startsWith('+')) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits.startsWith('+') ? digits : `+${digits}`;
}

export async function sendSms(userId: string, to: string, body: string): Promise<SmsResult> {
  const number = normalize(to);
  if (!number) return { to, status: 'skipped', reason: 'invalid_number' };
  try {
    await consumeSmsCredits(userId, 1);
  } catch (err) {
    if (err instanceof CreditLimitError) throw err;
    throw err;
  }
  if (!fromNumber) {
    throw new Error('TWILIO_PHONE_NUMBER not set');
  }
  try {
    const msg = await getClient().messages.create({
      body,
      from: fromNumber,
      to: number,
    });
    return { to: number, status: 'sent', sid: msg.sid };
  } catch (err: any) {
    return { to: number, status: 'failed', reason: err?.message };
  }
}

export async function sendSmsBatch(userId: string, recipients: { phone: string; body: string }[]): Promise<{
  sent: number;
  skipped: number;
  failed: number;
  overageCents: number;
  results: SmsResult[];
}> {
  const valid = recipients
    .map((r) => ({ ...r, normalized: normalize(r.phone) }))
    .filter((r) => r.normalized !== null) as Array<{ phone: string; body: string; normalized: string }>;

  if (valid.length === 0) {
    return { sent: 0, skipped: recipients.length, failed: 0, overageCents: 0, results: [] };
  }

  const { overageCents } = await consumeSmsCredits(userId, valid.length);

  if (!fromNumber) {
    throw new Error('TWILIO_PHONE_NUMBER not set');
  }
  const c = getClient();
  const results: SmsResult[] = await Promise.all(
    valid.map(async (r) => {
      try {
        const msg = await c.messages.create({ body: r.body, from: fromNumber, to: r.normalized });
        return { to: r.normalized, status: 'sent' as const, sid: msg.sid };
      } catch (err: any) {
        return { to: r.normalized, status: 'failed' as const, reason: err?.message };
      }
    })
  );
  const skipped = recipients.length - valid.length;
  const sent = results.filter((r) => r.status === 'sent').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  return { sent, skipped, failed, overageCents, results };
}

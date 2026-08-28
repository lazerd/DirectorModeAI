import twilio from 'twilio';
import { consumeSmsCredits, CreditLimitError } from '@/lib/billing';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_PHONE_NUMBER;

/**
 * Send through the Messaging Service, not the bare number.
 *
 * US A2P 10DLC registration attaches to the SERVICE. Traffic sent with a plain
 * `from` number is unregistered traffic as far as the carriers are concerned
 * and gets filtered with error 30034 — the campaign being approved changes
 * nothing about that. This is the switch that makes an approved campaign
 * actually apply, and the failure mode without it is silent: Twilio accepts the
 * message, the carrier drops it.
 *
 * Falls back to `from` when unset so a deployment without the service
 * configured still behaves exactly as it did before.
 */
const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

/** Whichever sender this deployment is configured for, service first. */
function sender(): { messagingServiceSid: string } | { from: string } {
  if (messagingServiceSid) return { messagingServiceSid };
  if (!fromNumber) {
    throw new Error(
      'No SMS sender configured — set TWILIO_MESSAGING_SERVICE_SID (preferred) or TWILIO_PHONE_NUMBER.',
    );
  }
  return { from: fromNumber };
}

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

/**
 * Twilio failure codes in plain English.
 *
 * Worth the table because the two that actually happen in production say
 * nothing useful on their own. 30034 in particular is not a bug in this app and
 * no amount of retrying fixes it: US carriers reject application-to-person
 * traffic from an unregistered 10-digit number, so the number has to be
 * attached to a registered A2P brand and campaign before a single text lands.
 */
const SMS_ERRORS: Record<number, string> = {
  30034:
    'Blocked by the carrier: this number is not registered for A2P 10DLC. Register a brand and campaign in Twilio (Messaging → Regulatory Compliance) and attach the number — until then US carriers reject every text.',
  30032: 'Blocked by the carrier: this Twilio number is not permitted to send to that destination.',
  30007: 'Filtered as spam by the carrier. Shorten the message and drop any link.',
  30003: 'That handset is unreachable — off, out of coverage, or the number is dead.',
  30005: 'That number does not exist on any carrier.',
  30006: 'That is a landline, or the carrier cannot receive texts on it.',
  21610: 'They replied STOP to this number, so Twilio will not deliver to them. Only they can undo it by texting START.',
  21614: 'That is not a mobile number.',
  21211: 'That phone number is not valid.',
  21608:
    'The Twilio account is still on trial, which can only text verified numbers. Upgrade the account or verify this number first.',
};

/** Plain-English reason for a Twilio error code, falling back to Twilio's own text. */
export function describeSmsError(code: number | null | undefined, fallback?: string | null): string {
  if (code && SMS_ERRORS[code]) return SMS_ERRORS[code];
  if (code) return `${fallback || 'Carrier rejected the message'} (Twilio error ${code}).`;
  return fallback || 'The carrier rejected the message.';
}

export type SmsDelivery = {
  sid: string;
  to: string;
  status: string;
  errorCode: number | null;
  reason: string | null;
};

/**
 * Re-read what actually happened to a batch of messages.
 *
 * `messages.create` only ever says "queued" — carrier rejections (an
 * unregistered 10DLC number, a STOP list, a dead handset) come back
 * asynchronously seconds later. Without this the app would tell a captain their
 * text was sent every single time, including the times it was never delivered.
 */
export async function checkSmsDelivery(sids: string[]): Promise<SmsDelivery[]> {
  if (!sids.length) return [];
  const c = getClient();
  return Promise.all(
    sids.map(async (sid) => {
      try {
        const m = await c.messages(sid).fetch();
        const code = (m.errorCode as number | null) ?? null;
        return {
          sid,
          to: m.to,
          status: m.status,
          errorCode: code,
          reason: code ? describeSmsError(code, m.errorMessage) : null,
        };
      } catch (err) {
        return {
          sid,
          to: '',
          status: 'unknown',
          errorCode: null,
          reason: (err as Error)?.message ?? 'Could not read the delivery status.',
        };
      }
    }),
  );
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
  try {
    const msg = await getClient().messages.create({
      body,
      ...sender(),
      to: number,
    });
    return { to: number, status: 'sent', sid: msg.sid };
  } catch (err: any) {
    return { to: number, status: 'failed', reason: describeSmsError(err?.code, err?.message) };
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

  const from = sender();
  const c = getClient();
  const results: SmsResult[] = await Promise.all(
    valid.map(async (r) => {
      try {
        const msg = await c.messages.create({ body: r.body, ...from, to: r.normalized });
        return { to: r.normalized, status: 'sent' as const, sid: msg.sid };
      } catch (err: any) {
        return {
          to: r.normalized,
          status: 'failed' as const,
          reason: describeSmsError(err?.code, err?.message),
        };
      }
    })
  );
  const skipped = recipients.length - valid.length;
  const sent = results.filter((r) => r.status === 'sent').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  return { sent, skipped, failed, overageCents, results };
}

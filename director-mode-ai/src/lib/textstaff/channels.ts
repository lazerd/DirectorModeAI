import { createHash } from 'crypto';
import { sendSms } from '@/lib/twilio';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

/*
 * The two ways a director's staff reach their phone.
 *
 *   sms       Real text messages, through ClubMode's Twilio number. Needs the A2P
 *             10DLC campaign approved before US carriers deliver anything.
 *   telegram  A Telegram bot. Free, two-way, no carrier registration, so it works
 *             the day it's set up. The director installs Telegram once.
 *
 * Everything above this file (huddles, replies, the staff) is the same for both.
 */

export type Channel = 'sms' | 'telegram';

/** SMS is ClubMode's number; one long code serves every club (the message names the club). */
export const SMS_NUMBER = process.env.TWILIO_PHONE_NUMBER || '+18166846936';
export const smsNumberLabel = () => {
  const d = SMS_NUMBER.replace(/\D/g, '').slice(-10);
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
};

const TG_TOKEN = () => process.env.TELEGRAM_BOT_TOKEN || '';
export const telegramReady = () => !!TG_TOKEN() && !!process.env.TELEGRAM_BOT_USERNAME;
export const telegramBot = () => process.env.TELEGRAM_BOT_USERNAME || '';
/** The secret Telegram echoes on every webhook call, derived from the bot token. */
export const telegramWebhookSecret = () => createHash('sha256').update(`tg-webhook:${TG_TOKEN()}`).digest('hex').slice(0, 48);

const SMS_MAX = 1500; // ~10 segments; carriers stitch them back together
const TG_MAX = 3900;

export interface SendResult { ok: boolean; id?: string; error?: string }

/** Send one message to an address. Logs it. `userId` is who pays (texts are metered). */
export async function sendTo(
  channel: Channel,
  address: string,
  body: string,
  opts: { userId?: string | null; lineId?: string | null; kind?: string } = {},
): Promise<SendResult> {
  const text = body.trim();
  if (!text) return { ok: true };
  let res: SendResult;
  try {
    if (channel === 'telegram') res = await sendTelegram(address, text);
    else res = await sendSmsMsg(opts.userId ?? null, address, text);
  } catch (e) {
    res = { ok: false, error: (e as Error).message };
  }
  await getSupabaseAdmin().from('text_messages').insert({
    line_id: opts.lineId ?? null, channel, address, direction: 'out', body: text.slice(0, 4000),
    kind: opts.kind ?? 'reply', provider_id: res.id ?? null, status: res.ok ? 'sent' : 'failed', error: res.error ?? null,
  });
  return res;
}

async function sendSmsMsg(userId: string | null, to: string, body: string): Promise<SendResult> {
  if (!userId) return { ok: false, error: 'no payer for this text' };
  const r = await sendSms(userId, to, body.length > SMS_MAX ? body.slice(0, SMS_MAX - 1) + '…' : body);
  return r.status === 'sent' ? { ok: true, id: r.sid } : { ok: false, error: r.reason || r.status };
}

async function sendTelegram(chatId: string, body: string): Promise<SendResult> {
  if (!TG_TOKEN()) return { ok: false, error: 'Telegram is not set up (TELEGRAM_BOT_TOKEN).' };
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN()}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: body.slice(0, TG_MAX), disable_web_page_preview: true }),
  });
  const j = (await res.json().catch(() => null)) as { ok?: boolean; result?: { message_id?: number }; description?: string } | null;
  return j?.ok ? { ok: true, id: String(j.result?.message_id ?? '') } : { ok: false, error: j?.description || `telegram ${res.status}` };
}

/** "Typing…" while the staff think (Telegram only; SMS has no such thing). */
export async function showTyping(channel: Channel, address: string) {
  if (channel !== 'telegram' || !TG_TOKEN()) return;
  await fetch(`https://api.telegram.org/bot${TG_TOKEN()}/sendChatAction`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: address, action: 'typing' }),
  }).catch(() => {});
}

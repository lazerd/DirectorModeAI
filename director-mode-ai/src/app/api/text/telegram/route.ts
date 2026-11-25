/**
 * Telegram bot webhook: a director messaging their staff on Telegram.
 * Registered by POST /api/text/telegram/setup (owner only) with a secret token
 * Telegram echoes back on every call.
 */
import { NextResponse } from 'next/server';
import { handleInbound } from '@/lib/textstaff/inbound';
import { telegramWebhookSecret } from '@/lib/textstaff/channels';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: Request) {
  if (!process.env.TELEGRAM_BOT_TOKEN || req.headers.get('x-telegram-bot-api-secret-token') !== telegramWebhookSecret()) {
    return new NextResponse('forbidden', { status: 403 });
  }
  const u = await req.json().catch(() => null);
  const m = u?.message;
  // Private chats only: a bot added to a group must never answer the group.
  if (!m || m.chat?.type !== 'private') return NextResponse.json({ ok: true });
  const text = String(m.text ?? m.caption ?? '').trim();
  try {
    await handleInbound({
      channel: 'telegram',
      address: String(m.chat.id),
      body: text === '/start' ? 'help' : text,
      providerId: String(u.update_id),
      hasMedia: !!(m.photo || m.document || m.voice),
      media: Array.isArray(m.photo) && m.photo.length
        ? [{ telegramFileId: String(m.photo[m.photo.length - 1].file_id), type: 'image/jpeg' }]
        : m.document && /^image\//.test(String(m.document.mime_type || '')) ? [{ telegramFileId: String(m.document.file_id), type: String(m.document.mime_type) }] : [],
    });
  } catch (e) {
    console.error('text staff telegram inbound failed', e);
  }
  return NextResponse.json({ ok: true });
}

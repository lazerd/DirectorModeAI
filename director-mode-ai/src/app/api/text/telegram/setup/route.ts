/**
 * POST: point the Telegram bot's webhook at this deployment (platform owner only).
 * Run once after TELEGRAM_BOT_TOKEN / TELEGRAM_BOT_USERNAME are set.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isPlatformOwnerEmail } from '@/lib/platformOwner';
import { telegramWebhookSecret } from '@/lib/textstaff/channels';
import { APP_URL } from '@/lib/appUrl';

export const dynamic = 'force-dynamic';

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isPlatformOwnerEmail(user.email)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ error: 'Set TELEGRAM_BOT_TOKEN first.' }, { status: 400 });
  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: `${APP_URL}/api/text/telegram`,
      secret_token: telegramWebhookSecret(),
      allowed_updates: ['message'],
      drop_pending_updates: true,
    }),
  });
  return NextResponse.json(await res.json().catch(() => ({ ok: false })));
}

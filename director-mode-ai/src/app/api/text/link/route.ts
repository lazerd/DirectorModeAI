/**
 * The director's staff lines (/text page).
 *   GET                                    their lines + what's available
 *   POST { channel:'sms', agreed:true }    a JOIN code to text in from their phone
 *   POST { channel:'telegram' }            a t.me link that connects their chat
 *   PATCH { channel, morning?, evening? }  scheduled texts on/off
 *   DELETE ?channel=sms|telegram           disconnect
 * The phone or chat proves itself by sending the code IN, so nothing is texted to a
 * number until its owner has messaged us from it.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveClubCtx } from '@/lib/assistant/clubContext';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { SMS_NUMBER, smsNumberLabel, telegramBot, telegramReady, type Channel } from '@/lib/textstaff/channels';
import { newSmsCode, newTelegramCode } from '@/lib/textstaff/inbound';
import { STAFF_TEXT_CONSENT } from '@/lib/smsConsent';

export const dynamic = 'force-dynamic';

async function caller() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const ctx = await resolveClubCtx(user.id);
  return ctx ? { user, ctx } : null;
}
const isChannel = (c: unknown): c is Channel => c === 'sms' || c === 'telegram';
const mask = (ch: string, a: string | null) => (!a ? null : ch === 'sms' ? `(•••) •••-${a.slice(-4)}` : 'your Telegram');

export async function GET() {
  const c = await caller();
  if (!c) {
    // Signed in but no club yet (a brand-new director straight from sign-up): send them to
    // club setup, not back to a sign-in button they've already passed.
    const { data: { user } } = await (await createClient()).auth.getUser();
    if (user) return NextResponse.json({ error: 'Set up your club first.', needsClub: true }, { status: 403 });
    return NextResponse.json({ error: 'Sign in as a club director.' }, { status: 401 });
  }
  const { data } = await getSupabaseAdmin()
    .from('text_lines')
    .select('channel, status, address, morning, evening, verified_at, club_id')
    .eq('user_id', c.user.id);
  return NextResponse.json({
    club: c.ctx.clubName,
    smsNumber: smsNumberLabel(),
    telegram: telegramReady() ? telegramBot() : null,
    consent: STAFF_TEXT_CONSENT,
    lines: ((data as any[] | null) ?? []).map((l) => ({
      channel: l.channel, status: l.status, to: mask(l.channel, l.address), morning: l.morning, evening: l.evening,
      otherClub: l.club_id !== c.ctx.clubId,
    })),
  });
}

async function uniqueCode(channel: Channel): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = channel === 'sms' ? newSmsCode() : newTelegramCode();
    const { count } = await getSupabaseAdmin().from('text_lines').select('id', { count: 'exact', head: true }).eq('link_code', code);
    if (!count) return code;
  }
  throw new Error('no code');
}

export async function POST(req: Request) {
  const c = await caller();
  if (!c) return NextResponse.json({ error: 'Sign in as a club director.' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const channel = body?.channel;
  if (!isChannel(channel)) return NextResponse.json({ error: 'Pick text or Telegram.' }, { status: 400 });
  if (channel === 'sms' && body?.agreed !== true) return NextResponse.json({ error: 'Check the box to agree to texts.' }, { status: 400 });
  if (channel === 'telegram' && !telegramReady()) return NextResponse.json({ error: 'Telegram is not set up yet.' }, { status: 503 });
  const code = await uniqueCode(channel);
  const db = getSupabaseAdmin();
  const row = {
    user_id: c.user.id,
    club_id: c.ctx.clubId,
    channel,
    link_code: code,
    link_expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    ...(channel === 'sms'
      ? { consent_text: STAFF_TEXT_CONSENT, consent_ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null }
      : {}),
    updated_at: new Date().toISOString(),
  };
  const { data: existing } = await db.from('text_lines').select('id').eq('user_id', c.user.id).eq('channel', channel).maybeSingle();
  const { error } = existing
    ? await db.from('text_lines').update(row).eq('id', (existing as any).id)
    : await db.from('text_lines').insert({ ...row, status: 'pending' });
  if (error) return NextResponse.json({ error: "Couldn't start that. Try again." }, { status: 500 });
  if (channel === 'sms') {
    return NextResponse.json({ code, number: smsNumberLabel(), href: `sms:${SMS_NUMBER}?&body=${encodeURIComponent(`JOIN ${code}`)}` });
  }
  return NextResponse.json({ code, href: `https://t.me/${telegramBot()}?start=${code}` });
}

export async function PATCH(req: Request) {
  const c = await caller();
  if (!c) return NextResponse.json({ error: 'Sign in as a club director.' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!isChannel(body?.channel)) return NextResponse.json({ error: 'Which line?' }, { status: 400 });
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.morning === 'boolean') patch.morning = body.morning;
  if (typeof body.evening === 'boolean') patch.evening = body.evening;
  if (body.club === 'this') patch.club_id = c.ctx.clubId;
  await getSupabaseAdmin().from('text_lines').update(patch).eq('user_id', c.user.id).eq('channel', body.channel);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const c = await caller();
  if (!c) return NextResponse.json({ error: 'Sign in as a club director.' }, { status: 401 });
  const channel = new URL(req.url).searchParams.get('channel');
  if (!isChannel(channel)) return NextResponse.json({ error: 'Which line?' }, { status: 400 });
  await getSupabaseAdmin()
    .from('text_lines')
    .update({ status: 'stopped', address: null, stopped_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('user_id', c.user.id)
    .eq('channel', channel);
  return NextResponse.json({ ok: true });
}

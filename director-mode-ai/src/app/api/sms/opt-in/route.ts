/**
 * POST /api/sms/opt-in — public. Records an SMS consent from the /sms form.
 * Body: { name, phone, email?, club_or_team?, agreed: true }
 */
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { SMS_CONSENT_TEXT, toE164US } from '@/lib/smsConsent';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
  const phone = typeof body.phone === 'string' ? toE164US(body.phone) : null;
  const email = typeof body.email === 'string' ? body.email.trim().slice(0, 200) || null : null;
  const clubOrTeam =
    typeof body.club_or_team === 'string' ? body.club_or_team.trim().slice(0, 120) || null : null;

  if (body.agreed !== true) {
    return NextResponse.json({ error: 'Please check the box to agree to receive texts.' }, { status: 400 });
  }
  if (!name) return NextResponse.json({ error: 'Please enter your name.' }, { status: 400 });
  if (!phone) {
    return NextResponse.json({ error: 'Please enter a 10-digit US mobile number.' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { error } = await admin.from('sms_consents').insert({
    phone_e164: phone,
    name,
    email,
    club_or_team: clubOrTeam,
    consent_text: SMS_CONSENT_TEXT,
    source: 'web:/sms',
    ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
    user_agent: request.headers.get('user-agent')?.slice(0, 300) || null,
  });
  if (error) {
    console.error('sms opt-in insert failed:', error);
    return NextResponse.json({ error: 'Could not save. Please try again.' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

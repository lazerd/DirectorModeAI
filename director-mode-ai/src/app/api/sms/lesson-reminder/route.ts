import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sendSms } from '@/lib/twilio';
import { getPlanContext, CreditLimitError } from '@/lib/billing';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const ctx = await getPlanContext(user.id);
    if (ctx.effectiveTier === 'free') {
      return NextResponse.json(
        { error: 'sms_locked', message: 'SMS lesson reminders require Pro.', upgradeUrl: '/pricing' },
        { status: 402 }
      );
    }

    const { phone, clientName, coachName, slotDate, slotTime } = await request.json();
    if (!phone) return NextResponse.json({ error: 'phone_required' }, { status: 400 });

    const body = `🎾 Reminder: ${clientName || 'You'}, lesson with ${coachName || 'your coach'} ${slotDate || 'tomorrow'} at ${slotTime}.`;
    const result = await sendSms(user.id, phone, body);
    return NextResponse.json(result);
  } catch (err: any) {
    if (err instanceof CreditLimitError) {
      return NextResponse.json(
        { error: 'credit_limit', kind: err.kind, tier: err.tier, limit: err.limit, message: err.message, upgradeUrl: '/pricing' },
        { status: 402 }
      );
    }
    console.error('[sms/lesson-reminder]', err);
    return NextResponse.json({ error: 'sms_failed', message: err?.message }, { status: 500 });
  }
}

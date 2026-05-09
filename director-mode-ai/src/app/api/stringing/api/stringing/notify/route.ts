import { NextRequest, NextResponse } from 'next/server';
import { sendBilledEmail, creditLimitResponse, CreditLimitError } from '@/lib/email';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const { to, customerName, racketInfo, stringInfo, tension } = await request.json();

    if (!to) {
      return NextResponse.json({ error: 'Email address required' }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const ownerUserId = user?.id || null;

    const { data, error } = await sendBilledEmail(ownerUserId, {
      from: 'StringingMode <notifications@coachmode.ai>',
      to: [to] as any,
      subject: '🎾 Your Racket is Ready for Pickup!',
      html: `
        <!DOCTYPE html>
        <html>
        <body style="font-family: -apple-system, sans-serif;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #9333ea 0%, #c084fc 100%); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
              <h1 style="margin: 0; font-size: 24px;">🎾 Your Racket is Ready!</h1>
            </div>
            <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 12px 12px;">
              <p>Hi ${customerName || 'there'},</p>
              <p>Great news! Your racket has been strung and is ready for pickup.</p>
              <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <p><strong>Racket:</strong> ${racketInfo || 'N/A'}</p>
                <p><strong>String:</strong> ${stringInfo || 'N/A'}</p>
                <p><strong>Tension:</strong> ${tension || 'N/A'}</p>
              </div>
              <p>Stop by anytime during business hours to pick it up.</p>
              <p style="color: #9333ea; font-weight: 600; text-align: center;">StringingMode</p>
            </div>
          </div>
        </body>
        </html>
      `,
    });

    if (error) {
      console.error('Resend error:', error);
      return NextResponse.json({ error: (error as any).message }, { status: 500 });
    }

    return NextResponse.json({ success: true, id: (data as any)?.id });
  } catch (err: any) {
    if (err instanceof CreditLimitError) return creditLimitResponse(err);
    console.error('Email error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

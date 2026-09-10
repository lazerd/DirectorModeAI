import { NextRequest, NextResponse } from 'next/server';
import { sendBilledEmail, creditLimitResponse, CreditLimitError } from '@/lib/email';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { primaryClubFor } from '@/lib/clubs/primaryClub';

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

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

    // The customer knows the club, not our product — sign the email as the
    // stringer's club when we can tell which one that is.
    const club = ownerUserId ? await primaryClubFor(getSupabaseAdmin(), ownerUserId).catch(() => null) : null;
    const shopName = club?.name?.trim() || '';
    const fromName = shopName.replace(/[<>",]/g, '') || 'StringingMode';
    const signature = shopName ? escapeHtml(shopName) : 'StringingMode';

    const result = await sendBilledEmail(ownerUserId, {
      from: `${fromName} <noreply@mail.clubmode.ai>`,
      to,
      subject: shopName ? `🎾 Your racket is ready for pickup at ${shopName}` : '🎾 Your Racket is Ready for Pickup!',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #9333ea 0%, #c084fc 100%); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 12px 12px; }
            .details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
            .detail-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; }
            .detail-row:last-child { border-bottom: none; }
            .label { color: #666; }
            .value { font-weight: 600; }
            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0; font-size: 24px;">🎾 Your Racket is Ready!</h1>
            </div>
            <div class="content">
              <p>Hi ${customerName || 'there'},</p>
              <p>Great news! Your racket has been strung and is ready for pickup.</p>

              <div class="details">
                <div class="detail-row">
                  <span class="label">Racket</span>
                  <span class="value">${racketInfo || 'N/A'}</span>
                </div>
                <div class="detail-row">
                  <span class="label">String</span>
                  <span class="value">${stringInfo || 'N/A'}</span>
                </div>
                <div class="detail-row">
                  <span class="label">Tension</span>
                  <span class="value">${tension || 'N/A'}</span>
                </div>
              </div>

              <p>Stop by anytime during business hours to pick it up. We look forward to seeing you!</p>

              <div class="footer">
                <p>Thanks for choosing us for your stringing needs!</p>
                <p style="color: #9333ea; font-weight: 600;">${signature}</p>
              </div>
            </div>
          </div>
        </body>
        </html>
      `,
    });

    if (!result.sent) {
      console.error('Send failed:', result.reason, (result as any).error);
      return NextResponse.json({ error: (result as any).error || result.reason }, { status: 500 });
    }

    return NextResponse.json({ success: true, id: result.messageId });
  } catch (err: any) {
    if (err instanceof CreditLimitError) return creditLimitResponse(err);
    console.error('Email error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { sendBilledEmail, creditLimitResponse, CreditLimitError } from '@/lib/email';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { esc, isLinked, loadCoach, loadMyClient, sessionUserId } from '@/lib/lessons/notify';

import { APP_URL } from '@/lib/appUrl';

/**
 * POST { coachId, message? } — tell a coach the signed-in client just asked to
 * join them. Sent only when that request (a pending lesson_client_coaches row)
 * exists; the coach's address and the client's name come from the database.
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await sessionUserId();
    if (!userId) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

    const { coachId, message } = await request.json().catch(() => ({}));
    if (!coachId || typeof coachId !== 'string') {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const db = getSupabaseAdmin();
    const client = await loadMyClient(db, userId);
    const coach = await loadCoach(db, coachId);
    if (!client || !coach || !(await isLinked(db, client.id, coach.id, 'pending'))) {
      return NextResponse.json({ error: 'No pending request to this coach.' }, { status: 403 });
    }
    if (!coach.email) return NextResponse.json({ success: true, emailed: false });

    const clientName = esc(client.name || client.email || 'A client');
    const note = typeof message === 'string' ? message.trim().slice(0, 2000) : '';

    await sendBilledEmail(coach.profile_id, {
      from: 'LessonMode <noreply@mail.clubmode.ai>',
      to: coach.email,
      subject: `New Client Request: ${client.name || 'A client'} wants to book lessons`,
      clubId: coach.club_id,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">New Client Request! 👋</h2>
          <p>Hi ${esc(coach.display_name || 'Coach')},</p>
          <p><strong>${clientName}</strong> wants to become your client and book lessons with you.</p>

          <div style="background: #eff6ff; padding: 16px; border-radius: 8px; margin: 16px 0;">
            <p style="margin: 0;"><strong>Name:</strong> ${clientName}</p>
            ${client.email ? `<p style="margin: 8px 0 0 0;"><strong>Email:</strong> ${esc(client.email)}</p>` : ''}
            ${note ? `<p style="margin: 8px 0 0 0;"><strong>Message:</strong> ${esc(note).replace(/\n/g, '<br>')}</p>` : ''}
          </div>

          <p>Go to your dashboard to approve or decline this request.</p>
          <a href="${APP_URL}/lessons/clients" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin-top: 16px;">View Client Requests</a>
        </div>
      `
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof CreditLimitError) return creditLimitResponse(error);
    console.error('Client request notification error:', error);
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
  }
}

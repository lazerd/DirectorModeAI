import { APP_URL } from '@/lib/appUrl';

/**
 * LessonMode's "lesson cancelled" email, in one place.
 *
 * Lifted out of /api/lessons/cancel-notify so the assistant's cancel_lesson
 * sends the very same message the coach dashboard does, rather than a second
 * copy that drifts. The route still owns who is billed; this only builds the
 * message.
 */
export function lessonCancelEmail(opts: {
  recipientName?: string | null;
  /** 'client' = the client cancelled, so this goes to the coach. Anything else = the coach cancelled. */
  cancelledBy: string;
  otherPartyName: string;
  slotDate: string;
  slotTime: string;
  location?: string | null;
}): { from: string; subject: string; html: string } {
  const { recipientName, cancelledBy, otherPartyName, slotDate, slotTime, location } = opts;
  const isCoachNotification = cancelledBy === 'client';

  const subject = isCoachNotification
    ? `Lesson Cancelled: ${otherPartyName} cancelled their booking`
    : `Lesson Cancelled: Your lesson with ${otherPartyName} has been cancelled`;

  const heading = isCoachNotification
    ? 'Lesson Cancelled by Client'
    : 'Your Lesson Has Been Cancelled';

  const message = isCoachNotification
    ? `<p><strong>${otherPartyName}</strong> has cancelled their lesson with you:</p>`
    : `<p><strong>${otherPartyName}</strong> has cancelled your scheduled lesson:</p>`;

  const dashboardUrl = isCoachNotification
    ? `${APP_URL}/lessons/dashboard`
    : `${APP_URL}/client/dashboard`;

  const buttonText = isCoachNotification ? 'View Dashboard' : 'Book Another Lesson';

  return {
    from: 'LessonMode <noreply@mail.clubmode.ai>',
    subject,
    html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #dc2626;">❌ ${heading}</h2>
          <p>Hi ${recipientName || 'there'},</p>
          ${message}
          <div style="background: #fef2f2; padding: 16px; border-radius: 8px; margin: 16px 0; border-left: 4px solid #dc2626;">
            <p style="margin: 0;"><strong>Date:</strong> ${slotDate}</p>
            <p style="margin: 8px 0 0 0;"><strong>Time:</strong> ${slotTime}</p>
            ${location ? `<p style="margin: 8px 0 0 0;"><strong>Location:</strong> ${location}</p>` : ''}
          </div>
          <p>This time slot is now available again.</p>
          <a href="${dashboardUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin-top: 16px;">${buttonText}</a>
        </div>
      `,
  };
}

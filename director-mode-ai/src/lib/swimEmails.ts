/**
 * SwimMode emails — currently just the magic signup-link email families
 * receive when the lead clicks "Email link" in the Families tab.
 *
 * Goes through `safeResendSend()` so the unsubscribe blocklist + footer
 * apply automatically.
 */

import { Resend } from 'resend';
import { safeResendSend } from './emailUnsubscribe';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM =
  process.env.RESEND_FROM_EMAIL || 'CoachMode <noreply@mail.coachmode.ai>';

export async function sendSwimFamilyLinkEmail(args: {
  to: string;
  familyName: string;
  seasonName: string;
  signupUrl: string;
  pointsTarget: number;
}) {
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #111;">
      <div style="background: linear-gradient(135deg, #06b6d4 0%, #2563eb 100%); border-radius: 16px; padding: 32px 24px; color: #fff; text-align: center; margin-bottom: 24px;">
        <div style="font-size: 13px; opacity: 0.85; letter-spacing: 1.5px; text-transform: uppercase; font-weight: 600; margin-bottom: 6px;">${args.seasonName}</div>
        <h1 style="margin: 0; font-size: 28px; font-weight: 700;">${args.familyName} family</h1>
        <p style="margin: 8px 0 0; opacity: 0.95; font-size: 14px;">Volunteer Points · ${args.pointsTarget} pt target</p>
      </div>

      <p style="font-size: 16px; line-height: 1.6;">Hi ${args.familyName} family,</p>

      <p style="font-size: 16px; line-height: 1.6;">
        This is your private link to view your volunteer points and sign up for jobs throughout the swim season:
      </p>

      <div style="text-align: center; margin: 28px 0;">
        <a href="${args.signupUrl}" style="display: inline-block; background: linear-gradient(135deg, #06b6d4 0%, #2563eb 100%); color: #fff; text-decoration: none; font-weight: 700; font-size: 15px; padding: 14px 28px; border-radius: 12px; box-shadow: 0 4px 12px rgba(37,99,235,0.25);">
          Open my volunteer page →
        </a>
      </div>

      <p style="font-size: 13px; color: #555; line-height: 1.6;">
        Or copy this link:<br>
        <a href="${args.signupUrl}" style="color: #0891b2; word-break: break-all;">${args.signupUrl}</a>
      </p>

      <div style="background: #fffbeb; border-left: 3px solid #f59e0b; padding: 12px 16px; border-radius: 8px; margin: 24px 0;">
        <p style="margin: 0; font-size: 13px; color: #78350f;">
          🔒 <strong>Keep this link private.</strong> Anyone with it can sign up for jobs as your family.
        </p>
      </div>

      <p style="color: #888; font-size: 12px; margin-top: 32px; border-top: 1px solid #eee; padding-top: 16px;">
        Sent by your swim team lead via CoachMode SwimMode. Reply to this email for help.
      </p>
    </div>
  `;

  return safeResendSend(resend, {
    from: FROM,
    to: args.to,
    subject: `Your ${args.seasonName} volunteer link`,
    html,
  });
}

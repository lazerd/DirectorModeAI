import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { safeResendSend } from '@/lib/emailUnsubscribe';
import { clubFromLine } from '@/lib/emailText';

/**
 * POST /api/auth/forgot-password  { email }
 *
 * The reset email, written and sent by us instead of Supabase's stock template.
 *
 * The stock one — "Follow this link to reset the password for your user",
 * signed "ClubMode", no Reply-To — is the shape of a phishing email, and Gmail
 * filed it that way: Vi Le requested it three times on 2026-09-24 before one
 * surfaced. This one comes from the member's club by name, answers to the
 * club's own inbox, and says in plain words who asked and what the link does.
 *
 * The link is a `token_hash` link through /auth/confirm, so it works on any
 * device, not only the browser that asked for it.
 *
 * Always answers `{ ok: true }` for a well-formed address, whether or not an
 * account exists — the page must not become a way to test who is a member.
 */
const resend = new Resend(process.env.RESEND_API_KEY);
const SENDING_ADDRESS =
  (process.env.RESEND_FROM_EMAIL || '').match(/<([^>]+)>/)?.[1] || 'noreply@mail.clubmode.ai';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = String(body?.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ ok: false, error: 'Please enter a valid email.' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'recovery', email });
  const tokenHash = link?.properties?.hashed_token;
  // No such account (or any other refusal): same answer as success.
  if (linkErr || !tokenHash || !link?.user) return NextResponse.json({ ok: true });

  const user = link.user;
  const origin = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;
  const url = `${origin}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`;

  // Their club, for the From name and a Reply-To a person actually reads.
  const { data: mems } = await admin
    .from('cc_club_members')
    .select('created_at, cc_clubs(name, email)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1);
  let club = (mems?.[0] as unknown as { cc_clubs: { name: string | null; email: string | null } | null } | undefined)
    ?.cc_clubs ?? null;
  if (!club) {
    const { data: owned } = await admin
      .from('cc_clubs')
      .select('name, email')
      .eq('owner_id', user.id)
      .limit(1)
      .maybeSingle();
    club = owned ?? null;
  }
  const clubName = club?.name || 'ClubMode';

  const meta = (user.user_metadata || {}) as Record<string, unknown>;
  const fullName = String(meta.full_name || meta.name || meta.first_name || '').trim();
  const first = fullName.split(/\s+/)[0] || '';

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a;font-size:16px;line-height:1.5">
  <p style="margin:0 0 16px">${first ? `Hi ${esc(first)},` : 'Hi,'}</p>
  <p style="margin:0 0 16px">Someone (hopefully you) asked to set a new password for your ${esc(clubName)} account on ClubMode, using ${esc(email)}.</p>
  <p style="margin:0 0 24px">Tap the button to choose your password. The link works once.</p>
  <p style="margin:0 0 24px"><a href="${url}" style="display:inline-block;background:#0e7490;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">Choose my password</a></p>
  <p style="margin:0 0 16px;font-size:14px;color:#475569">If the button doesn't work, copy this into your browser:<br><a href="${url}" style="color:#0e7490;word-break:break-all">${url}</a></p>
  <p style="margin:0 0 16px;font-size:14px;color:#475569">Didn't ask for this? Ignore this email and your password stays the same.</p>
  <p style="margin:0;font-size:14px;color:#475569">${esc(clubName)}</p>
</div>`;

  const sent = await safeResendSend(resend, {
    from: clubFromLine(clubName, SENDING_ADDRESS),
    to: email,
    subject: `Set your ${clubName} password`,
    html,
    ...(club?.email ? { replyTo: club.email } : {}),
    operational: true,
  });
  if (!sent.sent) {
    return NextResponse.json({ ok: false, error: "We couldn't send the reset link. Please try again." }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}

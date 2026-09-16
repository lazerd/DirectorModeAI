/**
 * Emails forwarded to a team's own address (<token>@mail.clubmode.ai).
 *
 * Resend receives the mail and calls this with an `email.received` webhook
 * that carries only metadata, so the body is fetched from Resend's receiving
 * API. The email is read into a PENDING host note — never applied, never sent
 * on — and waits on the team hub / match page for the captain.
 *
 * Signed with Svix headers; RESEND_INBOUND_WEBHOOK_SECRET is the webhook's
 * signing secret (whsec_…).
 */
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { tokensFromRecipients } from '@/lib/captain/hostNote';
import { verifySvix } from '@/lib/captain/svix';
import { fileHostNote, HostNoteError } from '@/lib/captain/hostNoteServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Reading the email with the model takes a few seconds.
export const maxDuration = 60;

const stripHtml = (html: string) =>
  html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();

export async function POST(req: Request) {
  const raw = await req.text();
  const ok = verifySvix(
    process.env.RESEND_INBOUND_WEBHOOK_SECRET || '',
    {
      id: req.headers.get('svix-id'),
      timestamp: req.headers.get('svix-timestamp'),
      signature: req.headers.get('svix-signature'),
    },
    raw,
  );
  if (!ok) return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 });

  const event = JSON.parse(raw) as {
    type?: string;
    data?: { email_id?: string; to?: string[]; cc?: string[]; bcc?: string[]; received_for?: string[] };
  };
  if (event.type !== 'email.received' || !event.data?.email_id) return NextResponse.json({ ignored: true });

  const domain = process.env.CAPTAIN_INBOUND_DOMAIN || 'mail.clubmode.ai';
  const res = await fetch(`https://api.resend.com/emails/receiving/${event.data.email_id}`, {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    cache: 'no-store',
  });
  if (!res.ok) return NextResponse.json({ error: `Could not fetch the email (${res.status}).` }, { status: 502 });
  const email = (await res.json()) as {
    from?: string;
    to?: string[];
    cc?: string[];
    subject?: string;
    text?: string | null;
    html?: string | null;
  };

  const tokens = tokensFromRecipients(
    [...(email.to ?? []), ...(email.cc ?? []), ...(event.data.to ?? []), ...(event.data.cc ?? []), ...(event.data.bcc ?? []), ...(event.data.received_for ?? [])],
    domain,
  );
  if (!tokens.length) return NextResponse.json({ ignored: 'no team address' });

  const db = getSupabaseAdmin();
  const { data: team } = await db
    .from('captain_teams')
    .select('id, name, club_id')
    .in('inbound_token', tokens)
    .limit(1)
    .maybeSingle();
  if (!team) return NextResponse.json({ ignored: 'unknown team address' });

  const body = (email.text && email.text.trim()) || stripHtml(email.html || '');
  if (!body) return NextResponse.json({ ignored: 'empty email' });

  // A retried webhook for the same email must not file it twice.
  const { data: seen } = await db
    .from('captain_host_notes')
    .select('id')
    .eq('resend_email_id', event.data.email_id)
    .maybeSingle();
  if (seen) return NextResponse.json({ ok: true, duplicate: true });

  try {
    const note = await fileHostNote(db, team as { id: string; name: string; club_id: string | null }, {
      source: 'email',
      body,
      subject: email.subject ?? null,
      from: email.from ?? null,
      resendEmailId: event.data.email_id,
    });
    return NextResponse.json({ ok: true, note_id: note.id, match_id: note.match_id });
  } catch (e) {
    const err = e as HostNoteError;
    // 5xx makes Resend retry, which is right for a model or database hiccup.
    return NextResponse.json({ error: err.message }, { status: err.status && err.status < 500 ? 200 : 500 });
  }
}

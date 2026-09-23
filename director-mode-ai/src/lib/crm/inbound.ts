/**
 * A prospect's reply, filed on their club's timeline.
 *
 * Every CRM letter carries Reply-To: hello@clubmode.ai. Namecheap forwards
 * that address to Gmail AND to Resend's inbound address; Resend calls
 * /api/captain/inbound, and whatever is not a captain team address lands here.
 *
 * Matching is by the sender's address against crm_contacts — the only signal a
 * forwarded reply reliably carries. When two clubs share a contact address, the
 * one we most recently emailed wins. Unmatched mail is still stored (org null)
 * so a reply from a new address is never silently lost.
 *
 * A reply also suppresses the club for the outreach engine: whatever they said,
 * the automatic follow-up must not go out on top of it.
 */
import type { getSupabaseAdmin } from '@/lib/supabase/admin';

type Db = ReturnType<typeof getSupabaseAdmin>;

/** `"Hal Kushins" <HKushins@aol.com>` → { email: 'hkushins@aol.com', name: 'Hal Kushins' }. */
export function parseFrom(raw: string | null | undefined): { email: string; name: string | null } | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const angle = s.match(/^(.*?)<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/);
  if (angle) {
    const name = angle[1].trim().replace(/^"(.*)"$/, '$1').trim();
    return { email: angle[2].toLowerCase(), name: name || null };
  }
  const bare = s.match(/[^\s<>"]+@[^\s<>"]+/);
  return bare ? { email: bare[0].toLowerCase(), name: null } : null;
}

/**
 * What they wrote, without the letter they are answering.
 *
 * Cuts at the first quote marker every common client writes: Gmail/Apple/AOL
 * "On <date>, <someone> wrote:", Outlook's "-----Original Message-----" and
 * "From: … Sent: …" header block, and a run of "> " lines. AOL puts the
 * "On … wrote:" on the same line as the signature, so the match is not
 * anchored to a line start.
 */
export function stripQuoted(text: string): string {
  let t = text.replace(/\r\n/g, '\n');
  const markers = [
    // Gmail wraps a long attribution, so "wrote:" may sit on the next line.
    /\bOn\s[^\n]{0,300}?\n?[^\n]{0,100}?\bwrote:/i,
    /-{2,}\s*Original Message\s*-{2,}/i,
    /\n\s*From:\s[^\n]+\n\s*(Sent|Date):\s/i,
    /\n\s*_{10,}\s*\n/,
    /\n>[^\n]*\n>/,
  ];
  let cut = t.length;
  for (const m of markers) {
    const hit = m.exec(t);
    if (hit && hit.index < cut) cut = hit.index;
  }
  t = t.slice(0, cut);
  return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export interface InboundEmail {
  resendEmailId: string;
  from: string | null;
  subject: string | null;
  text: string;
  messageId: string | null;
  receivedAt: string | null;
}

export type FileReplyResult =
  | { status: 'filed'; orgId: string; contactId: string; inboundId: string }
  | { status: 'unmatched'; inboundId: string | null }
  | { status: 'duplicate' }
  | { status: 'ignored'; reason: string };

export async function fileCrmReply(db: Db, mail: InboundEmail): Promise<FileReplyResult> {
  const from = parseFrom(mail.from);
  if (!from) return { status: 'ignored', reason: 'no sender' };

  const { data: seen } = await db
    .from('crm_inbound_emails')
    .select('id')
    .eq('resend_email_id', mail.resendEmailId)
    .maybeSingle();
  if (seen) return { status: 'duplicate' };

  const full = mail.text.trim();
  const body = stripQuoted(full) || full;
  if (!body) return { status: 'ignored', reason: 'empty email' };

  const { data: contacts } = await db
    .from('crm_contacts')
    .select('id, org_id, full_name')
    .ilike('email', from.email.replace(/[\\%_]/g, (c) => `\\${c}`));
  const list = (contacts as { id: string; org_id: string; full_name: string }[] | null) ?? [];

  let contact = list[0] ?? null;
  if (list.length > 1) {
    const { data: last } = await db
      .from('crm_email_sends')
      .select('contact_id')
      .in('contact_id', list.map((c) => c.id))
      .eq('status', 'sent')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    contact = list.find((c) => c.id === (last as { contact_id: string } | null)?.contact_id) ?? contact;
  }

  const receivedAt = mail.receivedAt || new Date().toISOString();
  const { data: inbound, error } = await db
    .from('crm_inbound_emails')
    .insert({
      resend_email_id: mail.resendEmailId,
      org_id: contact?.org_id ?? null,
      contact_id: contact?.id ?? null,
      from_email: from.email,
      from_name: from.name,
      subject: mail.subject,
      body,
      full_body: full,
      message_id: mail.messageId,
      received_at: receivedAt,
    })
    .select('id')
    .single();
  if (error) {
    // A webhook retry racing the first delivery hits the unique index.
    if (error.code === '23505') return { status: 'duplicate' };
    throw new Error(`crm inbound insert failed: ${error.message}`);
  }
  const inboundId = (inbound as { id: string }).id;
  if (!contact) return { status: 'unmatched', inboundId };

  const who = contact.full_name || from.name || from.email;
  const { data: activity } = await db
    .from('crm_activities')
    .insert({
      org_id: contact.org_id,
      contact_id: contact.id,
      kind: 'reply',
      body: `${who} replied${mail.subject ? ` — ${mail.subject}` : ''}\n\n${body}`,
      occurred_at: receivedAt,
      created_by_email: from.email,
      inbound_id: inboundId,
    })
    .select('id')
    .single();
  if (activity) {
    await db.from('crm_inbound_emails').update({ activity_id: (activity as { id: string }).id }).eq('id', inboundId);
  }

  await db.from('crm_outreach_suppression').insert({
    org_id: contact.org_id,
    reason: 'replied',
    note: `${who} replied ${receivedAt.slice(0, 10)}`,
    created_by_email: 'inbound',
  });

  return { status: 'filed', orgId: contact.org_id, contactId: contact.id, inboundId };
}

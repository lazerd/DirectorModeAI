/**
 * Composing one email to one person.
 *
 * These are cold emails to volunteer board members at racquet clubs — a club
 * president who checks her inbox twice a day and will decide in two seconds
 * whether this is a person or a mailing list. So everything here is built to
 * look like a person wrote it: plain text, no header image, no button, no
 * tracking pixel, and a From name that is a human's.
 *
 * Three rules are enforced here rather than in the UI, because the UI is not
 * the last line:
 *
 *   1. ONE recipient. There is no function in this file that takes a list.
 *      Blasting a whole board is how a domain gets burned, and the reps have
 *      exactly three prospects — sending four separate emails is not a
 *      hardship, and seeing four previews is a feature.
 *   2. A postal address, or nothing sends. CAN-SPAM §5(a)(5) requires a valid
 *      physical address on commercial email, and this is unambiguously
 *      commercial. It comes from CRM_POSTAL_ADDRESS so it is not in the repo.
 *   3. do_not_contact, no email, and an unresolved merge field all block the
 *      send. The third one matters more than it sounds: an email that opens
 *      "Hi {{first_name}}" is worse than no email at all.
 *
 * Pure — no database, no network, no environment beyond what is passed in —
 * so the preview the rep approves and the message that goes out are rendered
 * by the same code. Tested in compose.test.ts.
 */

import type { Contact, Org } from './types';

/** The merge fields a template may use. Anything else is a typo, not a field. */
export const MERGE_FIELDS = ['first_name', 'club', 'rep_name', 'demo_url', 'next_step'] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];

export type MergeValues = Record<MergeField, string>;

/**
 * "Mary Benin" → "Mary". "Dr. Bernie Wolf" → "Bernie": a leading honorific is
 * dropped, because "Hi Dr." is the tell of a broken mail merge. A single-word
 * name is used whole.
 */
const HONORIFICS = /^(mr|mrs|ms|miss|dr|prof|rev|coach)\.?$/i;

export function firstNameOf(fullName: string | null | undefined): string {
  const words = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  const usable = words.filter((w) => !HONORIFICS.test(w));
  return (usable[0] ?? words[0] ?? '').trim();
}

export function mergeValuesFor(org: Org, contact: Contact, _repName: string): MergeValues {
  return {
    first_name: firstNameOf(contact.full_name),
    club: org.name,
    // Not the rep: a template that says "{{rep_name}}" renders the team name,
    // so no letter carries a personal name. See CRM_SIGNER.
    rep_name: CRM_SIGNER,
    demo_url: org.demo_url ?? '',
    next_step: org.next_step ?? '',
  };
}

export interface Rendered {
  text: string;
  /** Fields the template asked for that came back empty or unknown. */
  missing: string[];
}

/**
 * Substitute {{field}}. Whitespace inside the braces is tolerated because
 * people type it; an unknown name is left untouched AND reported, so a typo
 * shows up in the preview as literal braces rather than silently vanishing.
 */
export function renderTemplate(template: string, values: MergeValues): Rendered {
  const missing = new Set<string>();
  const text = (template ?? '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, rawName: string) => {
    const name = rawName.toLowerCase();
    if (!(MERGE_FIELDS as readonly string[]).includes(name)) {
      missing.add(name);
      return whole;
    }
    const value = values[name as MergeField];
    if (!value) {
      missing.add(name);
      return whole;
    }
    return value;
  });
  return { text, missing: [...missing] };
}

/**
 * The block under every message.
 *
 * Name, the product, the address replies actually go to, one plain sentence
 * offering to stop, and the postal address. No logo and no "Sent with" line:
 * the point is that this reads like the end of an email, not the end of a
 * campaign.
 */
export function signatureFor(opts: {
  repName: string;
  replyTo: string;
  postalAddress: string;
}): string {
  // The signer is the team, not the rep: opts.repName still decides who the
  // CRM shows as the sender internally, but the recipient sees one name.
  const replyAddress = opts.replyTo.match(/<([^>]+)>/)?.[1] ?? opts.replyTo;
  return [
    '--',
    CRM_SIGNER,
    'ClubMode',
    replyAddress,
    '',
    "Tell us to stop and we won't write again.",
    opts.postalAddress,
  ].join('\n');
}

export interface ComposeInput {
  org: Org;
  contact: Contact;
  repName: string;
  replyTo: string;
  subject: string;
  body: string;
  postalAddress: string | null;
}

export type ComposeBlock =
  | 'no_email'
  | 'do_not_contact'
  | 'no_postal_address'
  | 'no_subject'
  | 'no_body'
  | 'unresolved_merge_fields';

export interface Composed {
  /** Everything needed to send, or to render a preview of exactly that. */
  to: string;
  subject: string;
  /** The full message the recipient reads, signature included. */
  text: string;
  html: string;
  /** Why this may not be sent. Empty means it may. */
  blocks: ComposeBlock[];
  missing: string[];
}

export const BLOCK_MESSAGE: Record<ComposeBlock, string> = {
  no_email: 'This contact has no email address.',
  do_not_contact: 'This contact is marked "don\'t contact".',
  no_postal_address:
    'CRM_POSTAL_ADDRESS is not set. Cold email needs a physical address on it, so sending is off until it is.',
  no_subject: 'Give it a subject.',
  no_body: 'The message is empty.',
  unresolved_merge_fields: 'Some merge fields did not fill in — fix them before sending.',
};

/** Minimal escaping. The body is plain text; nothing in it is markup. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The HTML half.
 *
 * `white-space: pre-wrap` on one plain div, so the HTML and the text version
 * are the same message with the same line breaks and there is no layout to get
 * wrong on a phone. Bare URLs become links because a board member should not
 * have to copy a demo link out of an email by hand.
 */
export function textToHtml(text: string): string {
  const linked = escapeHtml(text).replace(
    /(https?:\/\/[^\s<]+[^\s<.,)])/g,
    '<a href="$1" style="color:#1a56db">$1</a>',
  );
  return (
    '<div style="white-space:pre-wrap;font-family:-apple-system,BlinkMacSystemFont,' +
    "'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#111827\">" +
    linked +
    '</div>'
  );
}

/**
 * Render a message and say whether it may be sent. The preview screen and the
 * send route both call this; the rep approves the exact string that goes out.
 */
export function compose(input: ComposeInput): Composed {
  const values = mergeValuesFor(input.org, input.contact, input.repName);
  const subject = renderTemplate(input.subject ?? '', values);
  const body = renderTemplate(input.body ?? '', values);
  const missing = [...new Set([...subject.missing, ...body.missing])];

  const blocks: ComposeBlock[] = [];
  const to = (input.contact.email ?? '').trim();
  if (!to) blocks.push('no_email');
  if (input.contact.do_not_contact) blocks.push('do_not_contact');
  if (!input.postalAddress?.trim()) blocks.push('no_postal_address');
  if (!subject.text.trim()) blocks.push('no_subject');
  if (!body.text.trim()) blocks.push('no_body');
  if (missing.length) blocks.push('unresolved_merge_fields');

  const text = [
    body.text.trimEnd(),
    '',
    signatureFor({
      repName: input.repName,
      replyTo: input.replyTo,
      // The preview must show the block that would really go out, so a missing
      // address renders as the placeholder AND blocks the send above.
      postalAddress: input.postalAddress?.trim() || '[CRM_POSTAL_ADDRESS not set]',
    }),
  ].join('\n');

  return { to, subject: subject.text.trim(), text, html: textToHtml(text), blocks, missing };
}

/**
 * Where a send comes from.
 *
 * `mail.clubmode.ai` and not `clubmode.ai`: that subdomain is the verified
 * Resend sending domain (the apex is not, as of 2026-09-16), and Resend
 * refuses an unverified From outright. Overridable by env so flipping to
 * sales@clubmode.ai is one variable once the apex is verified, with no deploy
 * of this file.
 */
export const CRM_FROM = process.env.CRM_FROM_EMAIL || 'ClubMode Sales <sales@mail.clubmode.ai>';

/**
 * Replies go to the company, never to a person.
 *
 * Both reps hold tennis jobs at clubs, and a sales letter carrying their own
 * name and personal address is a conflict of interest waiting to be noticed —
 * Kevin asked outright for his name and address to be nowhere near these
 * (2026-09-17). So every message is signed by the founding team and answered at
 * one shared address, which is forwarded to whoever is reading that week.
 */
export const CRM_REPLY_TO = process.env.CRM_REPLY_TO_EMAIL || 'ClubMode <hello@clubmode.ai>';

/** What the letter signs itself, in place of a person's name. */
export const CRM_SIGNER = process.env.CRM_SIGNER_NAME || 'The ClubMode Founding Team';

export function replyToFor(_repName: string, _repEmail: string): string {
  return CRM_REPLY_TO;
}

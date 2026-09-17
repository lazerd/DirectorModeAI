/**
 * Turning an edited draft back into a template.
 *
 * ── THE BUG THIS FILE EXISTS TO PREVENT ──────────────────────────────────
 * On another product an edited card was "generalised" into a template with the
 * recipient's actual name still baked into it, and every email sent from that
 * template afterwards opened "Victor,". Nobody noticed for weeks, because a
 * template that says "Victor," renders perfectly — it is only wrong about who
 * it is talking to.
 *
 * So saving a draft as a template is two steps, in this order, and the second
 * one is allowed to say no:
 *
 *   1. UN-MERGE. Whatever was substituted INTO this draft is substituted back
 *      OUT. Not guesswork, not a name dictionary — the actual MergeValues that
 *      rendered this draft, so "Mary" only becomes {{first_name}} because Mary
 *      is who this draft was addressed to.
 *   2. REFUSE, don't repair. After step 1, if the contact's first name, last
 *      name, email address, or the club's name is STILL sitting in the text as
 *      literal characters, the save fails and says exactly which words were
 *      found and where. A silent fix here would be the same class of bug
 *      wearing a different hat: the rep would believe something was cleaned up
 *      that nobody looked at.
 *
 * Step 2 catching something is normal and expected — "Hi Mary Benin," survives
 * step 1 as "Hi {{first_name}} Benin," because there is no {{last_name}} field
 * to put Benin in. That draft genuinely cannot be a template until a human
 * decides what should be there instead.
 *
 * Pure. No database, no network. Tested in templates.test.ts.
 */

import { MERGE_FIELDS, firstNameOf, type MergeField, type MergeValues } from './compose';
import type { Contact, Org } from './types';

/**
 * The two templates the cold-outreach deck sends from.
 *
 * /crm/deck looks these up BY SLUG (see lib/outreach/write.ts) and falls back
 * to their text when the model's draft fails validation. Deleting one does not
 * degrade the deck, it stops it. Guarded here, server-side, rather than by
 * hiding a button — the button is not the lock.
 */
export const PROTECTED_TEMPLATE_SLUGS = ['outreach-intro', 'outreach-followup'] as const;

export function isProtectedTemplate(slug: string | null | undefined): boolean {
  return (PROTECTED_TEMPLATE_SLUGS as readonly string[]).includes((slug ?? '').toLowerCase());
}

/**
 * A literal occurrence of `term`, case-insensitively, not inside a longer word.
 *
 * Lookarounds rather than \b so a term that starts or ends in punctuation —
 * "St. Francis Yacht Club" — still matches, and so a possessive ("Rossmoor
 * Tennis Club's courts") is found: an apostrophe is not a word character, so
 * the trailing lookahead is satisfied.
 */
function literal(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'gi');
}

/** Terms shorter than this are not names, they are noise. "Al" would eat "also". */
const MIN_TERM = 3;

/**
 * Step 1 — put the merge fields back.
 *
 * Longest value first, so a rep called "Darrin Cohen" writing to a contact
 * called Darrin does not have the rep's name half-replaced by {{first_name}}.
 * Only the three fields a rep would ever type by hand are un-merged;
 * {{demo_url}} and {{next_step}} are URLs and fragments, not identity, and a
 * template that hard-codes one is wrong in a way a rep can see.
 */
const UNMERGED: MergeField[] = ['club', 'rep_name', 'first_name'];

export function depersonalize(text: string, values: MergeValues): string {
  const terms = UNMERGED.map((field) => ({ field, value: (values[field] ?? '').trim() }))
    .filter((t) => t.value.length >= MIN_TERM)
    .sort((a, b) => b.value.length - a.value.length);

  let out = text ?? '';
  for (const { field, value } of terms) {
    out = out.replace(literal(value), `{{${field}}}`);
  }
  return out;
}

export interface Leak {
  /** What was found, spelled as it appears in the draft. */
  found: string;
  /** Which fact it is — said in the words a rep would use. */
  what: string;
  /** 'subject' or 'the message'. */
  where: string;
}

/**
 * Step 2 — what is still personal about this text.
 *
 * Deliberately wider than what step 1 can fix: the last name and the email
 * address have no merge field, so finding one is always a refusal and never a
 * substitution. That asymmetry is the point.
 */
export function personalLeaks(
  parts: { subject: string; body: string },
  org: Org,
  contact: Contact,
): Leak[] {
  const first = firstNameOf(contact.full_name);
  const words = (contact.full_name ?? '').trim().split(/\s+/).filter(Boolean);
  const last = words.length > 1 ? words[words.length - 1] : '';

  const terms: { term: string; what: string }[] = [
    { term: org.name ?? '', what: "the club's name" },
    { term: contact.full_name ?? '', what: "this contact's name" },
    { term: first, what: "this contact's first name" },
    { term: last, what: "this contact's last name" },
    { term: (contact.email ?? '').trim(), what: "this contact's email address" },
  ].filter((t) => t.term.trim().length >= MIN_TERM);

  const out: Leak[] = [];
  const seen = new Set<string>();
  for (const [where, text] of [
    ['subject', parts.subject ?? ''],
    ['the message', parts.body ?? ''],
  ] as const) {
    for (const { term, what } of terms) {
      const m = text.match(literal(term.trim()));
      if (!m) continue;
      const key = `${where}:${what}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ found: m[0], what, where });
    }
  }
  return out;
}

/** The refusal, in one sentence a rep can act on. */
export function leakMessage(leaks: Leak[]): string {
  const bits = leaks.map((l) => `"${l.found}" (${l.what}) in ${l.where}`);
  return (
    `Not saved — this would bake one person into the template: ${bits.join('; ')}. ` +
    'Replace it with {{first_name}}, {{club}} or {{rep_name}}, or take it out, then save again.'
  );
}

export interface TemplateDraft {
  subject: string;
  body: string;
}

export type TemplateCheck =
  | { ok: true; template: TemplateDraft }
  | { ok: false; leaks: Leak[]; message: string; template: TemplateDraft };

/**
 * The whole thing: un-merge, then refuse if anything personal survived.
 *
 * `template` comes back either way, so a refusal can still show the rep the
 * half-cleaned text and let them finish it by hand — which is the only correct
 * ending for "Hi {{first_name}} Benin,".
 */
export function templateFromDraft(
  draft: TemplateDraft,
  values: MergeValues,
  org: Org,
  contact: Contact,
): TemplateCheck {
  const template: TemplateDraft = {
    subject: depersonalize(draft.subject ?? '', values),
    body: depersonalize(draft.body ?? '', values),
  };
  const leaks = personalLeaks(template, org, contact);
  if (leaks.length) return { ok: false, leaks, message: leakMessage(leaks), template };
  return { ok: true, template };
}

/** A name a rep typed → a slug that is unique enough to live in a URL-ish key. */
export function templateSlugFrom(name: string): string {
  return (
    (name || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'template'
  );
}

/** Which merge fields a template actually uses — shown under the save box. */
export function fieldsUsed(text: string): MergeField[] {
  const found = new Set<MergeField>();
  for (const m of (text ?? '').matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)) {
    const name = m[1].toLowerCase();
    if ((MERGE_FIELDS as readonly string[]).includes(name)) found.add(name as MergeField);
  }
  return [...found];
}

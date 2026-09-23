'use client';

/**
 * Write one email to one person, look at it, then send it — or save the way
 * you wrote it, or set it to go out on Thursday. All on this page.
 *
 * THE PREVIEW IS THE PRODUCT. There is no path from typing to sending that
 * does not go through a rendered preview showing the real From, the real
 * Reply-To, the real recipient and the real subject — the Send button does not
 * exist until the server has rendered one. That is the house rule, and it is
 * also the only thing that catches a merge field that did not fill in before a
 * club president reads "Hi {{first_name}}".
 *
 * SCHEDULING LIVES INSIDE THE PREVIEW for the same reason. "Send it on
 * Thursday" is a send; it just happens later, when nobody is watching, which
 * makes the approval MORE important rather than less. So Schedule sits next to
 * Send, below the rendered message, and is unreachable until the preview is up.
 *
 * Any edit after a preview throws the preview away. A stale approval is not an
 * approval.
 *
 * SAVING A TEMPLATE IS NOT A SEND, so it does not need the preview — but it
 * has a gate of its own that matters more. The draft in the box has this
 * contact's name and this club's name merged INTO it; a template made from it
 * naively would greet everybody forever as the person it was written to. The
 * server un-merges it and then refuses if anything personal survived — see
 * lib/crm/templates.ts. This file's job is to show that refusal in full,
 * word for word, rather than a shrug.
 *
 * One recipient. The picker is a radio list, not checkboxes, and the API takes
 * a single contact_id. Writing to a whole board means four emails and four
 * previews, which is the intended friction.
 *
 * CONTROLLED BY THE PAGE. Which contact is selected and whether this is open
 * live in OrgDetail, because the Email button on a contact's row opens this
 * with that person already chosen. Darrin's words: "it should basically open
 * up a list of templates right on this page, i select one, then it opens up
 * the text in a text editing box, and then i can click send right from here".
 * So the templates are a visible list with their names on, not a dropdown you
 * have to open to find out what is in it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Template } from '@/lib/crm/load';
import { crmToday } from '@/lib/crm/dates';
import { MAX_DAYS_AHEAD, label as whenLabel, mondayAt8, tomorrowAt8 } from '@/lib/crm/schedule';
import { isProtectedTemplate } from '@/lib/crm/templates';
import type { Contact, Org } from '@/lib/crm/types';

const FIELD =
  'w-full rounded-lg border border-white/10 bg-[#001820] px-3 py-2 text-sm text-white focus:border-[#D3FB52]/50 focus:outline-none';
const LABEL = 'mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/40';
const GHOST =
  'rounded-lg border border-white/15 px-3 py-2 text-xs font-medium text-white/65 hover:border-[#D3FB52]/40 hover:text-white disabled:opacity-40';

interface Preview {
  from: string;
  reply_to: string;
  to: string;
  to_name: string;
  subject: string;
  text: string;
}

interface Leak {
  found: string;
  what: string;
  where: string;
}

/** A subject and a body handed in from somewhere else — the ask box's draft. */
export interface ComposeSeed {
  contact_id: string;
  subject: string;
  body: string;
  /** Changes whenever a new seed arrives, so the same draft twice still applies. */
  key: string;
  /**
   * Set when this seed came from EDITING a scheduled email. Saving it back
   * cancels that row and queues a new one, so an edit replaces rather than
   * duplicates. The date and time come along so the boxes open where the rep
   * left them.
   */
  replaces?: string;
  replaces_at?: string;
  template_slug?: string | null;
  /** A reply to their email: the crm_inbound_emails id, so ours threads under theirs. */
  in_reply_to?: string;
}

export default function Compose({
  org,
  contacts,
  templates: initialTemplates,
  repEmail,
  otherRepName,
  canEmail,
  open,
  onOpenChange,
  contactId,
  onContactId,
  seed,
  onSent,
  onScheduled,
}: {
  org: Org;
  /** Already filtered: has an email, not marked do-not-contact. */
  contacts: Contact[];
  templates: Template[];
  repEmail: string;
  /** The other rep's first name, for saying out loud that templates are shared. */
  otherRepName: string | null;
  canEmail: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  onContactId: (id: string) => void;
  seed: ComposeSeed | null;
  /** A real send happened — the page re-reads its timeline. */
  onSent: () => void;
  /** Something was queued or replaced — the page re-reads its scheduled list. */
  onScheduled: () => void;
}) {
  const [templates, setTemplates] = useState(initialTemplates);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  /*
   * Which template this started from, for the ledger. Kept after an edit on
   * purpose — "they took the intro and changed a line" is the useful fact, and
   * clearing it on the first keystroke would record almost nothing. The whole
   * row is kept, not just the slug, so "Update Intro (warm)" can tell an
   * edited draft from an untouched one.
   */
  const [startedFrom, setStartedFrom] = useState<Template | null>(null);
  /*
   * What the boxes held the last time they agreed with the template — when it
   * was dropped in, or when it was saved. "Edited" is measured against this,
   * not against the stored template text, because the stored text has
   * {{first_name}} in it and the box has "Mary" in it: comparing those two
   * would call every draft edited the instant it was loaded.
   */
  const [baseline, setBaseline] = useState<{ subject: string; body: string } | null>(null);
  const [blocks, setBlocks] = useState<string[]>([]);
  const [canSend, setCanSend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ status: string; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const appliedSeed = useRef<string | null>(null);

  // ------------------------------------------------------------- templates
  const [saveName, setSaveName] = useState<string | null>(null);
  const [tplBusy, setTplBusy] = useState(false);
  const [tplNote, setTplNote] = useState<string | null>(null);
  const [tplError, setTplError] = useState<string | null>(null);
  const [leaks, setLeaks] = useState<Leak[]>([]);

  // ------------------------------------------------------------- scheduling
  const [schedOpen, setSchedOpen] = useState(false);
  const [schedWhen, setSchedWhen] = useState(() => tomorrowAt8());
  const [schedError, setSchedError] = useState<string | null>(null);
  const [replaces, setReplaces] = useState<string | null>(null);
  const [inReplyTo, setInReplyTo] = useState<string | null>(null);

  const templateSlug = startedFrom?.slug ?? null;
  const edited =
    !!startedFrom && !!baseline && (subject !== baseline.subject || body !== baseline.body);

  useEffect(() => setTemplates(initialTemplates), [initialTemplates]);

  /** Any change to what would be sent invalidates the approval. */
  const invalidate = useCallback(() => {
    setPreview(null);
    setCanSend(false);
    setResult(null);
    setSchedOpen(false);
    setSchedError(null);
  }, []);

  useEffect(() => {
    invalidate();
  }, [contactId, subject, body, invalidate]);

  // A draft from the ask box — or a scheduled email being edited — lands here.
  // It fills the same two boxes a template does, and goes through the same
  // preview before it can be sent or re-queued.
  useEffect(() => {
    if (!seed || appliedSeed.current === seed.key) return;
    appliedSeed.current = seed.key;
    setSubject(seed.subject);
    setBody(seed.body);
    setStartedFrom(templates.find((t) => t.slug === seed.template_slug) ?? null);
    setBaseline({ subject: seed.subject, body: seed.body });
    setResult(null);
    setTplNote(null);
    setTplError(null);
    setLeaks([]);
    setReplaces(seed.replaces ?? null);
    setInReplyTo(seed.in_reply_to ?? null);
    if (seed.replaces_at) {
      const at = new Date(seed.replaces_at);
      if (!Number.isNaN(at.getTime())) {
        setSchedWhen({
          date: new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Los_Angeles',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(at),
          time: new Intl.DateTimeFormat('en-GB', {
            timeZone: 'America/Los_Angeles',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }).format(at),
        });
      }
    }
  }, [seed, templates]);

  function applyTemplate(t: Template) {
    if (templateSlug === t.slug) {
      // Pressing the selected one again clears it, so "actually I'll write it
      // myself" does not mean reloading the page.
      setStartedFrom(null);
      setBaseline(null);
      setSubject('');
      setBody('');
      return;
    }
    setStartedFrom(t);
    setSubject(t.subject);
    setBody(t.body);
    setBaseline({ subject: t.subject, body: t.body });
    setResult(null);
    setTplNote(null);
    setTplError(null);
    setLeaks([]);
    // Straight into the editing box with the cursor in it — that is the whole
    // point of picking a template from a list rather than a dropdown.
    window.setTimeout(() => bodyRef.current?.focus(), 0);
  }

  async function ask(confirm: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/crm/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_id: org.id,
          contact_id: contactId,
          subject,
          body,
          confirm,
          template_slug: templateSlug,
          in_reply_to: inReplyTo,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (confirm) {
        // A held or blocked send comes back 422 with its reason. It is NOT a
        // success, and must never be drawn like one — see lib/crm/send.ts.
        const status = String(j.status ?? (res.ok ? 'sent' : 'failed'));
        setResult({ status, message: String(j.message ?? j.error ?? '') });
        setPreview(null);
        setCanSend(false);
        if (status === 'sent') {
          setSubject('');
          setBody('');
          setStartedFrom(null);
          setBaseline(null);
          setReplaces(null);
          setInReplyTo(null);
          // The panel folds away and the confirmation goes up on the page,
          // next to the History the send just added a line to.
          onSent();
          onOpenChange(false);
        }
        return;
      }
      if (!res.ok) {
        setError(String(j.error ?? 'Could not build a preview.'));
        return;
      }
      setPreview(j.preview as Preview);
      setBlocks((j.blocks as string[]) ?? []);
      setCanSend(j.can_send === true);
    } finally {
      setBusy(false);
    }
  }

  // -------------------------------------------------------- save a template
  //
  // Both buttons post the draft AND which club and person it was written for,
  // because that is how the server knows which words to turn back into merge
  // fields. A 422 is the refusal — it comes with the exact words it found, and
  // they are shown in full.
  async function saveTemplate(target: 'new' | 'update', name?: string) {
    setTplBusy(true);
    setTplError(null);
    setTplNote(null);
    setLeaks([]);
    try {
      const url =
        target === 'new' ? '/api/crm/templates' : `/api/crm/templates/${startedFrom!.id}`;
      const res = await fetch(url, {
        method: target === 'new' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          subject,
          body,
          org_id: org.id,
          contact_id: contactId,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        template?: Template;
        templates?: Template[];
        error?: string;
        leaks?: Leak[];
      };
      if (!res.ok) {
        setTplError(j.error || 'Could not save that template.');
        setLeaks(j.leaks ?? []);
        return;
      }
      if (j.templates) setTemplates(j.templates);
      if (j.template) {
        // What is in the boxes is now what the template says, so the Update
        // button goes quiet until the rep changes something again. The BOXES
        // are not rewritten — they still hold the personalised draft that is
        // about to be sent to this one person.
        setStartedFrom(j.template);
        setBaseline({ subject, body });
      }
      setSaveName(null);
      setTplNote(
        target === 'new'
          ? `Saved as "${j.template?.name}". It is in Start from, above.`
          : `Updated "${j.template?.name}".`,
      );
    } finally {
      setTplBusy(false);
    }
  }

  async function renameTemplate(t: Template) {
    const name = window.prompt(`Rename "${t.name}" to:`, t.name);
    if (!name || name.trim() === t.name) return;
    setTplBusy(true);
    setTplError(null);
    try {
      const res = await fetch(`/api/crm/templates/${t.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      const j = (await res.json().catch(() => ({}))) as { templates?: Template[]; template?: Template; error?: string };
      if (!res.ok) {
        setTplError(j.error || 'Could not rename that.');
        return;
      }
      if (j.templates) setTemplates(j.templates);
      if (j.template) setStartedFrom(j.template);
      setTplNote(`Renamed to "${j.template?.name}".`);
    } finally {
      setTplBusy(false);
    }
  }

  async function deleteTemplate(t: Template) {
    if (
      !window.confirm(
        `Delete the template "${t.name}"?${
          otherRepName ? ` ${otherRepName} loses it too.` : ''
        } This cannot be undone.`,
      )
    )
      return;
    setTplBusy(true);
    setTplError(null);
    try {
      const res = await fetch(`/api/crm/templates/${t.id}`, { method: 'DELETE' });
      const j = (await res.json().catch(() => ({}))) as { templates?: Template[]; error?: string };
      if (!res.ok) {
        setTplError(j.error || 'Could not delete that.');
        return;
      }
      if (j.templates) setTemplates(j.templates);
      if (startedFrom?.id === t.id) setStartedFrom(null);
      setTplNote(`Deleted "${t.name}".`);
    } finally {
      setTplBusy(false);
    }
  }

  // ------------------------------------------------------------- schedule it
  async function schedule() {
    setBusy(true);
    setSchedError(null);
    try {
      const res = await fetch('/api/crm/scheduled', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_id: org.id,
          contact_id: contactId,
          subject,
          body,
          template_slug: templateSlug,
          date: schedWhen.date,
          time: schedWhen.time,
          replaces: replaces ?? undefined,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        scheduled?: { send_at: string };
        error?: string;
      };
      if (!res.ok || !j.scheduled) {
        setSchedError(j.error || 'Could not schedule that.');
        return;
      }
      setResult({
        status: 'scheduled',
        message: `Queued — it goes out ${whenLabel(j.scheduled.send_at)} to ${
          preview?.to_name ?? 'them'
        }. You can cancel it up to the minute it sends.`,
      });
      setSubject('');
      setBody('');
      setStartedFrom(null);
      setBaseline(null);
      setReplaces(null);
      setPreview(null);
      setCanSend(false);
      setSchedOpen(false);
      onScheduled();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  const to = useMemo(() => contacts.find((c) => c.id === contactId) ?? null, [contacts, contactId]);

  if (!open) {
    return (
      <section>
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          className="rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-white/70 hover:text-white"
        >
          Write to someone here
        </button>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-[#D3FB52]/20 bg-[#002838] p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-xl text-white">
          {replaces ? 'Edit the scheduled email' : inReplyTo ? 'Reply' : 'Write an email'}
        </h2>
        <button type="button" onClick={() => onOpenChange(false)} className="text-xs text-white/40 hover:text-white">
          Close
        </button>
      </div>
      <p className="mt-1 text-sm text-white/45">
        From <span className="text-white/70">ClubMode Sales</span>, replies to{' '}
        <span className="text-white/70">hello@clubmode.ai</span> and land on this club&apos;s History. One person at a time.
      </p>
      {replaces && (
        <p className="mt-2 rounded-lg border border-[#D3FB52]/25 bg-[#D3FB52]/[0.06] p-2.5 text-xs text-[#D3FB52]">
          Saving this replaces the one already queued — the old copy is cancelled.
        </p>
      )}

      {/*
        No postal address configured means no cold email at all — CAN-SPAM
        requires one on the message. Said here in full rather than as a
        disabled button with no explanation.
      */}
      {!canEmail && (
        <p className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-sm text-amber-200">
          Sending is off: <code className="text-amber-100">CRM_POSTAL_ADDRESS</code> is not set. Cold
          email has to carry a real postal address. Set it in the environment and this turns back on.
        </p>
      )}

      {contacts.length === 0 ? (
        <p className="mt-4 text-sm text-white/40">
          Nobody here has an email address you can write to. Add one above, or clear a
          &ldquo;don&rsquo;t contact&rdquo;.
        </p>
      ) : (
        <>
          {/* ------------------------------------------------------- who */}
          <fieldset className="mt-4">
            <legend className={LABEL}>To — pick one</legend>
            <div className="space-y-1">
              {contacts.map((c) => (
                <label
                  key={c.id}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-white/[0.03] ${
                    contactId === c.id ? 'bg-white/[0.05]' : ''
                  }`}
                >
                  <input
                    type="radio"
                    name="crm-to"
                    value={c.id}
                    checked={contactId === c.id}
                    onChange={() => onContactId(c.id)}
                    className="accent-[#D3FB52]"
                  />
                  <span className="min-w-0">
                    <span className="text-white">{c.full_name}</span>
                    {c.title && <span className="text-white/40"> · {c.title}</span>}
                    <span className="block truncate text-xs text-white/35">{c.email}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* -------------------------------------------------- templates */}
          {templates.length > 0 && (
            <div className="mt-4">
              <span className={LABEL}>Start from</span>
              <div className="flex flex-wrap gap-1.5">
                {templates.map((t) => (
                  <button
                    key={t.slug}
                    type="button"
                    onClick={() => applyTemplate(t)}
                    aria-pressed={templateSlug === t.slug}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                      templateSlug === t.slug
                        ? 'border-[#D3FB52] bg-[#D3FB52] text-[#001820]'
                        : 'border-white/15 text-white/70 hover:border-[#D3FB52]/40 hover:text-white'
                    }`}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-white/30">
                {'{{first_name}} {{club}} {{rep_name}} {{demo_url}} {{next_step}}'} fill in from this club.
                Pick one to drop it in the box, then edit it.
              </p>

              {/* Renaming and deleting the one that is selected. Kept out of
                  the button row so the row stays a row of templates. */}
              {startedFrom && (
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                  <button
                    type="button"
                    disabled={tplBusy}
                    onClick={() => renameTemplate(startedFrom)}
                    className="text-white/40 hover:text-white disabled:opacity-40"
                  >
                    Rename &ldquo;{startedFrom.name}&rdquo;
                  </button>
                  {isProtectedTemplate(startedFrom.slug) ? (
                    <span className="text-white/25">
                      The outreach deck writes from this one, so it cannot be deleted.
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={tplBusy}
                      onClick={() => deleteTemplate(startedFrom)}
                      className="text-white/30 hover:text-red-300 disabled:opacity-40"
                    >
                      Delete it
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="mt-4">
            <label className={LABEL} htmlFor="subj">
              Subject
            </label>
            <input id="subj" value={subject} onChange={(e) => setSubject(e.target.value)} className={FIELD} />
          </div>
          <div className="mt-3">
            <label className={LABEL} htmlFor="msg">
              Message
            </label>
            <textarea
              id="msg"
              ref={bodyRef}
              rows={10}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write it like you would write it by hand."
              className={FIELD}
            />
            <p className="mt-1 text-[11px] text-white/30">
              Your name, ClubMode, your reply address and the opt-out line are added at the bottom.
            </p>
          </div>

          {/* ------------------------------------------------ keep the wording */}
          <div className="mt-3 rounded-xl border border-white/[0.08] bg-[#001820]/60 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={tplBusy || !subject.trim() || !body.trim()}
                onClick={() => setSaveName(saveName === null ? '' : null)}
                className={GHOST}
              >
                Save as new template
              </button>
              {/* Only when they started from one AND changed it. Offering
                  "Update" on an untouched template is an offer to overwrite it
                  with itself. */}
              {startedFrom && edited && (
                <button
                  type="button"
                  disabled={tplBusy}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Overwrite the template "${startedFrom.name}" with what is in the boxes?` +
                          (otherRepName ? ` ${otherRepName} gets this version too.` : ''),
                      )
                    )
                      void saveTemplate('update');
                  }}
                  className={GHOST}
                >
                  Update &ldquo;{startedFrom.name}&rdquo;
                </button>
              )}
            </div>
            <p className="mt-1.5 text-[11px] text-white/30">
              Templates are shared.{' '}
              {otherRepName ? `${otherRepName} sees this too.` : 'Both of you see them.'} The
              recipient&rsquo;s name, the club and yours go back to {'{{first_name}} {{club}} {{rep_name}}'}{' '}
              before it is saved.
            </p>

            {saveName !== null && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  autoFocus
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && saveName.trim()) void saveTemplate('new', saveName.trim());
                    if (e.key === 'Escape') setSaveName(null);
                  }}
                  placeholder="Short name — e.g. Board meeting ask"
                  aria-label="Template name"
                  className={`${FIELD} min-w-0 flex-1 sm:max-w-xs`}
                />
                <button
                  type="button"
                  disabled={tplBusy || !saveName.trim()}
                  onClick={() => void saveTemplate('new', saveName.trim())}
                  className="rounded-lg bg-[#D3FB52] px-3 py-2 text-xs font-semibold text-[#001820] disabled:opacity-40"
                >
                  {tplBusy ? 'Saving…' : 'Save it'}
                </button>
                <button type="button" onClick={() => setSaveName(null)} className={GHOST}>
                  Cancel
                </button>
              </div>
            )}

            {tplNote && <p className="mt-2 text-xs text-[#D3FB52]">{tplNote}</p>}
            {/*
              The refusal, in full. This is the "every email opened Victor,"
              bug being caught — a rep who is only told "could not save" will
              click again, so the exact words that were found are named, and
              the only fix is theirs to make.
            */}
            {tplError && (
              <div className="mt-2 rounded-lg border border-red-400/30 bg-red-400/[0.06] p-3 text-xs text-red-200">
                <p>{tplError}</p>
                {leaks.length > 0 && (
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                    {leaks.map((l, i) => (
                      <li key={i}>
                        <span className="font-semibold text-red-100">&ldquo;{l.found}&rdquo;</span> — {l.what}, in{' '}
                        {l.where}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {error && <p className="mt-3 text-sm text-red-300">{error}</p>}

          {/* ---------------------------------------------------- preview */}
          {preview && (
            <div className="mt-4 rounded-xl border border-[#D3FB52]/25 bg-[#001820] p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#D3FB52]">
                This is what goes out
              </div>
              <dl className="mt-2 space-y-0.5 text-xs">
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-white/35">From</dt>
                  <dd className="text-white/70">{preview.from}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-white/35">Reply-To</dt>
                  <dd className="text-white/70">{preview.reply_to}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-white/35">To</dt>
                  <dd className="text-white/70">
                    {preview.to_name} &lt;{preview.to}&gt;
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-white/35">Subject</dt>
                  <dd className="font-semibold text-white">{preview.subject}</dd>
                </div>
              </dl>
              <pre className="mt-3 whitespace-pre-wrap border-t border-white/[0.08] pt-3 font-sans text-sm leading-relaxed text-white/85">
                {preview.text}
              </pre>

              {blocks.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm text-red-300">
                  {blocks.map((b) => (
                    <li key={b}>Cannot send — {b.replace(/_/g, ' ')}.</li>
                  ))}
                </ul>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy || !canSend || !canEmail}
                  onClick={() => ask(true)}
                  className="rounded-lg bg-[#D3FB52] px-5 py-2.5 text-sm font-semibold text-[#001820] disabled:opacity-40"
                >
                  {busy ? 'Sending…' : `Send it to ${preview.to_name}`}
                </button>
                <button
                  type="button"
                  disabled={busy || !canSend || !canEmail}
                  onClick={() => {
                    setSchedOpen((v) => !v);
                    setSchedError(null);
                  }}
                  aria-expanded={schedOpen}
                  className="rounded-lg border border-white/20 px-4 py-2.5 text-sm font-semibold text-white hover:border-[#D3FB52]/50 disabled:opacity-40"
                >
                  {replaces ? 'Reschedule' : 'Schedule'}
                </button>
              </div>

              {/* ------------------------------------------------ when */}
              {schedOpen && (
                <div className="mt-3 rounded-xl border border-white/[0.1] bg-[#002838] p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-white/40">
                    Send it later — your time (Pacific)
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" onClick={() => setSchedWhen(tomorrowAt8())} className={GHOST}>
                      Tomorrow 8am
                    </button>
                    <button type="button" onClick={() => setSchedWhen(mondayAt8())} className={GHOST}>
                      Monday 8am
                    </button>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div>
                      <label className={LABEL} htmlFor="sched-date">
                        Date
                      </label>
                      <input
                        id="sched-date"
                        type="date"
                        value={schedWhen.date}
                        min={crmToday()}
                        onChange={(e) => setSchedWhen((w) => ({ ...w, date: e.target.value }))}
                        className={FIELD}
                      />
                    </div>
                    <div>
                      <label className={LABEL} htmlFor="sched-time">
                        Time
                      </label>
                      <input
                        id="sched-time"
                        type="time"
                        value={schedWhen.time}
                        onChange={(e) => setSchedWhen((w) => ({ ...w, time: e.target.value }))}
                        className={FIELD}
                      />
                    </div>
                  </div>
                  <p className="mt-1.5 text-[11px] text-white/30">
                    Up to {MAX_DAYS_AHEAD} days out. This exact message is what goes — editing the
                    template afterwards will not change it. You can cancel it any time before it sends.
                  </p>
                  {schedError && <p className="mt-2 text-sm text-red-300">{schedError}</p>}
                  <button
                    type="button"
                    disabled={busy || !schedWhen.date || !schedWhen.time}
                    onClick={() => void schedule()}
                    className="mt-3 rounded-lg bg-[#D3FB52] px-5 py-2.5 text-sm font-semibold text-[#001820] disabled:opacity-40"
                  >
                    {busy
                      ? 'Queueing…'
                      : replaces
                        ? 'Replace the queued one'
                        : `Queue it for ${schedWhen.date || '…'} ${schedWhen.time || ''}`}
                  </button>
                </div>
              )}
            </div>
          )}

          {result && (
            <p
              className={`mt-4 rounded-lg p-3 text-sm ${
                result.status === 'sent' || result.status === 'scheduled'
                  ? 'bg-[#D3FB52]/10 text-[#D3FB52]'
                  : 'border border-red-400/30 bg-red-400/5 text-red-200'
              }`}
            >
              {result.message}
            </p>
          )}

          {!preview && (
            <button
              type="button"
              disabled={busy || !contactId || !subject.trim() || !body.trim()}
              onClick={() => ask(false)}
              className="mt-4 rounded-lg border border-white/20 px-5 py-2.5 text-sm font-semibold text-white hover:border-[#D3FB52]/50 disabled:opacity-40"
            >
              {busy ? 'Building…' : to ? `Preview it for ${to.full_name}` : 'Preview it'}
            </button>
          )}
        </>
      )}
    </section>
  );
}

'use client';

/**
 * Write one email to one person, look at it, then send it.
 *
 * THE PREVIEW IS THE PRODUCT. There is no path from typing to sending that
 * does not go through a rendered preview showing the real From, the real
 * Reply-To, the real recipient and the real subject — the Send button does not
 * exist until the server has rendered one. That is the house rule, and it is
 * also the only thing that catches a merge field that did not fill in before a
 * club president reads "Hi {{first_name}}".
 *
 * Any edit after a preview throws the preview away. A stale approval is not an
 * approval.
 *
 * One recipient. The picker is a radio list, not checkboxes, and the API takes
 * a single contact_id. Writing to a whole board means four emails and four
 * previews, which is the intended friction.
 */

import { useCallback, useEffect, useState } from 'react';
import type { Template } from '@/lib/crm/load';
import type { Contact, Org } from '@/lib/crm/types';

const FIELD =
  'w-full rounded-lg border border-white/10 bg-[#001820] px-3 py-2 text-sm text-white focus:border-[#D3FB52]/50 focus:outline-none';
const LABEL = 'mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/40';

interface Preview {
  from: string;
  reply_to: string;
  to: string;
  to_name: string;
  subject: string;
  text: string;
}

export default function Compose({
  org,
  contacts,
  templates,
  repEmail,
  canEmail,
  onSent,
}: {
  org: Org;
  /** Already filtered: has an email, not marked do-not-contact. */
  contacts: Contact[];
  templates: Template[];
  repEmail: string;
  canEmail: boolean;
  onSent: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [contactId, setContactId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [blocks, setBlocks] = useState<string[]>([]);
  const [canSend, setCanSend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ status: string; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Any change to what would be sent invalidates the approval. */
  const invalidate = useCallback(() => {
    setPreview(null);
    setCanSend(false);
    setResult(null);
  }, []);

  useEffect(() => {
    invalidate();
  }, [contactId, subject, body, invalidate]);

  function applyTemplate(slug: string) {
    const t = templates.find((x) => x.slug === slug);
    if (!t) return;
    setSubject(t.subject);
    setBody(t.body);
  }

  async function ask(confirm: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/crm/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: org.id, contact_id: contactId, subject, body, confirm }),
      });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (confirm) {
        // A held or blocked send comes back 422 with its reason. It is NOT a
        // success, and must never be drawn like one — see lib/crm/send.ts.
        setResult({ status: String(j.status ?? (res.ok ? 'sent' : 'failed')), message: String(j.message ?? j.error ?? '') });
        setPreview(null);
        setCanSend(false);
        if (j.status === 'sent') {
          setSubject('');
          setBody('');
          onSent();
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

  if (!open) {
    return (
      <section>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-white/70 hover:text-white"
        >
          Write to someone here
        </button>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-[#002838] p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-xl text-white">Write an email</h2>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-white/40 hover:text-white">
          Close
        </button>
      </div>
      <p className="mt-1 text-sm text-white/45">
        From <span className="text-white/70">ClubMode Sales</span>, replies to{' '}
        <span className="text-white/70">{repEmail}</span>. One person at a time.
      </p>

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
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-white/[0.03]"
                >
                  <input
                    type="radio"
                    name="crm-to"
                    value={c.id}
                    checked={contactId === c.id}
                    onChange={() => setContactId(c.id)}
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
              <label className={LABEL} htmlFor="tpl">
                Start from
              </label>
              <select id="tpl" defaultValue="" onChange={(e) => applyTemplate(e.target.value)} className={FIELD}>
                <option value="">Blank</option>
                {templates.map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-white/30">
                {'{{first_name}} {{club}} {{rep_name}} {{demo_url}} {{next_step}}'} fill in from this club.
              </p>
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

              <button
                type="button"
                disabled={busy || !canSend || !canEmail}
                onClick={() => ask(true)}
                className="mt-4 rounded-lg bg-[#D3FB52] px-5 py-2.5 text-sm font-semibold text-[#001820] disabled:opacity-40"
              >
                {busy ? 'Sending…' : `Send it to ${preview.to_name}`}
              </button>
            </div>
          )}

          {result && (
            <p
              className={`mt-4 rounded-lg p-3 text-sm ${
                result.status === 'sent'
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
              {busy ? 'Building…' : 'Preview it'}
            </button>
          )}
        </>
      )}
    </section>
  );
}

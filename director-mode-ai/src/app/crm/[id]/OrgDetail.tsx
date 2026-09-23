'use client';

/**
 * One prospect club.
 *
 * The plan, the demo link, the people, the composer, what we know, and the
 * history — in that order, because that is the order a rep uses them.
 *
 * Every field autosaves on blur — same rule as /run/site, and for the same
 * reason: this is a working tool a rep opens on a phone to change one date,
 * and a Save button is a thing to forget.
 *
 * TWO THINGS THAT CHANGED AFTER DARRIN USED IT:
 *
 *   1. CONTACTS ARE TEXT UNTIL YOU EDIT THEM. Every contact used to render as
 *      five input boxes with their placeholders showing, so a club with
 *      fifteen board members was fifteen copies of "Role — decision maker,
 *      champion, gatekeeper". Now a contact reads as a line of facts; clicking
 *      a value (or Edit) turns that card into the form it used to be. Empty
 *      fields are a quiet "add phone", not a repeated hint.
 *   2. EMAIL MEANS THE COMPOSER, NOT YOUR MAIL APP. The per-contact Email
 *      button used to be a mailto: link, which launches Outlook and loses the
 *      template, the merge fields, the preview and the ledger. It now opens
 *      the panel below with that person selected and scrolls to it. The
 *      address itself is still a mailto: for the rare case where you do want
 *      your own client.
 *
 * Compose lives at the bottom rather than in a modal. A modal would hide the
 * contact list and the notes at exactly the moment the rep needs them, and on
 * a 430px screen it would hide everything.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ageLabel, shortDate, type ISODate } from '@/lib/crm/dates';
import { ACTIVITY_KINDS, ACTIVITY_LABEL, ORG_TYPES, STAGES, STAGE_LABEL, type ActivityKind } from '@/lib/crm/stages';
import { regionOf } from '@/lib/crm/region';
import type { ScheduledEmail, Template } from '@/lib/crm/load';
import { label as whenLabel } from '@/lib/crm/schedule';
import type { Activity, Contact, Org } from '@/lib/crm/types';
import AskBox, { DRAFT_KEY, type AskDraft } from '../AskBox';
import Compose, { type ComposeSeed } from './Compose';

const FIELD =
  'w-full rounded-lg border border-white/10 bg-[#001820] px-3 py-2 text-sm text-white focus:border-[#D3FB52]/50 focus:outline-none';
const LABEL = 'mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/40';

export default function OrgDetail({
  org: initialOrg,
  contacts: initialContacts,
  activities: initialActivities,
  templates,
  scheduled: initialScheduled,
  today,
  repEmail,
  otherRepName,
  canEmail,
}: {
  org: Org;
  contacts: Contact[];
  activities: Activity[];
  templates: Template[];
  scheduled: ScheduledEmail[];
  today: ISODate;
  repEmail: string;
  otherRepName: string | null;
  canEmail: boolean;
}) {
  const router = useRouter();
  const [org, setOrg] = useState(initialOrg);
  const [contacts, setContacts] = useState(initialContacts);
  const [activities, setActivities] = useState(initialActivities);
  const [scheduled, setScheduled] = useState(initialScheduled);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sentNote, setSentNote] = useState<string | null>(null);

  // ------------------------------------------------------ the composer
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [seed, setSeed] = useState<ComposeSeed | null>(null);
  const composeRef = useRef<HTMLDivElement | null>(null);

  const flash = useCallback(() => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }, []);

  /** Re-read the club from the server without reloading the page. */
  const reload = useCallback(async () => {
    const res = await fetch(`/api/crm/orgs/${org.id}`, { cache: 'no-store' });
    if (!res.ok) return;
    const j = (await res.json().catch(() => null)) as
      | { org: Org; contacts: Contact[]; activities: Activity[] }
      | null;
    if (!j) return;
    setOrg(j.org);
    setContacts(j.contacts);
    setActivities(j.activities);
  }, [org.id]);

  /** Re-read what is queued to go out, without reloading the page. */
  const reloadScheduled = useCallback(async () => {
    const res = await fetch(`/api/crm/scheduled?org_id=${org.id}`, { cache: 'no-store' });
    if (!res.ok) return;
    const j = (await res.json().catch(() => null)) as { scheduled?: ScheduledEmail[] } | null;
    if (j?.scheduled) setScheduled(j.scheduled);
  }, [org.id]);

  /** One PATCH per changed field. */
  const save = useCallback(
    async (patch: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/crm/orgs/${org.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        const j = (await res.json().catch(() => ({}))) as { org?: Org; error?: string };
        if (!res.ok || !j.org) {
          setError(j.error || 'Could not save.');
          return;
        }
        setOrg(j.org);
        flash();
        // A stage change writes an activity server-side; pull the timeline.
        if ('stage' in patch) void reload();
      } finally {
        setBusy(false);
      }
    },
    [org.id, flash, reload],
  );

  const openComposerFor = useCallback((contactId: string) => {
    setComposeTo(contactId);
    setComposeOpen(true);
    setSentNote(null);
    // Let the panel render before scrolling at it.
    window.setTimeout(() => composeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }, []);

  /*
   * A draft written by the ask box on /crm arrives through sessionStorage —
   * see AskBox. Read once and thrown away, so a back button does not refill
   * the composer with an email the rep already sent.
   */
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = window.sessionStorage.getItem(DRAFT_KEY);
      if (raw) window.sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const d = JSON.parse(raw) as AskDraft;
      if (d?.org_id !== initialOrg.id) return;
      setSeed({ contact_id: d.contact_id, subject: d.subject, body: d.body, key: `${Date.now()}` });
      openComposerFor(d.contact_id);
    } catch {
      // A mangled draft is not worth an error message.
    }
  }, [initialOrg.id, openComposerFor]);

  const Text = ({
    name,
    label,
    placeholder,
    rows,
    type,
  }: {
    name: keyof Org;
    label: string;
    placeholder?: string;
    rows?: number;
    type?: string;
  }) => {
    const current = (org[name] as string | number | null) ?? '';
    const common = {
      id: String(name),
      defaultValue: current as string,
      placeholder,
      className: FIELD,
      onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (e.target.value === String(current)) return;
        save({ [name]: e.target.value });
      },
    };
    return (
      <div>
        <label className={LABEL} htmlFor={String(name)}>
          {label}
        </label>
        {rows ? <textarea rows={rows} {...common} /> : <input type={type || 'text'} {...common} />}
      </div>
    );
  };

  // ---------------------------------------------------------------- contacts
  const emailable = useMemo(
    () => contacts.filter((c) => !!c.email && !c.do_not_contact),
    [contacts],
  );

  const patchContact = useCallback(
    async (id: string, patch: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/crm/contacts/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        const j = (await res.json().catch(() => ({}))) as { contact?: Contact; error?: string };
        if (!res.ok || !j.contact) {
          setError(j.error || 'Could not save.');
          return;
        }
        const next = j.contact;
        setContacts((cs) =>
          cs.map((c) =>
            c.id === next.id ? next : patch.is_primary === true ? { ...c, is_primary: false } : c,
          ),
        );
        flash();
      } finally {
        setBusy(false);
      }
    },
    [flash],
  );

  /**
   * Stop one. Named in the confirm — "Cancel the email to Mary Benin on
   * Thursday 8:00am?" — because on a phone the button is next to another
   * club's, and an email cancelled by accident is silently never sent.
   */
  async function cancelScheduled(id: string, who: string, when: string) {
    if (!window.confirm(`Cancel the email to ${who} ${when}? It will not be sent.`)) return;
    setError(null);
    const res = await fetch(`/api/crm/scheduled/${id}`, { method: 'DELETE' });
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(j.error || 'Could not cancel that.');
    } else {
      setSentNote(`Cancelled — nothing goes to ${who}.`);
    }
    void reloadScheduled();
  }

  async function removeContact(id: string, name: string) {
    if (!window.confirm(`Remove ${name}?`)) return;
    const res = await fetch(`/api/crm/contacts/${id}`, { method: 'DELETE' });
    if (res.ok) setContacts((cs) => cs.filter((c) => c.id !== id));
  }

  const region = regionOf(org);

  return (
    <div className="mt-3 space-y-8">
      {/* ------------------------------------------------------------ header */}
      <header>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <input
            defaultValue={org.name}
            onBlur={(e) => e.target.value !== org.name && save({ name: e.target.value })}
            aria-label="Club name"
            className="min-w-0 flex-1 border-none bg-transparent p-0 font-display text-2xl text-white focus:outline-none sm:text-3xl"
          />
          {saved && <span className="pt-2 text-xs text-[#D3FB52]">Saved</span>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/40">
          {org.website && (
            <a href={org.website} target="_blank" rel="noreferrer" className="hover:text-white">
              {org.website.replace(/^https?:\/\//, '').replace(/\/$/, '')} ↗
            </a>
          )}
          {(org.city || org.state) && <span>{[org.city, org.state].filter(Boolean).join(', ')}</span>}
          {org.member_count != null && <span>{org.member_count.toLocaleString('en-US')} members</span>}
        </div>
        {/* Where this club came from and which slice of the roster it is in.
            Both were buried in the notes paragraph before. */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
          {region && (
            <span className="rounded bg-white/[0.07] px-2 py-0.5 uppercase tracking-wide text-white/55">
              {region}
            </span>
          )}
          {org.source && (
            <span className="rounded bg-white/[0.07] px-2 py-0.5 text-white/55">via {org.source}</span>
          )}
          {org.queued_at && (
            <span className="rounded bg-[#D3FB52]/15 px-2 py-0.5 font-semibold uppercase tracking-wide text-[#D3FB52]">
              Queued for outreach
            </span>
          )}
        </div>
      </header>

      {error && <p className="text-sm text-red-300">{error}</p>}
      {sentNote && (
        <p className="rounded-lg bg-[#D3FB52]/10 p-3 text-sm text-[#D3FB52]">{sentNote}</p>
      )}

      {/*
        127 of the imported clubs have nobody on file. For those, finding a
        name IS the next action — not the stage, not the demo link — so it is
        said here, above everything else, rather than waiting politely in the
        contacts section three screens down on a phone.
      */}
      {contacts.length === 0 && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/[0.06] p-4">
          <p className="text-sm font-semibold text-amber-100">Nobody here yet.</p>
          <p className="mt-1 text-sm text-amber-200/70">
            Find the racquets director — the club&rsquo;s own site, its staff page, or its board page.
            Paste the list in and this club becomes something you can actually write to.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {org.website && (
              <a
                href={org.website}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-amber-300/40 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-400/10"
              >
                Open {org.website.replace(/^https?:\/\//, '').replace(/\/$/, '')} ↗
              </a>
            )}
            <a
              href="#contacts"
              className="rounded-lg bg-amber-300 px-3 py-1.5 text-xs font-semibold text-[#3a2b00]"
            >
              Add someone
            </a>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------- ask box */}
      <AskBox
        orgId={org.id}
        clubName={org.name}
        onDraft={(d) => {
          setSeed({ contact_id: d.contact_id, subject: d.subject, body: d.body, key: `${Date.now()}` });
          openComposerFor(d.contact_id);
        }}
        onApplied={() => void reload()}
      />

      {/* ------------------------------------------------------- stage + plan */}
      <section className="rounded-2xl border border-white/[0.08] bg-[#002838] p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL} htmlFor="stage">
              Stage
            </label>
            <select
              id="stage"
              value={org.stage}
              disabled={busy}
              onChange={(e) => save({ stage: e.target.value })}
              className={FIELD}
            >
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL} htmlFor="owner_email">
              Owned by
            </label>
            <input
              id="owner_email"
              defaultValue={org.owner_email ?? ''}
              placeholder={repEmail}
              onBlur={(e) => e.target.value !== (org.owner_email ?? '') && save({ owner_email: e.target.value })}
              className={FIELD}
            />
          </div>
          <div className="sm:col-span-2">
            <Text name="next_step" label="Next step" placeholder="Who does what, next" />
          </div>
          <div>
            <label className={LABEL} htmlFor="next_step_at">
              By when
            </label>
            <input
              id="next_step_at"
              type="date"
              defaultValue={org.next_step_at ?? ''}
              onBlur={(e) =>
                e.target.value !== (org.next_step_at ?? '') && save({ next_step_at: e.target.value || null })
              }
              className={FIELD}
            />
            {org.next_step_at && (
              <p className="mt-1 text-[11px] text-white/30">{shortDate(org.next_step_at, today)}</p>
            )}
          </div>
          <div>
            <label className={LABEL} htmlFor="mrr">
              Target, $/mo
            </label>
            <input
              id="mrr"
              inputMode="decimal"
              defaultValue={String(org.mrr_target_cents / 100)}
              onBlur={(e) => {
                const n = Math.round(parseFloat(e.target.value) * 100);
                if (!Number.isFinite(n) || n === org.mrr_target_cents) return;
                save({ mrr_target_cents: n });
              }}
              className={FIELD}
            />
          </div>
          {org.stage === 'lost' && (
            <div className="sm:col-span-2">
              <Text name="lost_reason" label="Why we lost it" />
            </div>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------------ the demo */}
      <section>
        <h2 className="font-display text-xl text-white">Demo link</h2>
        <p className="mt-1 text-sm text-white/45">
          What you paste into an email. One link, no login.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            defaultValue={org.demo_url ?? ''}
            placeholder="https://clubmode.ai/demo/…"
            onBlur={(e) => e.target.value !== (org.demo_url ?? '') && save({ demo_url: e.target.value })}
            className={`${FIELD} min-w-0 flex-1`}
          />
          <CopyButton value={org.demo_url ?? ''} />
          {org.demo_url && (
            <a
              href={org.demo_url}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-white/15 px-3 py-2 text-sm font-medium text-white/70 hover:text-white"
            >
              Open
            </a>
          )}
        </div>
      </section>

      {/* ----------------------------------------------------------- contacts */}
      <section id="contacts" className="scroll-mt-20">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-xl text-white">Contacts</h2>
          <span className="text-xs text-white/30">{contacts.length}</span>
        </div>

        <div className="mt-3 space-y-2">
          {contacts.map((c) => (
            <ContactCard
              key={c.id}
              contact={c}
              onPatch={(patch) => patchContact(c.id, patch)}
              onRemove={() => removeContact(c.id, c.full_name)}
              onEmail={() => openComposerFor(c.id)}
            />
          ))}
        </div>
        <AddContacts orgId={org.id} onContacts={(cs) => setContacts(cs)} onError={setError} />
      </section>

      {/* ---------------------------------------------------------- scheduled */}
      {/*
        Above the composer, not below it. An email that will send itself on
        Thursday is a commitment already made; a rep opening this club needs to
        see it before they write another one, not after. Empty means no
        section at all — a "Nothing scheduled" heading on every club would be
        four words of furniture on 522 pages.
      */}
      {scheduled.length > 0 && (
        <section className="rounded-2xl border border-[#D3FB52]/25 bg-[#002838] p-4">
          <h2 className="font-display text-xl text-white">Going out on its own</h2>
          <p className="mt-1 text-sm text-white/45">
            Queued and waiting. This exact text is what sends — cancel it any time before it does.
          </p>
          <ul className="mt-3 space-y-2">
            {scheduled.map((s) => {
              const who =
                contacts.find((c) => c.id === s.contact_id)?.full_name ?? s.contact_name ?? s.to_email;
              return (
                <li
                  key={s.id}
                  className="rounded-xl border border-white/[0.08] bg-[#001820] p-3"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="font-semibold text-[#D3FB52]">
                      Scheduled: {whenLabel(s.send_at)}
                    </span>
                    <span className="text-white/60">to {who}</span>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-white/75">{s.subject}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/30">
                    <span>queued by {s.rep_email}</span>
                    {s.status === 'sending' && <span className="text-amber-200">sending now</span>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={s.status === 'sending'}
                      onClick={() => {
                        // Back into the composer with its own text, and the id
                        // of the row it will replace. It goes through the same
                        // preview as anything else before it can be re-queued.
                        setSeed({
                          contact_id: s.contact_id,
                          subject: s.subject,
                          body: s.body,
                          key: `${Date.now()}`,
                          replaces: s.id,
                          replaces_at: s.send_at,
                          template_slug: s.template_slug,
                        });
                        openComposerFor(s.contact_id);
                      }}
                      className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-white/70 hover:text-white disabled:opacity-40"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={s.status === 'sending'}
                      onClick={() => void cancelScheduled(s.id, who, whenLabel(s.send_at))}
                      className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-white/50 hover:border-red-400/40 hover:text-red-300 disabled:opacity-40"
                    >
                      Cancel
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ------------------------------------------------------------ compose */}
      <div ref={composeRef} className="scroll-mt-20">
        <Compose
          org={org}
          contacts={emailable}
          templates={templates}
          repEmail={repEmail}
          otherRepName={otherRepName}
          canEmail={canEmail}
          open={composeOpen}
          onOpenChange={setComposeOpen}
          contactId={composeTo}
          onContactId={setComposeTo}
          seed={seed}
          onSent={() => {
            setSentNote('Sent. It is on the timeline below.');
            void reload();
            void reloadScheduled();
            router.refresh();
          }}
          onScheduled={() => {
            setSentNote('Queued. It is in "Going out on its own" above until it sends.');
            void reloadScheduled();
          }}
        />
      </div>

      {/* -------------------------------------------------------------- notes */}
      <section>
        <h2 className="font-display text-xl text-white">What we know</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Text name="website" label="Website" placeholder="https://…" />
          <Text name="source" label="How we found them" />
          <Text name="region" label="Region" placeholder="East, Central, West…" />
          <Text name="city" label="City" />
          <Text name="state" label="State" />
          <div>
            <label className={LABEL} htmlFor="member_count">
              Members
            </label>
            <input
              id="member_count"
              inputMode="numeric"
              defaultValue={org.member_count ?? ''}
              onBlur={(e) => {
                const raw = e.target.value.trim();
                const n = raw === '' ? null : Number(raw);
                if (n !== null && !Number.isFinite(n)) return;
                if (n === org.member_count) return;
                save({ member_count: n });
              }}
              className={FIELD}
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="type">
              Type
            </label>
            <select
              id="type"
              value={org.type}
              onChange={(e) => save({ type: e.target.value })}
              className={FIELD}
            >
              {ORG_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <Text name="notes" label="Notes" rows={8} placeholder="Everything worth remembering." />
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- activity */}
      <LogActivity
        orgId={org.id}
        contacts={contacts}
        today={today}
        onLogged={(a) => setActivities((list) => [a, ...list])}
      />

      <section>
        <h2 className="font-display text-xl text-white">History</h2>
        <ol className="mt-3 space-y-3">
          {activities.map((a) => (
            <li key={a.id} className="border-l-2 border-white/[0.08] pl-3">
              <div className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-white/35">
                <span className="font-semibold uppercase tracking-wide text-white/50">
                  {ACTIVITY_LABEL[a.kind] ?? a.kind}
                </span>
                <span>{ageLabel(a.occurred_at, today)}</span>
                {a.created_by_email && <span>· {a.created_by_email}</span>}
              </div>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-white/75">{a.body}</p>
              {a.kind === 'reply' && a.inbound_id && a.contact_id && (
                <button
                  type="button"
                  onClick={() => {
                    const subj = a.body.split('\n')[0].match(/ — (.+)$/)?.[1] ?? '';
                    setSeed({
                      contact_id: a.contact_id!,
                      subject: subj ? (/^re:/i.test(subj) ? subj : `Re: ${subj}`) : 'Re:',
                      body: '',
                      key: `reply-${a.id}-${Date.now()}`,
                      in_reply_to: a.inbound_id!,
                    });
                    openComposerFor(a.contact_id!);
                  }}
                  className="mt-2 rounded-lg border border-[#D3FB52]/40 px-3 py-1.5 text-xs font-semibold text-[#D3FB52] hover:bg-[#D3FB52]/10"
                >
                  Reply
                </button>
              )}
            </li>
          ))}
          {activities.length === 0 && <li className="text-sm text-white/30">Nothing logged yet.</li>}
        </ol>
      </section>
    </div>
  );
}

/**
 * One contact: a line of facts, or the form it used to be.
 *
 * Read mode is the default because a club board is fifteen of these, and
 * fifteen sets of five inputs with their placeholders showing is a wall of
 * grey hint text with the actual names lost in it. Clicking any value — or
 * Edit — opens the form for that one card. Empty fields show as a quiet "add
 * phone" rather than a repeated instruction.
 */
function ContactCard({
  contact: c,
  onPatch,
  onRemove,
  onEmail,
}: {
  contact: Contact;
  onPatch: (patch: Record<string, unknown>) => void;
  onRemove: () => void;
  onEmail: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [focusField, setFocusField] = useState<string | null>(null);

  function edit(field?: string) {
    setFocusField(field ?? null);
    setEditing(true);
  }

  const shell = c.do_not_contact
    ? 'border-red-500/20 bg-[#002838]/50'
    : 'border-white/[0.08] bg-[#002838]';

  if (editing) {
    const auto = (name: string) => (el: HTMLInputElement | null) => {
      if (el && focusField === name) {
        el.focus();
        setFocusField(null);
      }
    };
    return (
      <div className={`rounded-xl border p-3 ${shell}`}>
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            ref={auto('full_name')}
            defaultValue={c.full_name}
            aria-label="Name"
            onBlur={(e) => e.target.value !== c.full_name && onPatch({ full_name: e.target.value })}
            className={`${FIELD} font-semibold`}
          />
          <input
            ref={auto('title')}
            defaultValue={c.title ?? ''}
            placeholder="Title"
            aria-label="Title"
            onBlur={(e) => e.target.value !== (c.title ?? '') && onPatch({ title: e.target.value })}
            className={FIELD}
          />
          <input
            ref={auto('email')}
            defaultValue={c.email ?? ''}
            placeholder="Email"
            aria-label="Email"
            inputMode="email"
            onBlur={(e) => e.target.value.toLowerCase() !== (c.email ?? '') && onPatch({ email: e.target.value })}
            className={FIELD}
          />
          <input
            ref={auto('phone')}
            defaultValue={c.phone ?? ''}
            placeholder="Phone"
            aria-label="Phone"
            inputMode="tel"
            onBlur={(e) => e.target.value !== (c.phone ?? '') && onPatch({ phone: e.target.value })}
            className={FIELD}
          />
          <input
            ref={auto('role')}
            defaultValue={c.role ?? ''}
            placeholder="Role — decision maker, champion, gatekeeper"
            aria-label="Role"
            onBlur={(e) => e.target.value !== (c.role ?? '') && onPatch({ role: e.target.value })}
            className={`${FIELD} sm:col-span-2`}
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <button
            type="button"
            onClick={() => onPatch({ is_primary: !c.is_primary })}
            className={c.is_primary ? 'font-semibold text-[#D3FB52]' : 'text-white/40 hover:text-white'}
          >
            {c.is_primary ? '★ Primary' : 'Make primary'}
          </button>
          {/*
            The one-click stop. Flipping this is enough: the Compose picker
            below drops them, and lib/crm/compose.ts refuses them again
            server-side, so nothing can send to them afterwards.
          */}
          <button
            type="button"
            onClick={() => onPatch({ do_not_contact: !c.do_not_contact })}
            className={c.do_not_contact ? 'font-semibold text-red-300' : 'text-white/40 hover:text-red-300'}
          >
            {c.do_not_contact ? "Don't contact — on" : "Don't contact"}
          </button>
          <button type="button" onClick={onRemove} className="text-white/25 hover:text-red-300">
            Remove
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="ml-auto rounded-lg border border-white/15 px-3 py-1 font-medium text-white/70 hover:text-white"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  /** A value you can click to edit, or a quiet prompt when there is none. */
  const Value = ({ field, text, prefix }: { field: string; text: string | null; prefix?: string }) =>
    text ? (
      <button
        type="button"
        onClick={() => edit(field)}
        className="text-left text-white/55 hover:text-white"
        title="Click to edit"
      >
        {prefix}
        {text}
      </button>
    ) : null;

  const missing = [
    !c.title && { field: 'title', label: 'add title' },
    !c.email && { field: 'email', label: 'add email' },
    !c.phone && { field: 'phone', label: 'add phone' },
    !c.role && { field: 'role', label: 'add role' },
  ].filter(Boolean) as { field: string; label: string }[];

  return (
    <div className={`rounded-xl border p-3 ${shell}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => edit('full_name')}
            className="text-left font-semibold text-white hover:text-[#D3FB52]"
            title="Click to edit"
          >
            {c.is_primary && <span className="mr-1 text-[#D3FB52]">★</span>}
            {c.full_name}
          </button>
          {c.title && <span className="ml-2 text-sm text-white/45">{c.title}</span>}
          {c.do_not_contact && (
            <span className="ml-2 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-300">
              Don&rsquo;t contact
            </span>
          )}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
            {c.email && (
              <span className="text-white/55">
                {/* The address itself stays a mailto: for the rare case where
                    you really do want your own mail client. The Email button
                    on the right is the one that keeps the template, the merge
                    fields, the preview and the ledger. */}
                <a href={`mailto:${c.email}`} className="hover:text-white hover:underline" title="Open in your mail app">
                  {c.email}
                </a>
              </span>
            )}
            {c.phone && (
              <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`} className="text-white/55 hover:text-white">
                {c.phone}
              </a>
            )}
            <Value field="role" text={c.role} />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {c.email && !c.do_not_contact && (
            <button
              type="button"
              onClick={onEmail}
              className="rounded-lg bg-[#D3FB52] px-3 py-1.5 text-xs font-semibold text-[#001820]"
            >
              Email
            </button>
          )}
          <button
            type="button"
            onClick={() => edit()}
            className="rounded-lg border border-white/15 px-2.5 py-1.5 text-xs font-medium text-white/50 hover:text-white"
          >
            Edit
          </button>
        </div>
      </div>

      {missing.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-white/25">
          {missing.map((m) => (
            <button key={m.field} type="button" onClick={() => edit(m.field)} className="hover:text-white/60">
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Copy to clipboard, with the only feedback that matters: the word "Copied". */
function CopyButton({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      disabled={!value}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {
          // Clipboard blocked (http, or no permission) — the field is right
          // there to select by hand, so this needs no error of its own.
        }
      }}
      className="rounded-lg border border-white/15 px-3 py-2 text-sm font-medium text-white/70 hover:text-white disabled:opacity-40"
    >
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

/**
 * Add one person, or a whole board at once.
 *
 * The paste box is the one that gets used: the reps find a club's board page,
 * select it, and paste. Parsing is in lib/crm/pasteContacts.ts.
 */
function AddContacts({
  orgId,
  onContacts,
  onError,
}: {
  orgId: string;
  onContacts: (cs: Contact[]) => void;
  onError: (e: string | null) => void;
}) {
  const [mode, setMode] = useState<null | 'one' | 'paste'>(null);
  const [paste, setPaste] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function submitPaste() {
    setBusy(true);
    onError(null);
    try {
      const res = await fetch(`/api/crm/orgs/${orgId}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paste }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        contacts?: Contact[];
        added?: number;
        alreadyHad?: number;
        skipped?: string[];
        error?: string;
      };
      if (!res.ok || !j.contacts) {
        onError(j.error || 'Could not add those.');
        return;
      }
      onContacts(j.contacts);
      setPaste('');
      setMode(null);
      setNote(
        [
          `Added ${j.added}.`,
          j.alreadyHad ? `${j.alreadyHad} were already here.` : '',
          j.skipped?.length ? `Skipped ${j.skipped.length} line(s) with no name.` : '',
        ]
          .filter(Boolean)
          .join(' '),
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitOne() {
    setBusy(true);
    onError(null);
    try {
      const res = await fetch(`/api/crm/orgs/${orgId}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: name }),
      });
      const j = (await res.json().catch(() => ({}))) as { contact?: Contact; error?: string };
      if (!res.ok || !j.contact) {
        onError(j.error || 'Could not add them.');
        return;
      }
      // Re-read the list rather than reload the page — the composer may be
      // open with a draft in it, and a reload would throw that away.
      const after = await fetch(`/api/crm/orgs/${orgId}`, { cache: 'no-store' });
      const bundle = (await after.json().catch(() => null)) as { contacts?: Contact[] } | null;
      if (bundle?.contacts) onContacts(bundle.contacts);
      setName('');
      setMode(null);
      setNote('Added. Click their name to fill in the rest.');
    } finally {
      setBusy(false);
    }
  }

  if (mode === null) {
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setMode('one')}
          className="rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-white/70 hover:text-white"
        >
          Add someone
        </button>
        <button
          type="button"
          onClick={() => setMode('paste')}
          className="rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-white/70 hover:text-white"
        >
          Paste a list
        </button>
        {note && <span className="self-center text-xs text-[#D3FB52]">{note}</span>}
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-white/[0.08] bg-[#002838] p-4">
      {mode === 'paste' ? (
        <>
          <label className={LABEL} htmlFor="paste">
            Paste a board page
          </label>
          <p className="mb-2 text-xs text-white/40">
            One person per line. Name, then email — separated by a tab or two spaces. A title in
            between is kept. Lines with no email still become a contact.
          </p>
          <textarea
            id="paste"
            rows={8}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder={'Mary Benin\tPresident\tmary.benin@gmail.com\nBert Sebilia\tVice President\tsebilia@comcast.net'}
            className={`${FIELD} font-mono text-xs`}
          />
        </>
      ) : (
        <>
          <label className={LABEL} htmlFor="one">
            Name
          </label>
          <input
            id="one"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Mary Benin"
            className={FIELD}
          />
          <p className="mt-1 text-xs text-white/40">Fill in the rest on the card once it is there.</p>
        </>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy || (mode === 'paste' ? !paste.trim() : !name.trim())}
          onClick={mode === 'paste' ? submitPaste : submitOne}
          className="rounded-lg bg-[#D3FB52] px-4 py-2 text-sm font-semibold text-[#001820] disabled:opacity-40"
        >
          {busy ? 'Adding…' : 'Add'}
        </button>
        <button
          type="button"
          onClick={() => setMode(null)}
          className="rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-white/60 hover:text-white"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Kind + what happened + when. Defaults to a note, today. */
function LogActivity({
  orgId,
  contacts,
  today,
  onLogged,
}: {
  orgId: string;
  contacts: Contact[];
  today: ISODate;
  onLogged: (a: Activity) => void;
}) {
  const [kind, setKind] = useState<ActivityKind>('note');
  const [body, setBody] = useState('');
  const [when, setWhen] = useState(today);
  const [contactId, setContactId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/crm/orgs/${orgId}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, body, occurred_at: when, contact_id: contactId || null }),
      });
      const j = (await res.json().catch(() => ({}))) as { activity?: Activity; error?: string };
      if (!res.ok || !j.activity) {
        setErr(j.error || 'Could not log that.');
        return;
      }
      onLogged(j.activity);
      setBody('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-[#002838] p-4">
      <h2 className="font-display text-xl text-white">Log what happened</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <select value={kind} onChange={(e) => setKind(e.target.value as ActivityKind)} className={FIELD}>
          {ACTIVITY_KINDS.filter((k) => k !== 'stage_change').map((k) => (
            <option key={k} value={k}>
              {ACTIVITY_LABEL[k]}
            </option>
          ))}
        </select>
        <input type="date" value={when} onChange={(e) => setWhen(e.target.value)} className={FIELD} />
        <select value={contactId} onChange={(e) => setContactId(e.target.value)} className={FIELD}>
          <option value="">Nobody in particular</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.full_name}
            </option>
          ))}
        </select>
      </div>
      <textarea
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What happened, in a line."
        className={`${FIELD} mt-3`}
      />
      {err && <p className="mt-2 text-sm text-red-300">{err}</p>}
      <button
        type="button"
        disabled={busy || !body.trim()}
        onClick={submit}
        className="mt-3 rounded-lg bg-[#D3FB52] px-4 py-2 text-sm font-semibold text-[#001820] disabled:opacity-40"
      >
        {busy ? 'Logging…' : 'Log it'}
      </button>
    </section>
  );
}

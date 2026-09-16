'use client';

/**
 * One prospect club, editable in place.
 *
 * Every field autosaves on blur — same rule as /run/site, and for the same
 * reason: this is a working tool a rep opens on a phone to change one date,
 * and a Save button is a thing to forget.
 *
 * Compose lives at the bottom rather than in a modal. A modal would hide the
 * contact list and the notes at exactly the moment the rep needs them, and on
 * a 430px screen it would hide everything.
 */

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ageLabel, shortDate, type ISODate } from '@/lib/crm/dates';
import { ACTIVITY_KINDS, ACTIVITY_LABEL, ORG_TYPES, STAGES, STAGE_LABEL, type ActivityKind } from '@/lib/crm/stages';
import type { Template } from '@/lib/crm/load';
import type { Activity, Contact, Org } from '@/lib/crm/types';
import Compose from './Compose';

const FIELD =
  'w-full rounded-lg border border-white/10 bg-[#001820] px-3 py-2 text-sm text-white focus:border-[#D3FB52]/50 focus:outline-none';
const LABEL = 'mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/40';

export default function OrgDetail({
  org: initialOrg,
  contacts: initialContacts,
  activities: initialActivities,
  templates,
  today,
  repEmail,
  canEmail,
}: {
  org: Org;
  contacts: Contact[];
  activities: Activity[];
  templates: Template[];
  today: ISODate;
  repEmail: string;
  canEmail: boolean;
}) {
  const router = useRouter();
  const [org, setOrg] = useState(initialOrg);
  const [contacts, setContacts] = useState(initialContacts);
  const [activities, setActivities] = useState(initialActivities);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const flash = useCallback(() => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }, []);

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
        // A stage change writes an activity server-side; re-render to show it.
        if ('stage' in patch) router.refresh();
      } finally {
        setBusy(false);
      }
    },
    [org.id, flash, router],
  );

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

  async function patchContact(id: string, patch: Record<string, unknown>) {
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
  }

  async function removeContact(id: string, name: string) {
    if (!window.confirm(`Remove ${name}?`)) return;
    const res = await fetch(`/api/crm/contacts/${id}`, { method: 'DELETE' });
    if (res.ok) setContacts((cs) => cs.filter((c) => c.id !== id));
  }

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
      </header>

      {error && <p className="text-sm text-red-300">{error}</p>}

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
      <section>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-xl text-white">Contacts</h2>
          <span className="text-xs text-white/30">{contacts.length}</span>
        </div>
        <div className="mt-3 space-y-2">
          {contacts.map((c) => (
            <div
              key={c.id}
              className={`rounded-xl border p-3 ${
                c.do_not_contact ? 'border-red-500/20 bg-[#002838]/50' : 'border-white/[0.08] bg-[#002838]'
              }`}
            >
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  defaultValue={c.full_name}
                  aria-label="Name"
                  onBlur={(e) => e.target.value !== c.full_name && patchContact(c.id, { full_name: e.target.value })}
                  className={`${FIELD} font-semibold`}
                />
                <input
                  defaultValue={c.title ?? ''}
                  placeholder="Title"
                  aria-label="Title"
                  onBlur={(e) => e.target.value !== (c.title ?? '') && patchContact(c.id, { title: e.target.value })}
                  className={FIELD}
                />
                <input
                  defaultValue={c.email ?? ''}
                  placeholder="Email"
                  aria-label="Email"
                  inputMode="email"
                  onBlur={(e) =>
                    e.target.value.toLowerCase() !== (c.email ?? '') && patchContact(c.id, { email: e.target.value })
                  }
                  className={FIELD}
                />
                <input
                  defaultValue={c.phone ?? ''}
                  placeholder="Phone"
                  aria-label="Phone"
                  inputMode="tel"
                  onBlur={(e) => e.target.value !== (c.phone ?? '') && patchContact(c.id, { phone: e.target.value })}
                  className={FIELD}
                />
                <input
                  defaultValue={c.role ?? ''}
                  placeholder="Role — decision maker, champion, gatekeeper"
                  aria-label="Role"
                  onBlur={(e) => e.target.value !== (c.role ?? '') && patchContact(c.id, { role: e.target.value })}
                  className={`${FIELD} sm:col-span-2`}
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                {c.email && (
                  <a href={`mailto:${c.email}`} className="font-medium text-[#D3FB52] hover:underline">
                    Email ↗
                  </a>
                )}
                {c.phone && (
                  <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`} className="text-white/50 hover:text-white">
                    Call
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => patchContact(c.id, { is_primary: !c.is_primary })}
                  className={c.is_primary ? 'font-semibold text-[#D3FB52]' : 'text-white/40 hover:text-white'}
                >
                  {c.is_primary ? '★ Primary' : 'Make primary'}
                </button>
                {/*
                  The one-click stop. Flipping this is enough: the Compose
                  picker below drops them, and lib/crm/compose.ts refuses them
                  again server-side, so nothing can send to them afterwards.
                */}
                <button
                  type="button"
                  onClick={() => patchContact(c.id, { do_not_contact: !c.do_not_contact })}
                  className={c.do_not_contact ? 'font-semibold text-red-300' : 'text-white/40 hover:text-red-300'}
                >
                  {c.do_not_contact ? "Don't contact — on" : "Don't contact"}
                </button>
                <button
                  type="button"
                  onClick={() => removeContact(c.id, c.full_name)}
                  className="ml-auto text-white/25 hover:text-red-300"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
        <AddContacts
          orgId={org.id}
          onContacts={(cs) => setContacts(cs)}
          onError={setError}
        />
      </section>

      {/* ------------------------------------------------------------ compose */}
      <Compose
        org={org}
        contacts={emailable}
        templates={templates}
        repEmail={repEmail}
        canEmail={canEmail}
        onSent={() => router.refresh()}
      />

      {/* -------------------------------------------------------------- notes */}
      <section>
        <h2 className="font-display text-xl text-white">What we know</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Text name="website" label="Website" placeholder="https://…" />
          <Text name="source" label="How we found them" />
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
            </li>
          ))}
          {activities.length === 0 && <li className="text-sm text-white/30">Nothing logged yet.</li>}
        </ol>
      </section>
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
      // The list refreshes from the server copy on the next load; for now the
      // new row is appended so the rep can fill it in immediately.
      onContacts([]);
      window.location.reload();
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

'use client';

/**
 * The adults who aren't players: coach, co-captain, a team parent.
 *
 * They want the match emails and they will never be on the roster — adding
 * them there to achieve it would put a coach in a lineup and skew every
 * fairness count. So they live beside the roster, not in it.
 *
 * `on_emails` is OFF by default. Adding someone to a list must never quietly
 * start mailing them.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, UserPlus } from 'lucide-react';
import { formatPhone } from '@/lib/captain/phone';

export type TeamContact = {
  id: string;
  name: string;
  role: string;
  email: string | null;
  phone: string | null;
  on_emails: boolean;
};

const ROLES = [
  { value: 'coach', label: 'Coach' },
  { value: 'co_captain', label: 'Co-captain' },
  { value: 'team_parent', label: 'Team parent' },
  { value: 'other', label: 'Other' },
];

const ROLE_LABEL: Record<string, string> = Object.fromEntries(
  ROLES.map((r) => [r.value, r.label]),
);

const field =
  'w-full px-2.5 py-2 rounded-lg bg-[#001820] border border-white/10 placeholder-white/25 focus:border-[#D3FB52]/50 focus:outline-none text-sm';
const INPUT_COLOR = { color: '#ffffff' } as const;

export default function TeamContactsPanel({
  teamId,
  contacts,
}: {
  teamId: string;
  contacts: TeamContact[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('coach');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [onEmails, setOnEmails] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/captain/team-contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          team_id: teamId,
          name,
          role,
          email: email || null,
          phone: phone || null,
          on_emails: onEmails,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error || 'Could not add that contact.');
        return;
      }
      setName('');
      setEmail('');
      setPhone('');
      setOpen(false);
      router.refresh();
    } catch {
      setError('Network problem — try again.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleEmails(c: TeamContact) {
    await fetch('/api/captain/team-contacts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team_id: teamId, id: c.id, on_emails: !c.on_emails }),
    });
    router.refresh();
  }

  async function remove(c: TeamContact) {
    await fetch('/api/captain/team-contacts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team_id: teamId, id: c.id }),
    });
    router.refresh();
  }

  return (
    <div className="mt-4 rounded-2xl border border-white/[0.08] bg-[#002838] p-5">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="text-white font-medium">Coaches &amp; other contacts</h3>
        <span className="text-white/45 text-sm">
          {contacts.length === 0
            ? 'none yet'
            : `${contacts.filter((c) => c.on_emails).length} on team emails`}
        </span>
      </div>
      <p className="text-white/40 text-xs mt-1">
        Anyone who should get the team&rsquo;s emails without being in a lineup — a coach, a
        co-captain, the parent who does the driving. Anyone ticked below is copied on the
        availability poll, the lineup and the match result, marked as their copy so they know
        there is nothing for them to answer. They are left off targeted chases to one player.
      </p>

      {contacts.length > 0 && (
        <div className="mt-4 space-y-2">
          {contacts.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-3 flex-wrap rounded-xl border border-white/[0.06] bg-[#001820]/50 px-3 py-2.5"
            >
              <span className="text-white text-sm">{c.name}</span>
              <span className="text-white/35 text-xs">{ROLE_LABEL[c.role] || c.role}</span>
              <span className="text-white/45 text-xs min-w-0 truncate">
                {[c.email, formatPhone(c.phone)].filter(Boolean).join(' · ') || 'no contact details'}
              </span>
              <label className="ml-auto flex items-center gap-1.5 text-xs text-white/50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={c.on_emails}
                  onChange={() => toggleEmails(c)}
                  className="w-3.5 h-3.5 accent-[#D3FB52]"
                />
                on team emails
              </label>
              <button
                onClick={() => remove(c)}
                title={`Remove ${c.name}`}
                className="text-white/30 hover:text-red-300"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="mt-3 inline-flex items-center gap-2 text-sm px-4 py-2 rounded-xl border border-white/10 text-white/70 hover:text-white hover:border-white/25"
        >
          <UserPlus size={14} className="text-[#D3FB52]" />
          Add a contact
        </button>
      ) : (
        <form onSubmit={add} className="mt-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Name"
              style={INPUT_COLOR}
              className={field}
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              style={INPUT_COLOR}
              className={field}
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              style={INPUT_COLOR}
              className={field}
            />
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="925-555-0148"
              style={INPUT_COLOR}
              className={field}
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-white/55 cursor-pointer">
            <input
              type="checkbox"
              checked={onEmails}
              onChange={(e) => setOnEmails(e.target.checked)}
              className="w-3.5 h-3.5 accent-[#D3FB52]"
            />
            Copy them on the team&rsquo;s emails
          </label>
          {error && <p className="text-sm text-red-300">{error}</p>}
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={busy}
              className="px-5 py-2.5 rounded-xl bg-[#D3FB52] text-[#001820] font-semibold text-sm disabled:opacity-50"
            >
              {busy ? 'Adding…' : 'Add contact'}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-4 py-2.5 rounded-xl text-white/60 hover:text-white text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

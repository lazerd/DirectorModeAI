'use client';

/**
 * Signing a kid up.
 *
 * No account, no password. A parent deciding at 9pm on their phone will not
 * create a login first, and asking them to is how a club loses the
 * registration to a phone call in the morning.
 */

import { useState } from 'react';

type Props = {
  clubSlug: string;
  programSlug: string;
  /** True when the class is full and the next person joins a waitlist. */
  waitlisting: boolean;
  /** Shown on the button: what the parent is agreeing to pay. */
  priceLabel: string;
  /** The club's own checkout, if it has one. */
  hasPaymentLink: boolean;
  accent: string;
  onAccent: string;
  ink: string;
  surface: string;
  border: string;
};

export default function RegisterForm({
  clubSlug,
  programSlug,
  waitlisting,
  priceLabel,
  hasPaymentLink,
  accent,
  onAccent,
  ink,
  surface,
  border,
}: Props) {
  const [form, setForm] = useState({
    participant_name: '',
    participant_dob: '',
    parent_name: '',
    parent_email: '',
    parent_phone: '',
    notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/clubs/${encodeURIComponent(clubSlug)}/programs/${encodeURIComponent(programSlug)}/register`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        },
      );
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        registration_id?: string;
        status?: string;
      };
      if (!res.ok) {
        setError(j.error || 'Could not complete the registration.');
        setBusy(false);
        return;
      }
      // A full page load, not a router push: the confirmation reads the row
      // back so the parent sees the dates the server actually saved.
      window.location.href =
        `/c/${clubSlug}/programs/${programSlug}/registered?r=${encodeURIComponent(j.registration_id || '')}`;
    } catch {
      setError('Network problem — please try again.');
      setBusy(false);
    }
  }

  // globals.css styles bare inputs outside Tailwind's layers and wins the
  // cascade, so these carry their colors inline. Same reason the captain
  // panels do; see the note in RosterPanel.
  const field: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 10,
    border: `1px solid ${border}`,
    background: surface,
    color: ink,
    fontSize: 15,
  };
  const label: React.CSSProperties = { fontSize: 13, fontWeight: 600, marginBottom: 4, display: 'block' };

  return (
    <form onSubmit={submit} className="space-y-4">
      {waitlisting && (
        <div
          className="rounded-xl border p-3 text-sm"
          style={{ borderColor: '#f59e0b', background: 'rgba(245,158,11,0.1)' }}
        >
          This class is full. Sign up and you go on the waitlist — we email you the moment a spot
          opens, and nothing is owed until then.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label style={label} htmlFor="participant_name">
            Player&apos;s name *
          </label>
          <input
            id="participant_name"
            required
            maxLength={120}
            value={form.participant_name}
            onChange={set('participant_name')}
            style={field}
          />
        </div>
        <div>
          <label style={label} htmlFor="participant_dob">
            Date of birth
          </label>
          <input
            id="participant_dob"
            type="date"
            value={form.participant_dob}
            onChange={set('participant_dob')}
            style={field}
          />
        </div>
        <div>
          <label style={label} htmlFor="parent_name">
            Your name
          </label>
          <input
            id="parent_name"
            maxLength={120}
            value={form.parent_name}
            onChange={set('parent_name')}
            style={field}
          />
        </div>
        <div>
          <label style={label} htmlFor="parent_email">
            Email *
          </label>
          <input
            id="parent_email"
            type="email"
            required
            maxLength={200}
            value={form.parent_email}
            onChange={set('parent_email')}
            style={field}
          />
        </div>
        <div>
          <label style={label} htmlFor="parent_phone">
            Phone
          </label>
          <input
            id="parent_phone"
            type="tel"
            maxLength={40}
            value={form.parent_phone}
            onChange={set('parent_phone')}
            style={field}
          />
        </div>
      </div>

      <div>
        <label style={label} htmlFor="notes">
          Anything we should know?
        </label>
        <textarea
          id="notes"
          rows={2}
          maxLength={1000}
          placeholder="Level, a friend to pair with, an allergy…"
          value={form.notes}
          onChange={set('notes')}
          style={field}
        />
      </div>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-xl px-6 py-3.5 text-base font-bold disabled:opacity-50"
        style={{ background: accent, color: onAccent }}
      >
        {busy
          ? 'Signing up…'
          : waitlisting
            ? 'Join the waitlist'
            : `Sign up${priceLabel ? ` · ${priceLabel}` : ''}`}
      </button>

      <p className="text-xs" style={{ color: ink, opacity: 0.55 }}>
        {waitlisting
          ? 'No payment now. We only ask once a spot opens.'
          : hasPaymentLink
            ? 'We hold the spot now; the next screen takes you to payment.'
            : 'We hold the spot now and the club will be in touch about payment.'}
      </p>
    </form>
  );
}

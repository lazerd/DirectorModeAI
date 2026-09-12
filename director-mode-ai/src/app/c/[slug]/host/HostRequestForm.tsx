'use client';

/**
 * A visiting captain asking to host their season here.
 *
 * The page has already shown them the packages and the money; this is the part
 * where they tell the club who they are and which day they need. It is a
 * REQUEST and says so twice — on the button and after it is sent — because a
 * captain who thinks they have courts and turns up to find they do not has a
 * ruined match day and a story about the club.
 */

import { useState } from 'react';

export type HostPackage = {
  id: string;
  label: string;
  courts: number;
  matches_included: number;
  price_cents: number;
  playoff_price_cents: number | null;
};

const money = (cents: number) =>
  cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;

const DAYS = ['Saturday', 'Sunday', 'Weekday evening', 'Weekday daytime', 'Flexible'];

export default function HostRequestForm({
  clubSlug,
  clubName,
  packages,
  theme,
}: {
  clubSlug: string;
  clubName: string;
  packages: HostPackage[];
  theme: {
    primary: string;
    onPrimary: string;
    ink: string;
    surface: string;
    border: string;
    muted: string;
  };
}) {
  const [packageId, setPackageId] = useState(packages[0]?.id ?? '');
  const [form, setForm] = useState({
    team_name: '',
    league: '',
    division: '',
    captain_name: '',
    captain_email: '',
    captain_phone: '',
    preferred_day: '',
    preferred_time: '',
    season_note: '',
    expected_playoffs: '0',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const chosen = packages.find((p) => p.id === packageId) ?? packages[0];
  const playoffs = Math.max(0, parseInt(form.expected_playoffs || '0', 10) || 0);
  const estimate =
    chosen && chosen.playoff_price_cents != null
      ? chosen.price_cents + chosen.playoff_price_cents * playoffs
      : chosen?.price_cents ?? 0;

  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/clubs/${encodeURIComponent(clubSlug)}/host`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, package_id: packageId, expected_playoffs: playoffs }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(j.error || 'Could not send the request.');
        return;
      }
      setSent(true);
    } catch {
      setError('Network problem — try again.');
    } finally {
      setBusy(false);
    }
  }

  const field: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 10,
    border: `1px solid ${theme.border}`,
    background: theme.surface,
    color: theme.ink,
    fontSize: 15,
  };
  const label: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    marginBottom: 4,
    display: 'block',
  };

  if (sent) {
    return (
      <div
        className="rounded-2xl border p-6"
        style={{ borderColor: theme.border, background: theme.surface }}
      >
        <div className="text-3xl">📋</div>
        <h2 className="mt-3 text-xl font-bold">Request sent</h2>
        <p className="mt-2 text-sm" style={{ color: theme.muted }}>
          {clubName} will check the season calendar and come back to you — usually within a couple
          of days. <strong>Nothing is booked and nothing is owed yet.</strong> A copy is on its way
          to {form.captain_email}.
        </p>
      </div>
    );
  }

  if (packages.length === 0) return null;

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl border p-5"
      style={{ borderColor: theme.border, background: theme.surface }}
    >
      <h2 className="text-xl font-bold">Ask to host here</h2>
      <p className="mt-1 text-sm" style={{ color: theme.muted }}>
        Tell us about your team and which day you need. We check the calendar before confirming.
      </p>

      {/* ------------------------------------------------------- package */}
      <div className="mt-5">
        <label style={label}>Which package</label>
        <div className="grid gap-2 sm:grid-cols-2">
          {packages.map((p) => {
            const on = p.id === packageId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPackageId(p.id)}
                className="rounded-xl border p-3 text-left"
                style={
                  on
                    ? { borderColor: theme.primary, background: theme.primary, color: theme.onPrimary }
                    : { borderColor: theme.border }
                }
              >
                <div className="text-sm font-bold">{p.label}</div>
                <div className="text-xs" style={{ opacity: on ? 0.85 : 0.65 }}>
                  {p.courts} courts · {p.matches_included} home matches ·{' '}
                  {money(p.price_cents)}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label style={label} htmlFor="team_name">
            Team name *
          </label>
          <input id="team_name" required maxLength={160} value={form.team_name} onChange={set('team_name')} style={field} />
        </div>
        <div>
          <label style={label} htmlFor="league">
            League
          </label>
          <input
            id="league"
            maxLength={120}
            placeholder="USTA NorCal Adult 40+"
            value={form.league}
            onChange={set('league')}
            style={field}
          />
        </div>
        <div>
          <label style={label} htmlFor="division">
            Division / level
          </label>
          <input id="division" maxLength={80} placeholder="4.0 Men" value={form.division} onChange={set('division')} style={field} />
        </div>
        <div>
          <label style={label} htmlFor="preferred_day">
            Home match day
          </label>
          <select id="preferred_day" value={form.preferred_day} onChange={set('preferred_day')} style={field}>
            <option value="">Not sure yet</option>
            {DAYS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={label} htmlFor="preferred_time">
            Usual start time
          </label>
          <input id="preferred_time" maxLength={40} placeholder="9am" value={form.preferred_time} onChange={set('preferred_time')} style={field} />
        </div>
        <div>
          <label style={label} htmlFor="expected_playoffs">
            Playoff matches you expect
          </label>
          <input
            id="expected_playoffs"
            inputMode="numeric"
            value={form.expected_playoffs}
            onChange={set('expected_playoffs')}
            style={field}
          />
        </div>
        <div>
          <label style={label} htmlFor="captain_name">
            Captain&apos;s name *
          </label>
          <input id="captain_name" required maxLength={120} value={form.captain_name} onChange={set('captain_name')} style={field} />
        </div>
        <div>
          <label style={label} htmlFor="captain_email">
            Captain&apos;s email *
          </label>
          <input
            id="captain_email"
            type="email"
            required
            maxLength={200}
            value={form.captain_email}
            onChange={set('captain_email')}
            style={field}
          />
        </div>
        <div>
          <label style={label} htmlFor="captain_phone">
            Captain&apos;s phone
          </label>
          <input id="captain_phone" type="tel" maxLength={40} value={form.captain_phone} onChange={set('captain_phone')} style={field} />
        </div>
      </div>

      <div className="mt-4">
        <label style={label} htmlFor="season_note">
          Anything else?
        </label>
        <textarea
          id="season_note"
          rows={2}
          maxLength={1000}
          placeholder="Season dates, number of players, anything unusual…"
          value={form.season_note}
          onChange={set('season_note')}
          style={field}
        />
      </div>

      {/* ------------------------------------------------------ estimate */}
      {chosen && (
        <div
          className="mt-5 rounded-xl border p-4"
          style={{ borderColor: theme.border }}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-semibold">Your season would be</span>
            <span className="text-2xl font-bold" style={{ color: theme.primary }}>
              {money(estimate)}
            </span>
          </div>
          <div className="mt-1 text-xs" style={{ color: theme.muted }}>
            {money(chosen.price_cents)} for {chosen.matches_included} home matches on{' '}
            {chosen.courts} courts
            {chosen.playoff_price_cents != null && playoffs > 0
              ? ` + ${playoffs} × ${money(chosen.playoff_price_cents)} playoffs`
              : ''}
            . An estimate, not an invoice — nothing is owed until the club confirms.
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm font-medium text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="mt-4 w-full rounded-xl px-6 py-3.5 text-base font-bold disabled:opacity-50"
        style={{ background: theme.primary, color: theme.onPrimary }}
      >
        {busy ? 'Sending…' : 'Send the request'}
      </button>
      <p className="mt-2 text-xs" style={{ color: theme.muted }}>
        This is a request, not a booking. We check the season calendar first, and you pay once it is
        confirmed.
      </p>
    </form>
  );
}

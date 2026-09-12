'use client';

/**
 * One class in full, plus its roster.
 *
 * The list screen handles the weekly edits; this is for everything else — the
 * description a parent reads, the capacity, the payment link, and the actual
 * list of families with the three buttons a director needs against each one:
 * mark paid, cancel, promote.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import SessionGrid from '@/components/clubSite/SessionGrid';
import { formatPrice, formatSessionDate } from '@/lib/programs/sessions';

type Registration = {
  id: string;
  participant_name: string;
  participant_dob: string | null;
  parent_name: string | null;
  parent_email: string;
  parent_phone: string | null;
  notes: string | null;
  status: 'enrolled' | 'waitlist' | 'cancelled';
  payment_status: 'pending' | 'paid' | 'waived' | 'refunded';
  amount_cents: number | null;
  created_at: string;
};

type Program = Record<string, unknown> & {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  coach_name: string | null;
  location_note: string | null;
  level_note: string | null;
  price_note: string | null;
  audience: string;
  sport: string;
  capacity: number | null;
  age_min: number | null;
  age_max: number | null;
  range_start: string;
  range_end: string;
  time_start: string;
  time_end: string;
  days_of_week: number[] | null;
  exclusions: string[] | null;
  external_payment_url: string | null;
  registration_mode: 'online' | 'email' | 'closed';
  waitlist_enabled: boolean;
  status: string;
  court_count: number | null;
  blocks_courts: boolean;
  courts_blocked_at: string | null;
};

export default function ClassDetail({ id }: { id: string }) {
  const [program, setProgram] = useState<Program | null>(null);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [timeZone, setTimeZone] = useState('America/Los_Angeles');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [courtMsg, setCourtMsg] = useState<string | null>(null);
  const [courtCount, setCourtCount] = useState('');

  const load = useCallback(async () => {
    const res = await fetch(`/api/club-site/programs/${id}`);
    const j = (await res.json().catch(() => ({}))) as {
      program?: Program;
      registrations?: Registration[];
      timezone?: string;
      error?: string;
    };
    if (!res.ok) setError(j.error || 'Could not load the class.');
    else {
      setProgram(j.program ?? null);
      setRegistrations(j.registrations ?? []);
      if (j.program?.court_count != null) setCourtCount(String(j.program.court_count));
      if (j.timezone) setTimeZone(j.timezone);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/club-site/programs/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const j = (await res.json().catch(() => ({}))) as { error?: string; program?: Program };
        if (!res.ok) {
          setError(j.error || 'Could not save.');
          return;
        }
        if (j.program) setProgram(j.program);
        setSaved(true);
        setTimeout(() => setSaved(false), 1600);
      } finally {
        setBusy(false);
      }
    },
    [id],
  );

  async function updateReg(registrationId: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/club-site/programs/${id}/registrations`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registration_id: registrationId, ...body }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        promoted?: { name: string } | null;
      };
      if (!res.ok) {
        setError(j.error || 'Could not update.');
        return;
      }
      if (j.promoted) {
        // A spot opened and somebody was moved into it. Say so — a silent
        // promotion is indistinguishable from a bug.
        setError(null);
        setSaved(true);
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-white/40">Loading…</p>;
  if (!program) return <p className="text-red-300">{error || 'Class not found.'}</p>;

  const field =
    'w-full rounded-lg border border-white/10 bg-[#001820] px-3 py-2 text-sm focus:border-[#D3FB52]/50 focus:outline-none';
  const label = 'mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/40';

  const enrolled = registrations.filter((r) => r.status === 'enrolled');
  const waiting = registrations.filter((r) => r.status === 'waitlist');
  const cancelled = registrations.filter((r) => r.status === 'cancelled');

  const Text = ({
    name,
    labelText,
    rows,
    placeholder,
  }: {
    name: keyof Program;
    labelText: string;
    rows?: number;
    placeholder?: string;
  }) => (
    <div>
      <label className={label} htmlFor={String(name)}>
        {labelText}
      </label>
      {rows ? (
        <textarea
          id={String(name)}
          rows={rows}
          defaultValue={(program[name] as string) ?? ''}
          placeholder={placeholder}
          onBlur={(e) => {
            if (e.target.value === ((program[name] as string) ?? '')) return;
            patch({ [name]: e.target.value });
          }}
          style={{ color: '#ffffff' }}
          className={field}
        />
      ) : (
        <input
          id={String(name)}
          defaultValue={(program[name] as string) ?? ''}
          placeholder={placeholder}
          onBlur={(e) => {
            if (e.target.value === ((program[name] as string) ?? '')) return;
            patch({ [name]: e.target.value });
          }}
          style={{ color: '#ffffff' }}
          className={field}
        />
      )}
    </div>
  );

  const RegRow = ({ r }: { r: Registration }) => (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] py-3">
      <div className="min-w-0">
        <div className="font-medium text-white">
          {r.participant_name}
          {r.status === 'waitlist' && (
            <span className="ml-2 text-xs font-normal text-amber-300">waitlist</span>
          )}
          {r.status === 'cancelled' && (
            <span className="ml-2 text-xs font-normal text-white/30">cancelled</span>
          )}
        </div>
        <div className="truncate text-sm text-white/40">
          {r.parent_name ? `${r.parent_name} · ` : ''}
          {r.parent_email}
          {r.parent_phone ? ` · ${r.parent_phone}` : ''}
        </div>
        {r.notes && <div className="mt-0.5 text-xs italic text-white/35">“{r.notes}”</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2 text-xs">
        <span
          className={
            r.payment_status === 'paid'
              ? 'text-[#D3FB52]'
              : r.payment_status === 'waived'
                ? 'text-white/40'
                : r.payment_status === 'refunded'
                  ? 'text-white/30'
                  : 'text-amber-300'
          }
        >
          {r.payment_status === 'pending'
            ? `${formatPrice(r.amount_cents)} due`
            : r.payment_status}
        </span>
        {r.status !== 'cancelled' && r.payment_status === 'pending' && (
          <button
            type="button"
            onClick={() => updateReg(r.id, { payment_status: 'paid' })}
            disabled={busy}
            className="rounded-lg border border-white/15 px-2.5 py-1 font-medium text-white/70 hover:text-white disabled:opacity-50"
          >
            Mark paid
          </button>
        )}
        {r.status === 'waitlist' && (
          <button
            type="button"
            onClick={() => updateReg(r.id, { status: 'enrolled' })}
            disabled={busy}
            className="rounded-lg bg-[#D3FB52] px-2.5 py-1 font-semibold text-[#001820] disabled:opacity-50"
          >
            Give them a spot
          </button>
        )}
        {r.status !== 'cancelled' && (
          <button
            type="button"
            onClick={() => {
              if (
                !window.confirm(
                  `Cancel ${r.participant_name}? If anyone is waiting, the first of them takes the spot and gets an email.`,
                )
              )
                return;
              updateReg(r.id, { status: 'cancelled' });
            }}
            disabled={busy}
            className="text-white/35 hover:text-red-300 disabled:opacity-50"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-8">
      {error && <p className="text-sm text-red-300">{error}</p>}
      {saved && <p className="text-sm text-[#D3FB52]">Saved.</p>}

      {/* ---------------------------------------------------------- details */}
      <section>
        <h2 className="font-display text-xl text-white">What a parent reads</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Text name="title" labelText="Class name" />
          <Text name="subtitle" labelText="One-line summary" placeholder="Tue & Thu after school" />
          <Text name="coach_name" labelText="Coach" />
          <Text name="location_note" labelText="Where" placeholder="Courts 1–3" />
          <Text name="level_note" labelText="Level" placeholder="Beginner to 3.0" />
          <Text name="price_note" labelText="Note about the price" placeholder="Siblings 10% off" />
        </div>
        <div className="mt-4">
          <Text
            name="description"
            labelText="Description"
            rows={5}
            placeholder="What the class covers, what to bring, how it runs…"
          />
        </div>
      </section>

      {/* ------------------------------------------------------- logistics */}
      <section>
        <h2 className="font-display text-xl text-white">Dates &amp; capacity</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-4">
          <div>
            <label className={label} htmlFor="range_start">
              First date
            </label>
            <input
              id="range_start"
              type="date"
              defaultValue={String(program.range_start).slice(0, 10)}
              onBlur={(e) => patch({ range_start: e.target.value })}
              style={{ color: '#ffffff' }}
              className={field}
            />
          </div>
          <div>
            <label className={label} htmlFor="range_end">
              Last date
            </label>
            <input
              id="range_end"
              type="date"
              defaultValue={String(program.range_end).slice(0, 10)}
              onBlur={(e) => patch({ range_end: e.target.value })}
              style={{ color: '#ffffff' }}
              className={field}
            />
          </div>
          <div>
            <label className={label} htmlFor="time_start">
              Starts
            </label>
            <input
              id="time_start"
              type="time"
              defaultValue={String(program.time_start).slice(0, 5)}
              onBlur={(e) => patch({ time_start: e.target.value })}
              style={{ color: '#ffffff' }}
              className={field}
            />
          </div>
          <div>
            <label className={label} htmlFor="time_end">
              Ends
            </label>
            <input
              id="time_end"
              type="time"
              defaultValue={String(program.time_end).slice(0, 5)}
              onBlur={(e) => patch({ time_end: e.target.value })}
              style={{ color: '#ffffff' }}
              className={field}
            />
          </div>
          <div>
            <label className={label} htmlFor="capacity">
              Capacity
            </label>
            <input
              id="capacity"
              inputMode="numeric"
              placeholder="No limit"
              defaultValue={program.capacity ?? ''}
              onBlur={(e) => {
                const raw = e.target.value.trim();
                patch({ capacity: raw === '' ? null : Math.max(1, parseInt(raw, 10) || 1) });
              }}
              style={{ color: '#ffffff' }}
              className={field}
            />
          </div>
          <div>
            <label className={label} htmlFor="audience">
              Who it&apos;s for
            </label>
            <select
              id="audience"
              defaultValue={program.audience}
              onChange={(e) => patch({ audience: e.target.value })}
              style={{ color: '#ffffff' }}
              className={field}
            >
              <option value="junior">Juniors</option>
              <option value="adult">Adults</option>
              <option value="family">Family</option>
              <option value="all">Everyone</option>
            </select>
          </div>
          <div>
            <label className={label} htmlFor="sport">
              Sport
            </label>
            <select
              id="sport"
              defaultValue={program.sport}
              onChange={(e) => patch({ sport: e.target.value })}
              style={{ color: '#ffffff' }}
              className={field}
            >
              {['tennis', 'pickleball', 'padel', 'swim', 'fitness', 'other'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="registration_mode">
              Sign-ups
            </label>
            <select
              id="registration_mode"
              defaultValue={program.registration_mode}
              onChange={(e) => patch({ registration_mode: e.target.value })}
              style={{ color: '#ffffff' }}
              className={field}
            >
              <option value="online">Online, on my site</option>
              <option value="email">By email only</option>
              <option value="closed">Closed</option>
            </select>
          </div>
        </div>

        <div className="mt-5 rounded-xl border border-white/[0.08] bg-[#002838] p-4">
          <SessionGrid
            program={program}
            timeZone={timeZone}
            busy={busy}
            onToggle={(exclusions) => patch({ exclusions })}
          />
        </div>
      </section>

      {/* ---------------------------------------------------- hold the courts */}
      <section>
        <h2 className="font-display text-xl text-white">Courts</h2>
        <p className="mt-1 text-sm text-white/50">
          Hold this class&apos;s courts on the court sheet and nobody can book over it — not
          through your booking page, not through the desk. Change a skip date later and the court
          is handed back automatically.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-4">
          <div>
            <label className={label} htmlFor="court_count">
              Courts it uses
            </label>
            <input
              id="court_count"
              inputMode="numeric"
              placeholder="e.g. 3"
              value={courtCount}
              onChange={(e) => setCourtCount(e.target.value)}
              style={{ color: '#ffffff' }}
              className={`${field} w-24`}
            />
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setCourtMsg(null);
              setError(null);
              try {
                const n = parseInt(courtCount.trim(), 10);
                if (!Number.isFinite(n) || n <= 0) {
                  setError('How many courts does this class use?');
                  return;
                }
                const res = await fetch(`/api/club-site/programs/${id}/block-courts`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ court_count: n }),
                });
                const j = (await res.json().catch(() => ({}))) as {
                  error?: string;
                  message?: string;
                };
                if (!res.ok) setError(j.error || 'Could not hold the courts.');
                else {
                  setCourtMsg(j.message || 'Courts held.');
                  await load();
                }
              } finally {
                setBusy(false);
              }
            }}
            className="rounded-lg bg-[#D3FB52] px-4 py-2 text-sm font-semibold text-[#001820] disabled:opacity-50"
          >
            {program.blocks_courts ? 'Re-hold the courts' : 'Hold the courts'}
          </button>
          {program.blocks_courts && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (!window.confirm('Release these courts? They become bookable by anyone.')) return;
                setBusy(true);
                setCourtMsg(null);
                try {
                  const res = await fetch(`/api/club-site/programs/${id}/block-courts`, {
                    method: 'DELETE',
                  });
                  const j = (await res.json().catch(() => ({}))) as {
                    error?: string;
                    message?: string;
                  };
                  if (!res.ok) setError(j.error || 'Could not release them.');
                  else {
                    setCourtMsg(j.message || 'Released.');
                    await load();
                  }
                } finally {
                  setBusy(false);
                }
              }}
              className="text-sm font-medium text-white/50 hover:text-white disabled:opacity-50"
            >
              Release them
            </button>
          )}
        </div>

        {courtMsg && <p className="mt-3 text-sm text-[#D3FB52]">{courtMsg}</p>}

        <p className="mt-3 text-sm text-white/45">
          {program.blocks_courts ? (
            <>
              Holding {program.court_count} {program.court_count === 1 ? 'court' : 'courts'} on every
              date.{' '}
              <a
                href="/courtsheet/staff"
                target="_blank"
                rel="noreferrer"
                className="text-white/70 hover:underline"
              >
                See it on the court sheet ↗
              </a>
            </>
          ) : (
            'Not holding any courts — this class is invisible to the court sheet, so its times can be booked by somebody else.'
          )}
        </p>
      </section>

      {/* --------------------------------------------------------- payment */}
      <section>
        <h2 className="font-display text-xl text-white">Getting paid</h2>
        <p className="mt-1 text-sm text-white/50">
          Paste your own Square, Stripe or PayPal checkout link and we put a <strong>Pay now</strong>{' '}
          button on every confirmation email and receipt page. The money goes straight to you — we
          never touch it. Card-on-file inside ClubMode is coming.
        </p>
        <div className="mt-3 max-w-xl">
          <Text
            name="external_payment_url"
            labelText="Your payment link"
            placeholder="https://square.link/u/…"
          />
        </div>
      </section>

      {/* ---------------------------------------------------------- roster */}
      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-xl text-white">
            Roster{' '}
            <span className="text-sm font-normal text-white/40">
              {enrolled.length} enrolled
              {waiting.length ? ` · ${waiting.length} waiting` : ''}
              {program.capacity ? ` · ${program.capacity} spots` : ''}
            </span>
          </h2>
          {registrations.length > 0 && (
            <a
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(
                [
                  'Player,DOB,Parent,Email,Phone,Status,Payment,Amount,Notes,Signed up',
                  ...registrations.map((r) =>
                    [
                      r.participant_name,
                      r.participant_dob ?? '',
                      r.parent_name ?? '',
                      r.parent_email,
                      r.parent_phone ?? '',
                      r.status,
                      r.payment_status,
                      r.amount_cents == null ? '' : (r.amount_cents / 100).toFixed(2),
                      (r.notes ?? '').replace(/[\r\n,]/g, ' '),
                      r.created_at.slice(0, 10),
                    ]
                      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
                      .join(','),
                  ),
                ].join('\n'),
              )}`}
              download={`${program.slug}-roster.csv`}
              className="text-sm font-medium text-white/50 hover:text-white"
            >
              Download CSV
            </a>
          )}
        </div>

        {registrations.length === 0 ? (
          <p className="mt-4 text-sm text-white/40">
            Nobody has signed up yet. Sign-ups land here the moment they come in.
          </p>
        ) : (
          <div className="mt-2">
            {enrolled.map((r) => (
              <RegRow key={r.id} r={r} />
            ))}
            {waiting.length > 0 && (
              <div className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-white/35">
                Waitlist — first in line first
              </div>
            )}
            {waiting.map((r) => (
              <RegRow key={r.id} r={r} />
            ))}
            {cancelled.length > 0 && (
              <details className="mt-4">
                <summary className="cursor-pointer text-xs text-white/35">
                  {cancelled.length} cancelled
                </summary>
                {cancelled.map((r) => (
                  <RegRow key={r.id} r={r} />
                ))}
              </details>
            )}
          </div>
        )}
      </section>

      <div className="flex flex-wrap gap-4 border-t border-white/[0.06] pt-5 text-sm">
        <Link href="/run/site/classes" className="text-white/50 hover:text-white">
          ← All classes
        </Link>
        <span className="text-white/25">
          First date{' '}
          {formatSessionDate(String(program.range_start).slice(0, 10), timeZone, { year: true })}
        </span>
      </div>
    </div>
  );
}

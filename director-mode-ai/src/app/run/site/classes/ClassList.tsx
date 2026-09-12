'use client';

/**
 * The thirty-second screen.
 *
 * Every class as a card. Click a date to skip it. Change a price in the field.
 * Both autosave, and the moment either changes, a panel appears offering to
 * tell the enrolled families — because a change nobody hears about is the
 * reason a director ends up phoning a developer in the first place.
 *
 * Deliberately a flat list with everything inline: no drill-down, no modal, no
 * save button to hunt for. The whole value proposition is that the edit takes
 * one click, so any navigation between the director and the date is a defect.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import SessionGrid from '@/components/clubSite/SessionGrid';
import NotifyPanel, { type PendingChange } from '@/components/clubSite/NotifyPanel';
import PromotePanel from '@/components/clubSite/PromotePanel';
import {
  daysLabel,
  formatPrice,
  formatSessionDate,
  formatTimeRange,
} from '@/lib/programs/sessions';

type Counts = { enrolled: number; waitlist: number; unpaid: number };

type Program = {
  id: string;
  slug: string;
  title: string;
  status: 'draft' | 'published' | 'archived';
  audience: string;
  sport: string;
  range_start: string;
  range_end: string;
  days_of_week: number[] | null;
  exclusions: string[] | null;
  time_start: string;
  time_end: string;
  price_cents: number;
  member_price_cents: number | null;
  drop_in_price_cents: number | null;
  capacity: number | null;
  coach_name: string | null;
  external_payment_url: string | null;
  counts: Counts;
};

type Club = { id: string; slug: string; name: string; timezone: string };

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The sentence the notify panel shows, built from the same diff it sends. */
function describe(change: PendingChange, timeZone: string): string {
  const list = (dates: string[]) =>
    dates.map((d) => formatSessionDate(d, timeZone, { weekday: true })).join(', ');
  const parts: string[] = [];
  if (change.dates_removed.length) parts.push(`we're no longer meeting on ${list(change.dates_removed)}`);
  if (change.dates_restored.length) parts.push(`we've added ${list(change.dates_restored)} back`);
  if (change.price_changed && change.price_cents != null) {
    parts.push(`the price is now ${formatPrice(change.price_cents)}`);
  }
  if (parts.length === 0) return 'a quick update on your class';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export default function ClassList() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [club, setClub] = useState<Club | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  /** Per-program unsent change, so the Notify panel survives further edits. */
  const [pending, setPending] = useState<Record<string, PendingChange>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/club-site/programs');
      const j = (await res.json().catch(() => ({}))) as {
        programs?: Program[];
        club?: Club;
        error?: string;
      };
      if (!res.ok) {
        setError(j.error || 'Could not load your classes.');
        return;
      }
      setPrograms(j.programs ?? []);
      setClub(j.club ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** One PATCH, applied optimistically, with the change folded into `pending`. */
  const patch = useCallback(
    async (id: string, body: Record<string, unknown>, optimistic: Partial<Program>) => {
      setBusyId(id);
      setError(null);
      setPrograms((ps) => ps.map((p) => (p.id === id ? { ...p, ...optimistic } : p)));
      try {
        const res = await fetch(`/api/club-site/programs/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const j = (await res.json().catch(() => ({}))) as {
          error?: string;
          program?: Program;
          changes?: {
            dates_removed: string[];
            dates_restored: string[];
            price_changed: boolean;
            old_price_cents: number | null;
          };
          affected_registrations?: number;
        };
        if (!res.ok) {
          setError(j.error || 'Could not save.');
          // Put the server's truth back rather than leaving a lie on screen.
          await load();
          return;
        }
        if (j.program) {
          setPrograms((ps) =>
            ps.map((p) => (p.id === id ? { ...p, ...j.program!, counts: p.counts } : p)),
          );
        }
        setSaved(id);
        setTimeout(() => setSaved((s) => (s === id ? null : s)), 1600);

        const c = j.changes;
        const worthTelling =
          c && (c.dates_removed.length > 0 || c.dates_restored.length > 0 || c.price_changed);
        if (worthTelling && (j.affected_registrations ?? 0) > 0) {
          // Accumulate: two date clicks in a row are one announcement, not two.
          setPending((prev) => {
            const before = prev[id];
            return {
              ...prev,
              [id]: {
                dates_removed: [
                  ...new Set([...(before?.dates_removed ?? []), ...c!.dates_removed]),
                ].sort(),
                dates_restored: [
                  ...new Set([...(before?.dates_restored ?? []), ...c!.dates_restored]),
                ].sort(),
                price_changed: (before?.price_changed ?? false) || c!.price_changed,
                old_price_cents: before?.old_price_cents ?? c!.old_price_cents,
                price_cents: j.program?.price_cents ?? null,
              },
            };
          });
        }
      } catch {
        setError('Network problem — try again.');
        await load();
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  async function addClass() {
    // Sensible defaults: a ten-week Tuesday/Thursday afternoon class starting
    // next Monday. A director adjusts what is wrong rather than filling in a
    // blank form before they can see anything.
    const start = new Date();
    start.setDate(start.getDate() + ((8 - start.getDay()) % 7 || 7));
    const end = new Date(start);
    end.setDate(end.getDate() + 69);
    const ymd = (d: Date) => d.toISOString().slice(0, 10);

    setBusyId('new');
    try {
      const res = await fetch('/api/club-site/programs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'New class',
          range_start: ymd(start),
          range_end: ymd(end),
          days_of_week: [2, 4],
          time_start: '15:30',
          time_end: '17:00',
          status: 'draft',
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setError(j.error || 'Could not create the class.');
      else await load();
    } finally {
      setBusyId(null);
    }
  }

  async function duplicate(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/club-site/programs/${id}/duplicate`, { method: 'POST' });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setError(j.error || 'Could not copy it.');
      else await load();
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <p className="text-white/40">Loading your classes…</p>;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-white/50">
          Click a date to skip it. Change a price in the field. Both save as you go — and we&apos;ll
          offer to tell the families.
        </p>
        <button
          type="button"
          onClick={addClass}
          disabled={busyId !== null}
          className="rounded-lg bg-[#D3FB52] px-4 py-2 text-sm font-semibold text-[#001820] disabled:opacity-50"
        >
          {busyId === 'new' ? 'Adding…' : 'Add a class'}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}

      {programs.length === 0 && (
        <div className="mt-6 rounded-2xl border border-white/[0.08] bg-[#002838] p-8 text-center">
          <p className="text-white">No classes yet.</p>
          <p className="mt-2 text-sm text-white/50">
            Add one and it appears on your website with its real dates and a sign-up form.
          </p>
        </div>
      )}

      {/*
        The other email a club sends every season. Sits above the classes
        because it is a season-level job, not a per-class one.
      */}
      {programs.length > 0 && (
        <div className="mt-6">
          <PromotePanel timeZone={club?.timezone || 'America/Los_Angeles'} />
        </div>
      )}

      <div className="mt-6 space-y-4">
        {programs.map((p) => {
          const change = pending[p.id];
          const families = p.counts.enrolled + p.counts.waitlist;
          return (
            <div
              key={p.id}
              className="rounded-2xl border border-white/[0.08] bg-[#002838] p-5"
            >
              {/* ------------------------------------------------- header */}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={p.title}
                      onChange={(e) =>
                        setPrograms((ps) =>
                          ps.map((x) => (x.id === p.id ? { ...x, title: e.target.value } : x)),
                        )
                      }
                      onBlur={(e) => patch(p.id, { title: e.target.value }, {})}
                      style={{ color: '#ffffff' }}
                      className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-lg font-semibold hover:border-white/15 focus:border-[#D3FB52]/50 focus:outline-none"
                    />
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider ${
                        p.status === 'published'
                          ? 'bg-[#D3FB52]/15 text-[#D3FB52]'
                          : 'bg-white/10 text-white/50'
                      }`}
                    >
                      {p.status}
                    </span>
                  </div>
                  <div className="mt-1 px-1 text-sm text-white/40">
                    {daysLabel(p.days_of_week)}, {formatTimeRange(p.time_start, p.time_end)}
                    {p.coach_name ? ` · ${p.coach_name}` : ''}
                    {families > 0
                      ? ` · ${p.counts.enrolled} enrolled${p.counts.waitlist ? `, ${p.counts.waitlist} waiting` : ''}`
                      : ' · nobody signed up yet'}
                    {p.counts.unpaid > 0 ? ` · ${p.counts.unpaid} unpaid` : ''}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {saved === p.id && <span className="text-xs text-[#D3FB52]">Saved</span>}
                  <button
                    type="button"
                    onClick={() =>
                      patch(
                        p.id,
                        { status: p.status === 'published' ? 'draft' : 'published' },
                        { status: p.status === 'published' ? 'draft' : 'published' },
                      )
                    }
                    disabled={busyId === p.id}
                    className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-white/70 hover:text-white disabled:opacity-50"
                  >
                    {p.status === 'published' ? 'Unpublish' : 'Publish'}
                  </button>
                  <Link
                    href={`/run/site/classes/${p.id}`}
                    className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-white/70 hover:text-white"
                  >
                    Details &amp; roster
                  </Link>
                </div>
              </div>

              {/* -------------------------------------------------- prices */}
              <div className="mt-4 flex flex-wrap gap-4">
                {(
                  [
                    ['price_cents', 'Price'],
                    ['member_price_cents', 'Member'],
                    ['drop_in_price_cents', 'Drop-in'],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key}>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/40">
                      {label}
                    </label>
                    <div className="flex items-center gap-1">
                      <span className="text-white/40">$</span>
                      <input
                        inputMode="decimal"
                        defaultValue={
                          p[key] == null ? '' : String((p[key] as number) / 100)
                        }
                        onBlur={(e) => {
                          const raw = e.target.value.trim();
                          // Empty clears the optional prices; the main price
                          // falls back to 0, which renders as "Free".
                          if (raw === '') {
                            patch(p.id, { [key]: key === 'price_cents' ? 0 : null }, {});
                            return;
                          }
                          const cents = Math.round(parseFloat(raw) * 100);
                          if (!Number.isFinite(cents) || cents < 0) return;
                          if (cents === p[key]) return;
                          patch(p.id, { [key]: cents }, { [key]: cents } as Partial<Program>);
                        }}
                        style={{ color: '#ffffff' }}
                        className="w-20 rounded-lg border border-white/10 bg-[#001820] px-2 py-1.5 text-sm focus:border-[#D3FB52]/50 focus:outline-none"
                      />
                    </div>
                  </div>
                ))}
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/40">
                    Days
                  </label>
                  <div className="flex gap-1">
                    {DOW.map((name, dow) => {
                      const on = (p.days_of_week ?? []).includes(dow);
                      return (
                        <button
                          key={dow}
                          type="button"
                          onClick={() => {
                            const next = on
                              ? (p.days_of_week ?? []).filter((d) => d !== dow)
                              : [...(p.days_of_week ?? []), dow].sort((a, b) => a - b);
                            patch(p.id, { days_of_week: next }, { days_of_week: next });
                          }}
                          disabled={busyId === p.id}
                          aria-pressed={on}
                          className={`h-8 w-9 rounded-lg border text-xs font-medium disabled:opacity-50 ${
                            on
                              ? 'border-[#D3FB52]/50 bg-[#D3FB52]/15 text-white'
                              : 'border-white/10 text-white/35 hover:text-white/60'
                          }`}
                        >
                          {name.charAt(0)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* --------------------------------------------- the dates */}
              <div className="mt-5 border-t border-white/[0.06] pt-4">
                <SessionGrid
                  program={p}
                  timeZone={club?.timezone || 'America/Los_Angeles'}
                  busy={busyId === p.id}
                  onToggle={(exclusions) =>
                    patch(p.id, { exclusions }, { exclusions })
                  }
                />
              </div>

              {/* -------------------------------------------- tell them */}
              {change && families > 0 && (
                <NotifyPanel
                  programId={p.id}
                  families={families}
                  change={change}
                  summary={describe(change, club?.timezone || 'America/Los_Angeles')}
                  onDone={() =>
                    setPending((prev) => {
                      const next = { ...prev };
                      delete next[p.id];
                      return next;
                    })
                  }
                />
              )}

              {/* ------------------------------------------------ footer */}
              <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-white/[0.06] pt-3 text-xs">
                <button
                  type="button"
                  onClick={() => duplicate(p.id)}
                  disabled={busyId === p.id}
                  className="font-medium text-white/50 hover:text-white disabled:opacity-50"
                >
                  Copy for next season
                </button>
                {club && p.status === 'published' && (
                  <a
                    href={`/c/${club.slug}/programs/${p.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-white/50 hover:text-white"
                  >
                    View on your site ↗
                  </a>
                )}
                {!p.external_payment_url && p.price_cents > 0 && (
                  <span className="text-amber-300/80">
                    No payment link yet — add one under Details so parents can pay.
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

'use client';

/**
 * CourtConnect — the few pieces the board and the emailed-link page share.
 *
 * Light, large and plain on purpose: the first club using this is a 55+
 * community. Body text is 18px, every button is at least 56px tall, and every
 * action ends in a sentence saying what happened.
 */
import type { ReactNode } from 'react';
import { levelOptions, type LevelScale } from '@/lib/levels';

export const bigBtn =
  'inline-flex min-h-[56px] items-center justify-center gap-2 rounded-2xl px-6 text-xl font-bold transition disabled:opacity-60';
export const primaryBtn = `${bigBtn} bg-emerald-700 text-white hover:bg-emerald-800`;
export const secondaryBtn = `${bigBtn} border-2 border-slate-300 bg-white text-slate-800 hover:border-slate-400`;
export const dangerBtn = `${bigBtn} border-2 border-rose-300 bg-white text-rose-700 hover:border-rose-400`;

export function Notice({ tone, children }: { tone: 'good' | 'info' | 'bad'; children: ReactNode }) {
  const cls =
    tone === 'good'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
      : tone === 'bad'
        ? 'border-rose-300 bg-rose-50 text-rose-900'
        : 'border-slate-300 bg-slate-50 text-slate-800';
  return (
    <div role="status" className={`rounded-2xl border-2 px-5 py-4 text-lg leading-relaxed ${cls}`}>
      {children}
    </div>
  );
}

export function DetailRows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-lg">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-slate-500">{k}</dt>
          <dd className="font-semibold text-slate-900">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PeopleList({ people }: { people: { name: string; note?: string | null; phone?: string | null }[] }) {
  return (
    <ul className="space-y-2 text-lg">
      {people.map((p, i) => (
        <li key={`${p.name}-${i}`} className="flex flex-wrap items-baseline gap-x-3">
          <span className="font-semibold">{p.name}</span>
          {p.note && <span className="text-slate-500">{p.note}</span>}
          {p.phone && (
            <a href={`tel:${p.phone.replace(/[^0-9+]/g, '')}`} className="text-emerald-800 underline">
              {p.phone}
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Pick a level. The club's scale decides what the buttons say: NTRP numbers at
 * a tennis club, the club's own tier names where it plays by name — with the
 * band underneath in small type, because the name is the answer and the numbers
 * are only there for anyone who wants them. "Not sure" is a real answer and
 * saves nothing.
 */
export function LevelPicker({
  scale,
  value,
  onPick,
  busy,
  allowNotSure = false,
}: {
  scale: LevelScale;
  value: number | null;
  onPick: (n: number | null) => void;
  busy?: boolean;
  allowNotSure?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {levelOptions(scale).map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={busy}
          onClick={() => onPick(o.value)}
          aria-pressed={value === o.value}
          className={`min-h-[52px] min-w-[72px] rounded-xl border-2 px-4 py-2 text-xl font-bold transition ${
            value === o.value
              ? 'border-emerald-700 bg-emerald-700 text-white'
              : 'border-slate-300 bg-white text-slate-800 hover:border-emerald-600'
          }`}
        >
          {o.label}
          {o.band && (
            <span className={`block text-sm font-semibold ${value === o.value ? 'text-emerald-50' : 'text-slate-500'}`}>
              {o.band}
            </span>
          )}
        </button>
      ))}
      {allowNotSure && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onPick(null)}
          className="min-h-[52px] rounded-xl border-2 border-slate-300 bg-white px-4 text-lg font-semibold text-slate-700 hover:border-slate-400"
        >
          Not sure
        </button>
      )}
    </div>
  );
}

export async function postJson<T = Record<string, unknown>>(url: string, body: unknown): Promise<T & { error?: string }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok && !j.error) return { ...j, error: 'Something went wrong. Please try again.' };
    return j;
  } catch {
    return { error: 'We could not reach the club. Check your connection and try again.' } as T & { error?: string };
  }
}

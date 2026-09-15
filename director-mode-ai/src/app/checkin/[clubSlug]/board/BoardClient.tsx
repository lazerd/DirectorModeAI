'use client';

/**
 * The court board for a kiosk tablet or a clubhouse TV: every court, the wait
 * list in order, and the pool headcount. Readable from across a room, and
 * stacks into one column on a phone.
 */

import { useCallback, useEffect, useState } from 'react';
import type { boardView } from '@/lib/checkin/views';
import { clock, PLAY_LABEL } from '@/lib/checkin/client';

type Board = ReturnType<typeof boardView>;

const STATE: Record<string, { label: string; bg: string; fg: string }> = {
  free: { label: 'Free', bg: '#0f7a45', fg: '#fff' },
  playing: { label: 'In play', bg: '#0f5f6b', fg: '#fff' },
  overtime: { label: 'Time up', bg: '#b45309', fg: '#fff' },
  held: { label: 'Held for next group', bg: '#6d28d9', fg: '#fff' },
  blocked: { label: 'Booked', bg: '#475569', fg: '#fff' },
  closed: { label: 'Closed', bg: '#334155', fg: '#cbd5e1' },
};

export default function BoardClient({ slug }: { slug: string }) {
  const [data, setData] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/checkin/board/${slug}`, { cache: 'no-store' });
      const j = await res.json();
      if (!res.ok) setError(j.error || 'Board unavailable.');
      else {
        setData(j);
        setError(null);
      }
    } catch {
      // Keep showing the last board through a Wi-Fi blip.
    }
  }, [slug]);

  useEffect(() => {
    load();
    const poll = setInterval(load, 10_000);
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => {
      clearInterval(poll);
      clearInterval(t);
    };
  }, [load]);

  if (error && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-2xl" style={{ background: '#0b1416', color: '#e2e8f0' }}>
        {error}
      </div>
    );
  }
  if (!data) {
    return <div className="min-h-screen" style={{ background: '#0b1416' }} />;
  }

  const tz = data.club.timezone;
  const waiting = data.queue.filter((q) => q.status === 'waiting');
  const offered = data.queue.filter((q) => q.status === 'offered');

  return (
    <div className="min-h-screen w-full" style={{ background: '#0b1416', color: '#f1f5f9' }}>
      <div className="mx-auto max-w-[1600px] px-4 py-5 md:px-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {data.club.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.club.logoUrl} alt="" className="h-12 w-12 rounded-lg bg-white object-contain p-1" />
            ) : null}
            <div>
              <div className="text-[26px] font-extrabold leading-tight md:text-[34px]">{data.club.name}</div>
              <div className="text-[17px] text-slate-400">Courts right now</div>
            </div>
          </div>
          <div className="text-[34px] font-bold tabular-nums md:text-[44px]">{clock(new Date().toISOString(), tz)}</div>
        </header>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {data.courts.map((c) => {
              const s = STATE[c.state];
              return (
                <div key={c.id} className="rounded-2xl p-4" style={{ background: s.bg, color: s.fg, minHeight: 150 }}>
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="text-[28px] font-extrabold">{c.name}</div>
                    <div className="text-[17px] font-bold uppercase tracking-wide opacity-90">{s.label}</div>
                  </div>
                  <div className="mt-2 text-[19px] leading-snug">
                    {c.state === 'free' ? 'Scan the sign to start' : null}
                    {c.state === 'playing' || c.state === 'overtime' ? (
                      <>
                        <div className="font-semibold">{c.players}</div>
                        <div className="opacity-90">
                          {PLAY_LABEL[c.playType ?? 'other']} · {c.limitActive && c.until ? `until ${clock(c.until, tz)}` : 'no one waiting'}
                        </div>
                      </>
                    ) : null}
                    {c.state === 'held' ? (
                      <>
                        <div className="font-semibold">{c.heldFor}</div>
                        <div className="opacity-90">start by {clock(c.heldUntil, tz)}</div>
                      </>
                    ) : null}
                    {c.state === 'blocked' ? `Booked for ${c.blockLabel ?? 'club use'} until ${clock(c.until, tz)}` : null}
                  </div>
                </div>
              );
            })}
          </section>

          <aside>
            <div className="rounded-2xl p-5" style={{ background: '#132126' }}>
              <div className="flex items-baseline justify-between">
                <h2 className="text-[26px] font-extrabold">Wait list</h2>
                <div className="text-[19px] text-slate-400">{waiting.length} waiting</div>
              </div>
              {offered.map((q, i) => (
                <div key={`o${i}`} className="mt-3 rounded-xl p-3" style={{ background: '#6d28d9' }}>
                  <div className="text-[20px] font-bold">{q.offeredSpace} → {q.names}</div>
                  <div className="text-[17px] opacity-90">start by {clock(q.offerExpiresAt, tz)}</div>
                </div>
              ))}
              {waiting.length === 0 && offered.length === 0 ? (
                <p className="mt-3 text-[19px] text-slate-400">No one waiting. Scan a free court to play.</p>
              ) : null}
              <ol className="mt-2">
                {waiting.map((q, i) => (
                  <li key={i} className="flex items-baseline gap-3 border-t border-white/10 py-3 first:border-t-0">
                    <span className="w-8 text-[24px] font-extrabold text-slate-400">{q.position}</span>
                    <span className="flex-1">
                      <span className="block text-[20px] font-semibold">{q.names}</span>
                      <span className="text-[16px] text-slate-400">
                        {PLAY_LABEL[q.playType]} · since {clock(q.joinedAt, tz)}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            {data.pools.map((p) => (
              <div key={p.id} className="mt-4 rounded-2xl p-5" style={{ background: '#132126' }}>
                <div className="text-[22px] font-bold">{p.name}</div>
                <div className="mt-1 text-[44px] font-extrabold leading-none tabular-nums">
                  {p.headcount}
                  {p.capacity !== null ? <span className="text-[24px] text-slate-400"> / {p.capacity}</span> : null}
                </div>
                <div className="text-[16px] text-slate-400">checked in now</div>
              </div>
            ))}
          </aside>
        </div>
      </div>
    </div>
  );
}

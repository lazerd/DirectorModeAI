'use client';

/**
 * /open/[slug] — the club's lesson booking page.
 *
 * Everything on it came off the instructors' own Google Calendars: they write
 * "Open Lesson Time" on a Tuesday afternoon and it appears here. The client
 * picks a length first, because that is the question they actually have in
 * mind ("can I get an hour on Saturday?"), and only the start times that fit
 * that length are offered.
 *
 * No login, no account, no app — a login is the thing that stops someone
 * booking a lesson from a car park.
 *
 * PAINTS ITS OWN LIGHT BACKGROUND: the app shell sets a dark navy body, and a
 * client-facing page that inherits it renders near-black text on navy.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { CalendarDays, Check, Clock, Loader2, MapPin, User } from 'lucide-react';
import { candidateStarts, freeSegments, type Range } from '@/lib/lessons/openMath';

const INPUT: React.CSSProperties = { color: '#0f172a', backgroundColor: '#ffffff' };

type Coach = {
  id: string;
  name: string;
  rate_note: string | null;
  durations: number[];
  earliest: string;
  timezone: string;
};
type Window = { coach_id: string; start_time: string; end_time: string; location: string | null };
type Busy = { coach_id: string; start_time: string; end_time: string };
type Payload = { title: string; note: string | null; coaches: Coach[]; windows: Window[]; busy: Busy[] };

type Offer = { coach: Coach; start: string; end: string; location: string | null };

export default function OpenLessonsPage() {
  const slug = useParams()?.slug as string;
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [duration, setDuration] = useState<number>(60);
  const [coachFilter, setCoachFilter] = useState<string>('all');
  const [picked, setPicked] = useState<Offer | null>(null);
  const [booking, setBooking] = useState(false);
  const [booked, setBooked] = useState<{ when: string; duration: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    const res = await fetch(`/api/lessons/open?slug=${encodeURIComponent(slug)}`, { cache: 'no-store' });
    if (res.status === 404) {
      setMissing(true);
      setLoading(false);
      return;
    }
    setData((await res.json()) as Payload);
    setLoading(false);
  }, [slug]);

  useEffect(() => {
    if (slug) load();
  }, [slug, load]);

  const tz = data?.coaches[0]?.timezone || 'America/Los_Angeles';
  const fmt = (isoStr: string, o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { ...o, timeZone: tz }).format(new Date(isoStr));

  /**
   * Every bookable start, computed in the browser so switching between 30 / 60
   * / 90 minutes is instant. The server re-checks all of it before writing —
   * this copy is for the eyes, not for the truth.
   */
  const offers = useMemo<Offer[]>(() => {
    if (!data) return [];
    const out: Offer[] = [];
    for (const coach of data.coaches) {
      if (coachFilter !== 'all' && coachFilter !== coach.id) continue;
      if (!coach.durations.includes(duration)) continue;
      const busy = data.busy
        .filter((b) => b.coach_id === coach.id)
        .map((b): Range => ({ start: b.start_time, end: b.end_time }));
      for (const w of data.windows.filter((x) => x.coach_id === coach.id)) {
        const free = freeSegments({ start: w.start_time, end: w.end_time }, busy);
        for (const start of candidateStarts(free, duration, { notBefore: coach.earliest })) {
          out.push({
            coach,
            start,
            end: new Date(new Date(start).getTime() + duration * 60_000).toISOString(),
            location: w.location,
          });
        }
      }
    }
    return out.sort((a, b) => a.start.localeCompare(b.start) || a.coach.name.localeCompare(b.coach.name));
  }, [data, duration, coachFilter]);

  /** Which lengths are bookable anywhere right now — the rest are greyed out. */
  const availableDurations = useMemo(() => {
    const set = new Set<number>();
    for (const c of data?.coaches || []) for (const d of c.durations) set.add(d);
    return [...set].sort((a, b) => a - b);
  }, [data]);

  const days = useMemo(() => {
    const out: { label: string; offers: Offer[] }[] = [];
    for (const o of offers) {
      const label = fmt(o.start, { weekday: 'long', month: 'long', day: 'numeric' });
      if (!out.length || out[out.length - 1].label !== label) out.push({ label, offers: [] });
      out[out.length - 1].offers.push(o);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offers, tz]);

  const book = async () => {
    if (!picked) return;
    setBooking(true);
    setError(null);
    try {
      const res = await fetch('/api/lessons/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          coach_id: picked.coach.id,
          start: picked.start,
          duration_minutes: duration,
          name,
          email,
          phone,
          note,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (j.code === 'taken') {
          setPicked(null);
          await load(); // somebody got there first — show what is actually left
        }
        throw new Error(j.error || 'That booking did not go through.');
      }
      setBooked({ when: j.when as string, duration: j.duration as number });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That booking did not go through.');
    } finally {
      setBooking(false);
    }
  };

  return (
    <div style={{ background: '#f1f5f9', minHeight: '100vh' }}>
      <div style={{ maxWidth: 620, margin: '0 auto', padding: '28px 18px 60px' }}>
        {loading ? (
          <p className="flex items-center gap-2 text-slate-500">
            <Loader2 size={16} className="animate-spin" /> Loading open lesson times…
          </p>
        ) : missing ? (
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h1 className="text-lg font-semibold text-slate-900">Nothing here</h1>
            <p className="mt-2 text-[15px] text-slate-600">
              This booking page isn&apos;t open. Check the link with your club.
            </p>
          </div>
        ) : booked ? (
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2 text-emerald-600">
              <Check size={20} />
              <h1 className="text-lg font-semibold">You&apos;re on court</h1>
            </div>
            <p className="mt-3 text-[17px] font-semibold text-slate-900">{booked.when}</p>
            <p className="mt-1 text-[15px] text-slate-600">
              {booked.duration} minutes with {picked?.coach.name}
            </p>
            <p className="mt-3 text-[15px] leading-relaxed text-slate-600">
              It&apos;s on their calendar already and a confirmation is on its way to {email}. Need to
              change it? Just reply to that email.
            </p>
          </div>
        ) : (
          <>
            <h1 className="text-[26px] font-bold leading-tight tracking-tight text-slate-900">
              Book a lesson at {data?.title}
            </h1>
            <p className="mt-2 text-[15px] leading-relaxed text-slate-600">
              {data?.note ||
                'These are the times our instructors have open right now. Pick a length, pick a time — no account needed.'}
            </p>

            {/* 1. How long. Asked first because it is the question in their head. */}
            <div className="mt-6 rounded-2xl bg-white p-4 shadow-sm">
              <p className="text-[13px] font-semibold uppercase tracking-wider text-slate-500">
                1 · How long?
              </p>
              <div className="mt-3 flex gap-2">
                {[30, 60, 90].map((d) => {
                  const offered = availableDurations.includes(d);
                  return (
                    <button
                      key={d}
                      onClick={() => {
                        setDuration(d);
                        setPicked(null);
                      }}
                      disabled={!offered}
                      className={`flex-1 rounded-xl border px-3 py-3 text-[15px] font-semibold transition-colors ${
                        duration === d
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : offered
                            ? 'border-slate-300 bg-white text-slate-700 hover:border-slate-500'
                            : 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-300'
                      }`}
                    >
                      {d} min
                    </button>
                  );
                })}
              </div>

              {(data?.coaches.length ?? 0) > 1 && (
                <>
                  <p className="mt-5 text-[13px] font-semibold uppercase tracking-wider text-slate-500">
                    Who with?
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Chip active={coachFilter === 'all'} onClick={() => setCoachFilter('all')}>
                      Anyone
                    </Chip>
                    {data?.coaches.map((c) => (
                      <Chip key={c.id} active={coachFilter === c.id} onClick={() => setCoachFilter(c.id)}>
                        {c.name}
                      </Chip>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* 2. When. */}
            <p className="mt-7 text-[13px] font-semibold uppercase tracking-wider text-slate-500">
              2 · Pick a time
            </p>

            {!days.length && (
              <div className="mt-3 rounded-2xl bg-white p-6 text-[15px] leading-relaxed text-slate-600 shadow-sm">
                No {duration}-minute slots open right now.{' '}
                {availableDurations.length > 1 && 'Try a different length, or check back soon — '}
                times appear here the moment an instructor opens one up.
              </div>
            )}

            <div className="mt-3 space-y-5">
              {days.map((d) => (
                <div key={d.label}>
                  <p className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-700">
                    <CalendarDays size={13} /> {d.label}
                  </p>
                  <div className="mt-2 space-y-2">
                    {d.offers.map((o) => {
                      const open = picked?.start === o.start && picked?.coach.id === o.coach.id;
                      return (
                        <div
                          key={`${o.coach.id}-${o.start}`}
                          className={`overflow-hidden rounded-xl border bg-white shadow-sm transition-colors ${
                            open ? 'border-slate-900' : 'border-slate-200'
                          }`}
                        >
                          <button
                            onClick={() => setPicked(open ? null : o)}
                            className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
                          >
                            <Clock size={16} className="shrink-0 text-slate-400" />
                            <span className="text-[16px] font-semibold text-slate-900">
                              {fmt(o.start, { hour: 'numeric', minute: '2-digit' })}
                              <span className="font-normal text-slate-400">
                                {' '}
                                – {fmt(o.end, { hour: 'numeric', minute: '2-digit' })}
                              </span>
                            </span>
                            <span className="ml-auto flex items-center gap-1.5 text-[13px] text-slate-500">
                              <User size={12} /> {o.coach.name}
                            </span>
                          </button>

                          {open && (
                            <div className="border-t border-slate-100 px-4 py-4">
                              <p className="mb-3 flex flex-wrap gap-x-3 text-[13px] text-slate-500">
                                <span>
                                  {duration} min with {o.coach.name}
                                </span>
                                {o.coach.rate_note && <span>{o.coach.rate_note}</span>}
                                {o.location && (
                                  <span className="inline-flex items-center gap-1">
                                    <MapPin size={12} /> {o.location}
                                  </span>
                                )}
                              </p>
                              <div className="grid gap-2 sm:grid-cols-2">
                                <input
                                  value={name}
                                  onChange={(e) => setName(e.target.value)}
                                  placeholder="Your name"
                                  autoComplete="name"
                                  style={INPUT}
                                  className="rounded-lg border border-slate-300 px-3 py-2.5 text-[15px] outline-none focus:border-slate-500"
                                />
                                <input
                                  value={email}
                                  onChange={(e) => setEmail(e.target.value)}
                                  placeholder="Email"
                                  type="email"
                                  autoComplete="email"
                                  style={INPUT}
                                  className="rounded-lg border border-slate-300 px-3 py-2.5 text-[15px] outline-none focus:border-slate-500"
                                />
                                <input
                                  value={phone}
                                  onChange={(e) => setPhone(e.target.value)}
                                  placeholder="Mobile (optional)"
                                  type="tel"
                                  autoComplete="tel"
                                  style={INPUT}
                                  className="rounded-lg border border-slate-300 px-3 py-2.5 text-[15px] outline-none focus:border-slate-500"
                                />
                                <input
                                  value={note}
                                  onChange={(e) => setNote(e.target.value)}
                                  placeholder="Anything to work on? (optional)"
                                  style={INPUT}
                                  className="rounded-lg border border-slate-300 px-3 py-2.5 text-[15px] outline-none focus:border-slate-500"
                                />
                              </div>
                              <button
                                onClick={book}
                                disabled={booking}
                                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-5 py-3 text-[15px] font-semibold text-white disabled:opacity-50"
                              >
                                {booking ? <Loader2 size={15} className="animate-spin" /> : null}
                                Book {duration} min at {fmt(o.start, { hour: 'numeric', minute: '2-digit' })}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {error && (
              <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-[14px] text-red-700">
                {error}
              </p>
            )}
            <p className="mt-8 text-center text-[12px] text-slate-400">
              Times shown in {tz.split('/')[1]?.replace('_', ' ')} time.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3.5 py-1.5 text-[13.5px] font-medium transition-colors ${
        active
          ? 'border-slate-900 bg-slate-900 text-white'
          : 'border-slate-300 bg-white text-slate-600 hover:border-slate-500'
      }`}
    >
      {children}
    </button>
  );
}

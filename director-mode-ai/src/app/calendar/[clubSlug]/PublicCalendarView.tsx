'use client';

import { useMemo, useState } from 'react';
import { CalendarDays, CalendarPlus, Check, ChevronDown } from 'lucide-react';

// What members see. One column, month by month, no jargon and no admin.
//
// The subscribe button is the point: a member who adds the feed once gets every
// event on their phone, including anything the director adds later. That is
// worth far more to attendance than a page they have to remember to revisit.

type Item = {
  id: string; title: string; blurb: string | null; department: string;
  audience: string[] | null; target_date: string; target_end_date: string | null;
  start_time: string | null; duration_minutes: number | null;
  entry_fee_cents: number | null; event_id: string | null;
};

const DEPT_COLOR: Record<string, string> = {
  tennis: '#eab308', pickleball: '#22d3ee', swim: '#38bdf8',
  fitness: '#a78bfa', social: '#fb923c', other: '#94a3b8',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export default function PublicCalendarView({
  club, year, published, items,
}: {
  club: { name: string; slug: string; logo_url: string | null; website: string | null };
  year: number;
  published: boolean;
  items: Item[];
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const byMonth = useMemo(() => {
    const m = new Map<number, Item[]>();
    for (const i of items) {
      const k = Number(i.target_date.slice(5, 7));
      const arr = m.get(k);
      if (arr) arr.push(i); else m.set(k, [i]);
    }
    return m;
  }, [items]);

  const feedUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/calendar/public/${club.slug}?year=${year}&format=ics`
    : '';

  async function subscribe() {
    try {
      await navigator.clipboard.writeText(feedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.open(feedUrl, '_blank');
    }
  }

  return (
    <div className="min-h-screen" style={{ background: '#001820', color: '#e6f0f3' }}>
      <header className="border-b" style={{ borderColor: '#0d3d4d' }}>
        <div className="max-w-3xl mx-auto px-5 py-8 text-center">
          {club.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={club.logo_url} alt="" className="h-14 mx-auto mb-4 object-contain" />
          )}
          <h1 className="text-2xl sm:text-3xl font-bold">{club.name}</h1>
          <p className="opacity-60 mt-1">{year} Events</p>

          {published && items.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-2 justify-center">
              <button onClick={subscribe}
                      className="px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2"
                      style={{ background: '#D3FB52', color: '#001820' }}>
                {copied ? <Check className="w-4 h-4" /> : <CalendarPlus className="w-4 h-4" />}
                {copied ? 'Link copied — paste it into your calendar app' : 'Add to my calendar'}
              </button>
              <a href={`/api/calendar/public/${club.slug}?year=${year}&format=ics`}
                 className="px-4 py-2 rounded-lg text-sm border flex items-center gap-2"
                 style={{ borderColor: '#0d3d4d', color: '#e6f0f3' }}>
                <CalendarDays className="w-4 h-4" /> Download .ics
              </a>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 py-8">
        {!published || items.length === 0 ? (
          <div className="text-center py-16 opacity-60">
            <CalendarDays className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p>The {year} calendar hasn&apos;t been published yet.</p>
            <p className="text-sm mt-1">Check back soon.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {MONTHS.map((name, mi) => {
              const monthItems = byMonth.get(mi + 1);
              if (!monthItems?.length) return null;
              return (
                <section key={name}>
                  <h2 className="text-sm uppercase tracking-widest opacity-50 mb-3">{name}</h2>
                  <div className="space-y-2">
                    {monthItems.map((i) => {
                      const color = DEPT_COLOR[i.department] ?? DEPT_COLOR.other;
                      const isOpen = open === i.id;
                      return (
                        <div key={i.id} className="rounded-xl border overflow-hidden"
                             style={{ background: '#002838', borderColor: '#0d3d4d' }}>
                          <button onClick={() => setOpen(isOpen ? null : i.id)}
                                  className="w-full text-left p-4 flex items-start gap-4">
                            <div className="text-center shrink-0 w-12">
                              <div className="text-xs uppercase opacity-50">{dow(i.target_date)}</div>
                              <div className="text-xl font-bold" style={{ color }}>
                                {Number(i.target_date.slice(8, 10))}
                              </div>
                            </div>
                            <div className="flex-1 min-w-0">
                              <h3 className="font-semibold leading-tight">{i.title}</h3>
                              <div className="text-xs opacity-60 mt-1 flex flex-wrap gap-x-3">
                                {i.start_time && <span>{time12(i.start_time)}</span>}
                                {i.target_end_date && i.target_end_date !== i.target_date && (
                                  <span>through {Number(i.target_end_date.slice(8, 10))} {MONTHS[Number(i.target_end_date.slice(5, 7)) - 1].slice(0, 3)}</span>
                                )}
                                {i.audience?.length ? <span className="capitalize">{i.audience.join(', ')}</span> : null}
                                <span>{i.entry_fee_cents ? `$${(i.entry_fee_cents / 100).toFixed(0)}` : 'Free'}</span>
                              </div>
                            </div>
                            {i.blurb && (
                              <ChevronDown className="w-4 h-4 opacity-40 shrink-0 mt-1 transition-transform"
                                           style={{ transform: isOpen ? 'rotate(180deg)' : undefined }} />
                            )}
                          </button>
                          {isOpen && i.blurb && (
                            <div className="px-4 pb-4 pl-[4.5rem] text-sm opacity-80">{i.blurb}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </main>

      <footer className="max-w-3xl mx-auto px-5 pb-10 text-center text-xs opacity-40">
        {club.website && (
          <a href={club.website} target="_blank" rel="noreferrer" className="underline">{club.name}</a>
        )}
        <div className="mt-1">Calendar by ClubMode</div>
      </footer>
    </div>
  );
}

function dow(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function time12(t: string): string {
  const [h, m] = t.slice(0, 5).split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour}${suffix}` : `${hour}:${String(m).padStart(2, '0')}${suffix}`;
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Printer, Loader2 } from 'lucide-react';

// The board packet — the artefact a director takes into the meeting where the
// calendar gets approved.
//
// Deliberately light-on-white and print-first: this is the one CalendarMode
// surface that leaves the screen, and a dark-luxury dashboard prints as a black
// rectangle. Numbers come from the same summarizePlan() the year grid uses, so
// the board is never shown different figures from the working tool.

type Item = {
  id: string; title: string; department: string; audience: string[] | null;
  target_date: string | null; target_end_date: string | null; status: string;
  expected_attendance: number | null; entry_fee_cents: number | null;
  expected_revenue_cents: number | null; expected_cost_cents: number | null;
  staff_needed: number | null; courts_needed: number | null; description: string | null;
};

type Summary = {
  total: number; byMonth: number[]; byDepartment: Record<string, number>;
  byAudience: Record<string, number>; projectedRevenueCents: number;
  flagshipCount: number; emptyMonths: number[]; crowdedWeeks: number;
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const DEPT_COLOR: Record<string, string> = {
  tennis: '#ca8a04', pickleball: '#0891b2', swim: '#0284c7',
  fitness: '#7c3aed', social: '#ea580c', other: '#64748b',
};

export default function BoardPacket() {
  const params = useSearchParams();
  const [year, setYear] = useState(Number(params.get('year')) || new Date().getFullYear() + 1);
  const [items, setItems] = useState<Item[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [club, setClub] = useState<{ name: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await fetch(`/api/calendar/plan?year=${year}`, { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        setItems((json.items ?? []).filter((i: Item) => i.target_date && i.status !== 'dropped'));
        setSummary(json.summary);
        setClub(json.club);
      }
      setLoading(false);
    })();
  }, [year]);

  const revenue = summary ? Math.round(summary.projectedRevenueCents / 100) : 0;
  const staffDays = items.reduce((n, i) => n + (i.staff_needed ?? 0), 0);
  const attendance = items.reduce((n, i) => n + (i.expected_attendance ?? 0), 0);
  const maxMonth = summary ? Math.max(1, ...summary.byMonth) : 1;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* toolbar — hidden when printing */}
      <div className="print:hidden border-b border-slate-200 sticky top-0 bg-white z-10">
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center gap-3">
          <Link href="/calendar" className="text-slate-500 hover:text-slate-900">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="font-semibold mr-auto">Board packet</h1>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}
                  className="px-2 py-1.5 rounded-lg text-sm border border-slate-300"
                  style={{ color: '#0f172a' }}>
            {[year - 1, year, year + 1].filter((v, i, a) => a.indexOf(v) === i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button onClick={() => window.print()}
                  className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-slate-900 text-white flex items-center gap-1.5">
            <Printer className="w-4 h-4" /> Print
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 print:py-2">
        <header className="mb-8">
          <h1 className="text-3xl font-bold">{club?.name ?? 'Club'} — {year} Event Calendar</h1>
          <p className="text-slate-500 mt-1">Proposed programme for board review</p>
        </header>

        {/* headline numbers */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <Stat label="Events" value={String(summary?.total ?? 0)} />
          <Stat label="Flagship events" value={String(summary?.flagshipCount ?? 0)} />
          <Stat label="Projected revenue" value={`$${revenue.toLocaleString()}`} />
          <Stat label="Expected participation" value={attendance.toLocaleString()} />
        </section>

        {/* month distribution */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">Spread across the year</h2>
          <div className="flex items-end gap-1.5 h-28">
            {(summary?.byMonth ?? []).map((n, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full rounded-t"
                     style={{ height: `${(n / maxMonth) * 100}%`, minHeight: n > 0 ? 4 : 1,
                              background: n > 0 ? '#0f172a' : '#e2e8f0' }} />
                <span className="text-[10px] text-slate-500">{MONTHS[i].slice(0, 1)}</span>
              </div>
            ))}
          </div>
          {summary && summary.emptyMonths.length > 0 && (
            <p className="text-sm text-amber-700 mt-2">
              No events currently planned in {summary.emptyMonths.map((m) => MONTHS[m - 1]).join(', ')}.
            </p>
          )}
        </section>

        {/* mix */}
        <section className="grid sm:grid-cols-2 gap-6 mb-8">
          <Breakdown title="By department" data={summary?.byDepartment ?? {}} colored />
          <Breakdown title="By audience" data={summary?.byAudience ?? {}} />
        </section>

        {/* the calendar itself */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">The calendar</h2>
          {MONTHS.map((m, mi) => {
            const monthItems = items
              .filter((i) => Number(i.target_date!.slice(5, 7)) === mi + 1)
              .sort((a, b) => (a.target_date! < b.target_date! ? -1 : 1));
            if (monthItems.length === 0) return null;
            return (
              <div key={m} className="mb-4 break-inside-avoid">
                <h3 className="font-semibold text-slate-700 border-b border-slate-200 pb-1 mb-2">{m}</h3>
                <table className="w-full text-sm">
                  <tbody>
                    {monthItems.map((i) => (
                      <tr key={i.id} className="border-b border-slate-100 last:border-0">
                        <td className="py-1.5 pr-3 w-24 text-slate-500 whitespace-nowrap align-top">
                          {dayLabel(i.target_date!)}
                          {i.target_end_date && i.target_end_date !== i.target_date &&
                            `–${Number(i.target_end_date.slice(8, 10))}`}
                        </td>
                        <td className="py-1.5 pr-3 align-top">
                          <span className="font-medium">{i.title}</span>
                          <span className="inline-block w-2 h-2 rounded-full ml-2 align-middle"
                                style={{ background: DEPT_COLOR[i.department] ?? DEPT_COLOR.other }}
                                title={i.department} />
                          {i.audience?.length ? (
                            <span className="text-slate-500 text-xs ml-2">{i.audience.join(', ')}</span>
                          ) : null}
                        </td>
                        <td className="py-1.5 text-right text-slate-500 whitespace-nowrap align-top">
                          {i.expected_attendance ? `${i.expected_attendance} ppl` : ''}
                          {i.expected_revenue_cents
                            ? ` · $${Math.round(i.expected_revenue_cents / 100).toLocaleString()}` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </section>

        <section className="text-sm text-slate-600 border-t border-slate-200 pt-4">
          <h2 className="font-semibold text-slate-900 mb-2">Notes for the board</h2>
          <ul className="space-y-1 list-disc pl-5">
            <li>
              Dates were placed against the imported school and club calendars, court availability,
              holiday travel patterns and typical weather for the club's location.
            </li>
            <li>
              Projected revenue assumes typical attendance at the stated entry fee. It excludes food and
              beverage unless the event's fee already includes it.
            </li>
            <li>Approximately {staffDays} staff assignments across the year.</li>
            {summary && summary.crowdedWeeks > 0 && (
              <li>{summary.crowdedWeeks} weekend{summary.crowdedWeeks === 1 ? '' : 's'} carry more than one event.</li>
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-slate-200 rounded-lg p-3">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
    </div>
  );
}

function Breakdown({ title, data, colored }: {
  title: string; data: Record<string, number>; colored?: boolean;
}) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((n, [, v]) => n + v, 0) || 1;
  return (
    <div>
      <h2 className="text-lg font-semibold mb-3">{title}</h2>
      {entries.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing scheduled yet.</p>
      ) : (
        <div className="space-y-1.5">
          {entries.map(([k, v]) => (
            <div key={k} className="flex items-center gap-2 text-sm">
              <span className="w-24 capitalize text-slate-600">{k}</span>
              <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full"
                     style={{ width: `${(v / total) * 100}%`,
                              background: colored ? DEPT_COLOR[k] ?? DEPT_COLOR.other : '#0f172a' }} />
              </div>
              <span className="w-6 text-right text-slate-500">{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function dayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow]} ${d}`;
}

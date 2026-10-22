'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, MapPin, CalendarClock, Briefcase, ShieldCheck, Search } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type Job = {
  id: string; club_name: string | null; title: string | null; dept: string;
  comp_min: number | null; comp_max: number | null; city: string | null; state: string | null; zip: string | null;
  deadline: string | null; description: string | null; requirements: string | null; created_at: string;
};

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
const compBand = (j: { comp_min: number | null; comp_max: number | null }) =>
  j.comp_max ? (j.comp_min ? `${usd(j.comp_min)}–${usd(j.comp_max)}` : `Up to ${usd(j.comp_max)}`) : null;
const fmtDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export default function JobBoardPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState('');
  const [state, setState] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/connect/jobs');
        if (!res.ok) throw new Error();
        setJobs((await res.json()).jobs || []);
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const states = useMemo(
    () => Array.from(new Set(jobs.map((j) => (j.state || '').toUpperCase()).filter(Boolean))).sort(),
    [jobs],
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return jobs.filter((j) => {
      if (state && (j.state || '').toUpperCase() !== state) return false;
      if (!needle) return true;
      return [j.club_name, j.title, j.dept, j.city, j.state, j.description, j.requirements]
        .some((f) => (f || '').toLowerCase().includes(needle));
    });
  }, [jobs, q, state]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <Link href="/connect" className="text-sm text-teal-400 underline">← ClubMode Recruiting</Link>
      <h1 className="text-3xl font-bold tracking-tight text-white mt-2 mb-1">Racquets director jobs</h1>
      <p className="text-slate-300 mb-5">Director of Tennis, Racquets and Pickleball openings at clubs hiring now.</p>

      <div className="mb-6 rounded-xl border border-teal-300 bg-teal-50 p-4 flex items-start gap-3">
        <ShieldCheck className="h-5 w-5 text-teal-700 shrink-0 mt-0.5" />
        <div className="text-sm text-teal-900">
          <strong>Applying is free.</strong> Your contact details go only to clubs you apply to.{' '}
          <Link href="/connect/candidate" className="underline">Set up your profile and résumé</Link> once, then apply in one click.
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-6">
        <div className="relative flex-1">
          <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search club, title, city…"
            className="pl-9" style={{ color: '#0f172a' }}
          />
        </div>
        <select
          value={state} onChange={(e) => setState(e.target.value)}
          className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"
          aria-label="Filter by state"
        >
          <option value="">All states</option>
          {states.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="py-16 text-center text-slate-300"><Loader2 className="h-5 w-5 animate-spin inline" /> Loading jobs…</div>
      ) : failed ? (
        <p className="text-slate-300">Couldn&apos;t load jobs right now. Please refresh.</p>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-slate-700 p-8 text-center">
          <Briefcase className="h-6 w-6 text-slate-400 mx-auto mb-2" />
          <p className="text-slate-200 font-medium">
            {jobs.length === 0 ? 'No open jobs right now.' : 'No jobs match those filters.'}
          </p>
          <p className="text-sm text-slate-400 mt-1">
            {jobs.length === 0
              ? <>Create your <Link href="/connect/candidate" className="text-teal-400 underline">candidate profile</Link> and clubs can invite you when they start hiring.</>
              : <button className="text-teal-400 underline" onClick={() => { setQ(''); setState(''); }}>Clear filters</button>}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {shown.map((j) => {
            const band = compBand(j);
            const place = [j.city, j.state].filter(Boolean).join(', ');
            return (
              <Link key={j.id} href={`/connect/jobs/${j.id}`} className="block">
                <Card className="bg-white hover:shadow-md transition-shadow">
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm text-slate-500">{j.club_name || 'A private club'}</div>
                        <div className="font-semibold text-slate-900">{j.title || j.dept}</div>
                      </div>
                      {band && (
                        <span className="shrink-0 text-xs font-medium rounded-full px-2 py-1 bg-emerald-100 text-emerald-800">{band}</span>
                      )}
                    </div>
                    <div className="mt-1.5 text-xs text-slate-500 flex flex-wrap gap-x-3 gap-y-1">
                      {place && <span><MapPin className="h-3 w-3 inline" /> {place}</span>}
                      {j.deadline && <span><CalendarClock className="h-3 w-3 inline" /> Apply by {fmtDate(j.deadline)}</span>}
                    </div>
                    {j.description && <p className="mt-2 text-sm text-slate-700 line-clamp-2">{j.description}</p>}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

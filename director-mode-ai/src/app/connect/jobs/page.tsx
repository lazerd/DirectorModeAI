'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, MapPin, CalendarClock, Briefcase, ShieldCheck, Search, Globe } from 'lucide-react';
import { sourceLabel } from '@/lib/connect/scout/labels';
import { JOB_BOARD_ONLY_HINT, JOB_BOARD_ONLY_LABEL } from '@/lib/connect/feeScope';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type Job = {
  id: string; club_name: string | null; title: string | null; dept: string;
  comp_min: number | null; comp_max: number | null; city: string | null; state: string | null; zip: string | null;
  deadline: string | null; description: string | null; requirements: string | null; created_at: string;
  fee_eligible?: boolean;
};
// A job the Scout found on a public board (id is "s-<uuid>").
type SourcedJob = {
  id: string; source: string; source_url: string; club_name: string | null; title: string | null; dept: string;
  role_level: string | null; city: string | null; state: string | null;
  comp_min: number | null; comp_max: number | null; comp_text: string | null; est_comp: number | null;
  summary: string | null; requirements: string | null; deadline: string | null; posted_at: string | null; first_seen_at: string;
  fee_eligible?: boolean;
};

// Assistant / teaching / coaching roles: listed for candidates, but ClubMode doesn't present anyone for them.
const BoardOnly = ({ hint = JOB_BOARD_ONLY_HINT }: { hint?: string }) => (
  <span title={hint} className="text-[11px] font-medium rounded-full px-2 py-0.5 bg-slate-100 text-slate-600 border border-slate-200">
    {JOB_BOARD_ONLY_LABEL}
  </span>
);

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
const compBand = (j: { comp_min: number | null; comp_max: number | null }) =>
  j.comp_max ? (j.comp_min ? `${usd(j.comp_min)}–${usd(j.comp_max)}` : `Up to ${usd(j.comp_max)}`) : null;
const sourcedPay = (j: SourcedJob) =>
  compBand(j) || (j.comp_min ? `${usd(j.comp_min)}+` : null) || (j.comp_text && j.comp_text.length <= 40 ? j.comp_text : null) ||
  (j.est_comp ? `~${usd(j.est_comp)} est.` : null);
const fmtDate = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

// Which racquet sports a role covers, read from its title and summary.
const SPORTS: [string, RegExp][] = [['Tennis', /tennis/i], ['Pickleball', /pickleball/i], ['Padel', /padel/i], ['Platform', /platform|paddle tennis/i], ['Squash', /squash/i]];
const sportsOf = (...text: (string | null)[]) => {
  const t = text.filter(Boolean).join(' ');
  return SPORTS.filter(([, re]) => re.test(t)).map(([name]) => name);
};
const SportTags = ({ sports }: { sports: string[] }) => (
  <>{sports.map((s) => <span key={s} className="text-[11px] rounded-full px-2 py-0.5 bg-teal-50 text-teal-800 border border-teal-200">{s}</span>)}</>
);

export default function JobBoardPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sourced, setSourced] = useState<SourcedJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [state, setState] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/connect/jobs');
        if (!res.ok) throw new Error();
        const data = await res.json();
        setJobs(data.jobs || []);
        setSourced(data.sourced || []);
        setCheckedAt(data.checked_at || null);
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const states = useMemo(
    () => Array.from(new Set([...jobs, ...sourced].map((j) => (j.state || '').toUpperCase()).filter(Boolean))).sort(),
    [jobs, sourced],
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

  const shownSourced = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return sourced.filter((j) => {
      if (state && (j.state || '').toUpperCase() !== state) return false;
      if (!needle) return true;
      return [j.club_name, j.title, j.dept, j.city, j.state, j.summary, j.requirements]
        .some((f) => (f || '').toLowerCase().includes(needle));
    });
  }, [sourced, q, state]);
  const total = jobs.length + sourced.length;

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <Link href="/connect" className="text-sm text-teal-400 underline">← ClubMode Recruiting</Link>
      <h1 className="text-3xl font-bold tracking-tight text-white mt-2 mb-1">Racquets director jobs</h1>
      <p className="text-slate-300 mb-5">Director of Tennis, Racquets and Pickleball openings at clubs hiring now.</p>

      <div className="mb-6 rounded-xl border border-teal-300 bg-teal-50 p-4 flex items-start gap-3">
        <ShieldCheck className="h-5 w-5 text-teal-700 shrink-0 mt-0.5" />
        <div className="text-sm text-teal-900">
          <strong>Free for candidates.</strong> Your details go to a club only after you say yes to that club, for that role,
          and you can withdraw any time.{' '}
          <Link href="/connect/candidate" className="underline">Set up your profile and résumé</Link> once.{' '}
          <Link href="/connect/privacy" className="underline">Privacy</Link>
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

      {!loading && !failed && total > 0 && (
        <p className="mb-4 text-sm text-slate-400">
          {total} open {total === 1 ? 'job' : 'jobs'}{checkedAt ? ` · listings checked ${fmtDate(checkedAt)}` : ''}
        </p>
      )}

      {loading ? (
        <div className="py-16 text-center text-slate-300"><Loader2 className="h-5 w-5 animate-spin inline" /> Loading jobs…</div>
      ) : failed ? (
        <p className="text-slate-300">Couldn&apos;t load jobs right now. Please refresh.</p>
      ) : shown.length + shownSourced.length === 0 ? (
        <div className="rounded-xl border border-slate-700 p-8 text-center">
          <Briefcase className="h-6 w-6 text-slate-400 mx-auto mb-2" />
          <p className="text-slate-200 font-medium">
            {total === 0 ? 'No open jobs right now. New openings are added every week.' : 'No jobs match those filters.'}
          </p>
          <p className="text-sm text-slate-400 mt-1">
            {total === 0
              ? <>Join the free <Link href="/connect/founding" className="text-teal-400 underline">founding director network</Link> and we&apos;ll tell you privately when a role fits.</>
              : <button className="text-teal-400 underline" onClick={() => { setQ(''); setState(''); }}>Clear filters</button>}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {shown.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-white">ClubMode Recruiting searches</h2>
              <p className="text-sm text-slate-400 mb-1">These clubs are hiring through ClubMode. Apply here and the club sees your application.</p>
            </div>
          )}
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
                      <span className={`shrink-0 text-xs font-medium rounded-full px-2 py-1 ${band ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}>
                        {band || 'Pay not disclosed'}
                      </span>
                    </div>
                    <div className="mt-1.5 text-xs text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1">
                      {place && <span><MapPin className="h-3 w-3 inline" /> {place}</span>}
                      <span className="text-[11px] font-medium rounded-full px-2 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-200">Hiring through ClubMode</span>
                      <span>Posted {fmtDate(j.created_at)}</span>
                      {j.deadline && <span><CalendarClock className="h-3 w-3 inline" /> Apply by {fmtDate(j.deadline)}</span>}
                      <SportTags sports={sportsOf(j.title, j.description)} />
                      {j.fee_eligible === false && <BoardOnly hint="Listed on our job board. Apply here; the club sees your application." />}
                    </div>
                    {j.description && <p className="mt-2 text-sm text-slate-700 line-clamp-2">{j.description}</p>}
                  </CardContent>
                </Card>
              </Link>
            );
          })}

          {shownSourced.length > 0 && (
            <div className="pt-6">
              <h2 className="text-lg font-semibold text-white">Public listings</h2>
              <p className="text-sm text-slate-400 mb-3">
                Openings we found on public job boards. These clubs are not working with ClubMode. Apply on the club&apos;s own
                posting. Saying &quot;I&apos;m interested&quot; here is not an application: it asks us to put your profile in front of
                the club, with your OK.
              </p>
              <div className="space-y-3">
                {shownSourced.map((j) => {
                  const pay = sourcedPay(j);
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
                            <span className={`shrink-0 text-xs font-medium rounded-full px-2 py-1 bg-slate-100 ${pay ? 'text-slate-700' : 'text-slate-500'}`}>
                              {pay || 'Pay not disclosed'}
                            </span>
                          </div>
                          <div className="mt-1.5 text-xs text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1">
                            {place && <span><MapPin className="h-3 w-3 inline" /> {place}</span>}
                            {j.deadline && <span><CalendarClock className="h-3 w-3 inline" /> Apply by {fmtDate(j.deadline)}</span>}
                            <span><Globe className="h-3 w-3 inline" /> Public listing · {sourceLabel(j.source)}, posted {fmtDate(j.posted_at || j.first_seen_at)}</span>
                            <SportTags sports={sportsOf(j.title, j.summary)} />
                            {j.fee_eligible === false && <BoardOnly />}
                          </div>
                          {j.summary && <p className="mt-2 text-sm text-slate-700 line-clamp-2">{j.summary}</p>}
                        </CardContent>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

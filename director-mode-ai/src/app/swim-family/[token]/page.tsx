'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  Loader2,
  Waves,
  Calendar,
  MapPin,
  Check,
  X,
  AlertCircle,
  Briefcase,
  Users as UsersIcon,
  Zap,
  Clock,
  Trophy,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import Thermometer from '@/components/swim/Thermometer';

type Family = {
  id: string;
  family_name: string;
  family_token: string;
  num_swimmers: number | null;
  points_required: number | null;
};
type Season = {
  id: string;
  name: string;
  default_points_required: number;
};
type Meet = {
  id: string;
  name: string;
  meet_date: string | null;
  location: string | null;
  opponent: string | null;
};
type Job = {
  id: string;
  meet_id: string | null;
  name: string;
  description: string | null;
  points: number;
  job_date: string | null;
  slots: number | null;
  auto_award_on_signup: boolean;
};
type Assignment = {
  id: string;
  family_id: string;
  job_id: string;
  points_awarded: number;
  status: 'signed_up' | 'completed' | 'no_show' | 'cancelled';
  completed_at: string | null;
  auto_awarded: boolean;
};

export default function FamilyPublicPage() {
  const params = useParams();
  const token = Array.isArray(params.token) ? params.token[0] : (params.token as string);

  const [data, setData] = useState<{
    family: Family;
    season: Season;
    meets: Meet[];
    jobs: Job[];
    myAssignments: Assignment[];
    jobSignupCounts: Record<string, number>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const fetchAll = useCallback(async () => {
    if (!token) return;
    const res = await fetch(`/api/swim/family/${token}`, { cache: 'no-store' });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j?.error || 'Could not load this page.');
      setLoading(false);
      return;
    }
    const j = await res.json();
    setData(j);
    setLoading(false);
  }, [token]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const signup = async (jobId: string) => {
    setBusy(jobId);
    setActionMsg(null);
    const res = await fetch(`/api/swim/family/${token}/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setActionMsg({ kind: 'err', text: j?.error || 'Could not sign up.' });
    } else {
      setActionMsg({
        kind: 'ok',
        text:
          j?.assignment?.status === 'completed'
            ? `Signed up — points credited!`
            : `Signed up! Lead will confirm after the job.`,
      });
      await fetchAll();
    }
    setBusy(null);
  };

  const cancel = async (assignmentId: string) => {
    if (!confirm('Cancel this signup?')) return;
    setBusy(assignmentId);
    setActionMsg(null);
    const res = await fetch(
      `/api/swim/family/${token}/signup?assignment_id=${assignmentId}`,
      { method: 'DELETE' }
    );
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setActionMsg({ kind: 'err', text: j?.error || 'Could not cancel.' });
    } else {
      setActionMsg({ kind: 'ok', text: 'Signup cancelled.' });
      await fetchAll();
    }
    setBusy(null);
  };

  const progress = useMemo(() => {
    if (!data) return { earned: 0, pending: 0, required: 0, completedJobs: 0, signedUpJobs: 0 };
    const required =
      data.family.points_required ?? data.season.default_points_required;
    const earned = data.myAssignments
      .filter((a) => a.status === 'completed')
      .reduce((s, a) => s + a.points_awarded, 0);
    const pending = data.myAssignments
      .filter((a) => a.status === 'signed_up')
      .reduce((s, a) => s + a.points_awarded, 0);
    const completedJobs = data.myAssignments.filter((a) => a.status === 'completed').length;
    const signedUpJobs = data.myAssignments.filter((a) => a.status === 'signed_up').length;
    return { earned, pending, required, completedJobs, signedUpJobs };
  }, [data]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-cyan-100 via-sky-50 to-blue-100 flex items-center justify-center">
        <Loader2 className="animate-spin text-cyan-600" size={32} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-cyan-100 via-sky-50 to-blue-100 p-8 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md text-center">
          <AlertCircle className="mx-auto text-red-500 mb-3" size={36} />
          <h1 className="font-bold text-xl text-gray-900 mb-1">
            We couldn't open this page
          </h1>
          <p className="text-sm text-gray-600">
            {error || 'This link may be wrong or expired. Ask your team lead for a new one.'}
          </p>
        </div>
      </div>
    );
  }

  const myAssignmentByJob = new Map(data.myAssignments.map((a) => [a.job_id, a]));
  const meetById = new Map(data.meets.map((m) => [m.id, m]));
  const sortedMeets = [...data.meets].sort((a, b) => {
    if (a.meet_date && b.meet_date) return a.meet_date.localeCompare(b.meet_date);
    if (a.meet_date) return -1;
    if (b.meet_date) return 1;
    return a.name.localeCompare(b.name);
  });

  const jobsByMeet = new Map<string, Job[]>();
  const standalone: Job[] = [];
  for (const j of data.jobs) {
    if (j.meet_id && meetById.has(j.meet_id)) {
      const arr = jobsByMeet.get(j.meet_id) ?? [];
      arr.push(j);
      jobsByMeet.set(j.meet_id, arr);
    } else {
      standalone.push(j);
    }
  }

  const goalReached = progress.earned >= progress.required;
  const remainingPts = Math.max(0, progress.required - progress.earned);

  const renderJobCard = (job: Job) => {
    const taken = data.jobSignupCounts[job.id] ?? 0;
    const slots = job.slots;
    const full = slots != null && taken >= slots;
    const mine = myAssignmentByJob.get(job.id);
    const myStatus = mine?.status;
    const auto = job.auto_award_on_signup === true;
    const canCancel =
      mine && (mine.status === 'signed_up' || (mine.status === 'completed' && mine.auto_awarded));
    const slotPct = slots != null ? Math.min(100, Math.round((taken / slots) * 100)) : 0;

    return (
      <div
        key={job.id}
        className={`group relative bg-white rounded-2xl p-5 shadow-sm transition-all hover:shadow-lg hover:-translate-y-0.5 ${
          mine
            ? mine.status === 'completed' && !mine.auto_awarded
              ? 'ring-2 ring-emerald-300 bg-gradient-to-br from-emerald-50/50 to-white'
              : 'ring-2 ring-cyan-300 bg-gradient-to-br from-cyan-50/40 to-white'
            : 'ring-1 ring-gray-200 hover:ring-cyan-200'
        }`}
      >
        {/* Top bar: name, badge */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="w-8 h-8 rounded-lg bg-cyan-50 text-cyan-600 flex items-center justify-center flex-shrink-0">
                <Briefcase size={15} />
              </div>
              <h3 className="font-bold text-gray-900 truncate">{job.name}</h3>
            </div>
            {job.description && (
              <p className="text-xs text-gray-600 mt-2 leading-relaxed">{job.description}</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="text-2xl font-extrabold text-cyan-700 leading-none">
              +{job.points}
            </div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              pts
            </div>
          </div>
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-2 text-xs flex-wrap mb-3">
          {auto ? (
            <span className="inline-flex items-center gap-1 font-bold uppercase tracking-wide text-emerald-700 bg-emerald-100 px-2 py-1 rounded-full">
              <Zap size={11} /> instant
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 font-bold uppercase tracking-wide text-amber-700 bg-amber-100 px-2 py-1 rounded-full">
              <Clock size={11} /> after event
            </span>
          )}
          {job.job_date && (
            <span className="inline-flex items-center gap-1 text-gray-600 bg-gray-100 px-2 py-1 rounded-full">
              <Calendar size={11} />
              {job.job_date}
            </span>
          )}
        </div>

        {/* Slot bar */}
        {slots != null && (
          <div className="mb-3">
            <div className="flex items-center justify-between text-[11px] text-gray-600 mb-1">
              <span className="inline-flex items-center gap-1">
                <UsersIcon size={11} />
                <span className={full ? 'text-red-600 font-bold' : 'font-medium'}>
                  {taken} of {slots} {full ? '— FULL' : 'spots'}
                </span>
              </span>
              <span className="text-gray-400">{slotPct}%</span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${
                  full ? 'bg-red-400' : slotPct >= 75 ? 'bg-amber-400' : 'bg-cyan-400'
                }`}
                style={{ width: `${slotPct}%` }}
              />
            </div>
          </div>
        )}

        {/* CTA / status */}
        {myStatus === 'completed' && mine?.auto_awarded && (
          <div className="flex items-center justify-between gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5 text-xs">
            <span className="text-emerald-800 font-bold flex items-center gap-1.5">
              <Sparkles size={14} className="text-emerald-600" />
              Earned +{mine.points_awarded} pts
            </span>
            {canCancel && (
              <button
                onClick={() => mine && cancel(mine.id)}
                disabled={busy === mine?.id}
                className="inline-flex items-center gap-1 text-red-600 hover:bg-red-100 px-2 py-1 rounded font-semibold"
              >
                <X size={12} /> Cancel
              </button>
            )}
          </div>
        )}
        {myStatus === 'completed' && !mine?.auto_awarded && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-3 py-2.5 text-xs font-bold flex items-center gap-1.5">
            <Check size={14} className="text-emerald-600" />
            Earned +{mine?.points_awarded} pts (lead-confirmed)
          </div>
        )}
        {myStatus === 'signed_up' && (
          <div className="flex items-center justify-between gap-2 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5 text-xs">
            <span className="text-blue-800 font-bold flex items-center gap-1.5">
              <Clock size={14} className="text-blue-600" />
              Signed up — pending confirmation
            </span>
            <button
              onClick={() => mine && cancel(mine.id)}
              disabled={busy === mine?.id}
              className="inline-flex items-center gap-1 text-red-600 hover:bg-red-100 px-2 py-1 rounded font-semibold"
            >
              <X size={12} /> Cancel
            </button>
          </div>
        )}
        {!myStatus && (
          <button
            onClick={() => signup(job.id)}
            disabled={full || busy === job.id}
            className={`w-full px-3 py-2.5 text-white rounded-xl text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 transition-all shadow-md hover:shadow-lg ${
              auto
                ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700'
                : 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700'
            }`}
          >
            {busy === job.id && <Loader2 size={14} className="animate-spin" />}
            {full ? (
              'Job is full'
            ) : (
              <>
                Sign up
                <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
              </>
            )}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-cyan-50 to-blue-50 relative overflow-hidden">
      {/* Decorative blurry blobs */}
      <div
        className="absolute -top-20 -left-20 w-80 h-80 bg-cyan-300/30 rounded-full blur-3xl pointer-events-none"
        aria-hidden="true"
      />
      <div
        className="absolute top-40 -right-20 w-96 h-96 bg-blue-300/20 rounded-full blur-3xl pointer-events-none"
        aria-hidden="true"
      />

      {/* Hero */}
      <header className="relative">
        <div className="bg-gradient-to-br from-cyan-500 via-cyan-600 to-blue-600 text-white pt-8 pb-20 px-4 relative overflow-hidden">
          {/* Subtle wave overlay */}
          <svg
            className="absolute inset-x-0 -bottom-1 w-full h-12 text-white"
            viewBox="0 0 1200 120"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path
              d="M0,60 C150,100 350,20 600,60 C850,100 1050,20 1200,60 L1200,120 L0,120 Z"
              fill="currentColor"
            />
          </svg>

          <div className="max-w-3xl mx-auto relative">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-11 h-11 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center ring-2 ring-white/30">
                <Waves size={20} />
              </div>
              <div>
                <p className="text-cyan-100 text-xs uppercase tracking-widest font-semibold">
                  {data.season.name}
                </p>
                <p className="text-white text-xs opacity-80">Volunteer Points</p>
              </div>
            </div>
            <h1 className="font-display text-4xl sm:text-5xl font-bold mb-2 tracking-tight">
              {data.family.family_name} family
            </h1>
            <p className="text-cyan-50/90 text-sm">
              {goalReached ? (
                <span className="inline-flex items-center gap-1.5">
                  <Trophy size={14} className="text-yellow-300" />
                  You've hit your target — thank you!
                </span>
              ) : (
                <>
                  <span className="font-bold">{remainingPts} pts</span> to reach your{' '}
                  {progress.required}-pt target.
                </>
              )}
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 -mt-12 relative pb-12 space-y-6">
        {/* Thermometer + stats card */}
        <div
          className={`bg-white rounded-3xl shadow-xl p-6 sm:p-8 flex items-center gap-6 flex-wrap relative ${goalReached ? 'ring-2 ring-emerald-300' : ''}`}
        >
          {goalReached && (
            <div className="absolute top-4 right-4 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-100 px-2 py-1 rounded-full">
              <Trophy size={11} /> Goal reached
            </div>
          )}
          <Thermometer
            earned={progress.earned}
            pending={progress.pending}
            required={progress.required}
            size="lg"
          />
          <div className="flex-1 min-w-[200px] space-y-3">
            <div>
              <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider">
                Your progress
              </p>
              <h2 className="font-display text-3xl font-bold text-gray-900 mt-0.5">
                {progress.earned}
                <span className="text-gray-300"> / </span>
                <span className="text-gray-600">{progress.required}</span>
                <span className="text-base font-semibold text-gray-500 ml-1">pts</span>
              </h2>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-emerald-50 rounded-xl p-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                  Confirmed
                </div>
                <div className="text-lg font-extrabold text-emerald-900 mt-0.5">
                  {progress.completedJobs}
                </div>
                <div className="text-[10px] text-emerald-700">
                  {progress.completedJobs === 1 ? 'job done' : 'jobs done'}
                </div>
              </div>
              <div className="bg-amber-50 rounded-xl p-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
                  Pending
                </div>
                <div className="text-lg font-extrabold text-amber-900 mt-0.5">
                  {progress.signedUpJobs}
                </div>
                <div className="text-[10px] text-amber-700">awaiting confirm</div>
              </div>
            </div>
          </div>
        </div>

        {actionMsg && (
          <div
            className={`rounded-xl px-4 py-3 text-sm font-medium shadow-sm ${
              actionMsg.kind === 'ok'
                ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                : 'bg-red-50 border border-red-200 text-red-700'
            }`}
          >
            {actionMsg.text}
          </div>
        )}

        {/* Meets */}
        {sortedMeets.map((m) => {
          const list = jobsByMeet.get(m.id) ?? [];
          if (list.length === 0) return null;
          return (
            <section key={m.id}>
              <div className="mb-4 px-1">
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <h2 className="font-display font-bold text-2xl text-gray-900">
                    {m.name}
                  </h2>
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                    {list.length} {list.length === 1 ? 'job' : 'jobs'}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-600 mt-1.5 flex-wrap">
                  {m.meet_date && (
                    <span className="inline-flex items-center gap-1 bg-white px-2 py-1 rounded-full ring-1 ring-gray-200">
                      <Calendar size={12} className="text-cyan-500" />
                      {m.meet_date}
                    </span>
                  )}
                  {m.location && (
                    <span className="inline-flex items-center gap-1 bg-white px-2 py-1 rounded-full ring-1 ring-gray-200">
                      <MapPin size={12} className="text-cyan-500" />
                      {m.location}
                    </span>
                  )}
                  {m.opponent && (
                    <span className="inline-flex items-center gap-1 bg-white px-2 py-1 rounded-full ring-1 ring-gray-200 font-semibold text-gray-700">
                      vs {m.opponent}
                    </span>
                  )}
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">{list.map(renderJobCard)}</div>
            </section>
          );
        })}

        {standalone.length > 0 && (
          <section>
            <div className="mb-4 px-1">
              <h2 className="font-display font-bold text-2xl text-gray-900">Other jobs</h2>
              <p className="text-xs text-gray-600 mt-1">Not tied to a specific meet.</p>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">{standalone.map(renderJobCard)}</div>
          </section>
        )}

        {data.jobs.length === 0 && (
          <div className="bg-white rounded-2xl shadow p-10 text-center">
            <div className="w-14 h-14 rounded-2xl bg-cyan-100 text-cyan-500 flex items-center justify-center mx-auto mb-3">
              <Waves size={26} />
            </div>
            <p className="text-gray-700 font-semibold">No jobs posted yet</p>
            <p className="text-xs text-gray-500 mt-1">Check back soon — your team lead will add some.</p>
          </div>
        )}

        <p className="text-center text-xs text-gray-400 pt-4">
          🔒 This is your private link. Don't share it — anyone with it can sign up as you.
        </p>
      </main>
    </div>
  );
}

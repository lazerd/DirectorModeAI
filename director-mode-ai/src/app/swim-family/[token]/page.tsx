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
      setActionMsg({ kind: 'ok', text: 'Signed up! Lead will confirm after the job.' });
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
    if (!data) return { earned: 0, pending: 0, required: 0 };
    const required =
      data.family.points_required ?? data.season.default_points_required;
    const earned = data.myAssignments
      .filter((a) => a.status === 'completed')
      .reduce((s, a) => s + a.points_awarded, 0);
    const pending = data.myAssignments
      .filter((a) => a.status === 'signed_up')
      .reduce((s, a) => s + a.points_awarded, 0);
    return { earned, pending, required };
  }, [data]);

  if (loading) {
    return (
      <div className="min-h-screen bg-cyan-50 flex items-center justify-center">
        <Loader2 className="animate-spin text-cyan-500" size={28} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-cyan-50 p-8 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow p-6 max-w-md text-center">
          <AlertCircle className="mx-auto text-red-500 mb-3" size={36} />
          <h1 className="font-semibold text-lg text-gray-900 mb-1">
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

  const renderJobCard = (job: Job) => {
    const taken = data.jobSignupCounts[job.id] ?? 0;
    const slots = job.slots;
    const full = slots != null && taken >= slots;
    const mine = myAssignmentByJob.get(job.id);
    const myStatus = mine?.status;
    const auto = job.auto_award_on_signup === true;
    // Family can cancel: pending, OR auto-awarded the lead hasn't manually touched.
    const canCancel =
      mine && (mine.status === 'signed_up' || (mine.status === 'completed' && mine.auto_awarded));

    return (
      <div
        key={job.id}
        className={`bg-white border rounded-xl p-4 ${
          mine ? 'border-cyan-300 ring-1 ring-cyan-200' : 'border-gray-200'
        }`}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-gray-900 flex items-center gap-2 flex-wrap">
              <Briefcase size={14} className="text-cyan-500" />
              {job.name}
              {auto ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full">
                  <Zap size={10} /> instant
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full">
                  <Clock size={10} /> after event
                </span>
              )}
            </div>
            {job.description && (
              <p className="text-xs text-gray-600 mt-1">{job.description}</p>
            )}
            <div className="flex items-center gap-3 text-xs text-gray-500 mt-1.5 flex-wrap">
              <span className="font-bold text-cyan-700">{job.points} pts</span>
              {job.job_date && (
                <span className="inline-flex items-center gap-1">
                  <Calendar size={11} />
                  {job.job_date}
                </span>
              )}
              {slots != null && (
                <span
                  className={`inline-flex items-center gap-1 ${
                    full ? 'text-red-600 font-medium' : ''
                  }`}
                >
                  <UsersIcon size={11} />
                  {taken}/{slots} {full ? 'FULL' : 'spots'}
                </span>
              )}
            </div>
          </div>
        </div>

        {myStatus === 'completed' && mine?.auto_awarded && (
          <div className="flex items-center justify-between gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs">
            <span className="text-emerald-800 font-medium flex items-center gap-1">
              <Check size={14} /> You earned +{mine.points_awarded} pts (instant)
            </span>
            {canCancel && (
              <button
                onClick={() => mine && cancel(mine.id)}
                disabled={busy === mine?.id}
                className="inline-flex items-center gap-1 text-red-600 hover:bg-red-100 px-2 py-1 rounded font-medium"
              >
                <X size={12} /> Cancel
              </button>
            )}
          </div>
        )}
        {myStatus === 'completed' && !mine?.auto_awarded && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-3 py-2 text-xs font-medium flex items-center gap-2">
            <Check size={14} /> You earned +{mine?.points_awarded} pts (lead-confirmed)
          </div>
        )}
        {myStatus === 'signed_up' && (
          <div className="flex items-center justify-between gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs">
            <span className="text-blue-800 font-medium">
              You're signed up — pending lead confirmation
            </span>
            <button
              onClick={() => mine && cancel(mine.id)}
              disabled={busy === mine?.id}
              className="inline-flex items-center gap-1 text-red-600 hover:bg-red-100 px-2 py-1 rounded font-medium"
            >
              <X size={12} /> Cancel
            </button>
          </div>
        )}
        {!myStatus && (
          <button
            onClick={() => signup(job.id)}
            disabled={full || busy === job.id}
            className={`w-full px-3 py-2 text-white rounded-lg text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 ${
              auto
                ? 'bg-emerald-600 hover:bg-emerald-700'
                : 'bg-cyan-600 hover:bg-cyan-700'
            }`}
          >
            {busy === job.id && <Loader2 size={14} className="animate-spin" />}
            {full
              ? 'Job is full'
              : auto
                ? `Sign up · get +${job.points} pts now`
                : `Sign up · earn ${job.points} pts after`}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-cyan-50 via-white to-cyan-50">
      <header className="border-b bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-cyan-500 text-white flex items-center justify-center">
            <Waves size={18} />
          </div>
          <div>
            <h1 className="font-semibold text-gray-900">{data.season.name}</h1>
            <p className="text-xs text-gray-500">{data.family.family_name} family</p>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Thermometer + summary */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6 flex items-center gap-6 flex-wrap">
          <Thermometer
            earned={progress.earned}
            pending={progress.pending}
            required={progress.required}
            size="lg"
          />
          <div className="flex-1 min-w-[200px]">
            <h2 className="font-bold text-2xl text-gray-900 mb-1">
              {data.family.family_name}
            </h2>
            <p className="text-sm text-gray-600 mb-3">
              Volunteer points for the {data.season.name} season.
            </p>
            <ul className="text-sm space-y-1.5">
              <li className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-sm bg-emerald-500" />
                <span className="font-semibold">{progress.earned}</span> earned (lead-confirmed)
              </li>
              <li className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-sm bg-gray-400" />
                <span className="font-semibold">{progress.pending}</span> pending (signed up)
              </li>
              <li className="text-gray-500 pt-1">
                Target: <span className="font-semibold text-gray-900">{progress.required}</span> pts
              </li>
            </ul>
          </div>
        </div>

        {actionMsg && (
          <div
            className={`rounded-lg px-3 py-2.5 text-sm ${
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
              <div className="mb-3">
                <h2 className="font-bold text-lg text-gray-900">{m.name}</h2>
                <div className="flex items-center gap-3 text-xs text-gray-600 mt-0.5 flex-wrap">
                  {m.meet_date && (
                    <span className="inline-flex items-center gap-1">
                      <Calendar size={12} className="text-cyan-500" />
                      {m.meet_date}
                    </span>
                  )}
                  {m.location && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin size={12} className="text-cyan-500" />
                      {m.location}
                    </span>
                  )}
                  {m.opponent && <span>vs {m.opponent}</span>}
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">{list.map(renderJobCard)}</div>
            </section>
          );
        })}

        {standalone.length > 0 && (
          <section>
            <div className="mb-3">
              <h2 className="font-bold text-lg text-gray-900">Other jobs</h2>
              <p className="text-xs text-gray-600 mt-0.5">Not tied to a specific meet.</p>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">{standalone.map(renderJobCard)}</div>
          </section>
        )}

        {data.jobs.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-sm text-gray-500">
            No jobs posted yet — check back soon.
          </div>
        )}

        <p className="text-center text-xs text-gray-400 pt-4 pb-8">
          This is your private link. Don't share it — anyone with it can sign up as you.
        </p>
      </main>
    </div>
  );
}

'use client';

/** The Claude-written pilot plan, plus the button that (re)builds it from every response. */

import { useState } from 'react';

type Analysis = {
  headline: string;
  by_question: { question: string; leaning: string; agreement: string; notable?: string }[];
  plan: Record<string, string>;
  owners: { task: string; owner: string }[];
  decisions_needed: { decision: string; options: string; recommendation?: string }[];
  risks: string[];
  next_steps: { step: string; owner: string; by_when?: string }[];
};

const PLAN_LABELS: Record<string, string> = {
  when: 'When',
  day_and_time: 'Day and time',
  shape: 'What the test looks like',
  host: 'Where',
  size: 'How many players',
  registration_and_payment: 'Register and pay',
  format: 'Format of play',
  incentives: 'Incentive to play',
};

export default function PollAnalysis({
  initial,
  initialCount,
  initialAt,
  responseCount,
}: {
  initial: Analysis | null;
  initialCount: number;
  initialAt: string | null;
  responseCount: number;
}) {
  const [a, setA] = useState<Analysis | null>(initial);
  const [basedOn, setBasedOn] = useState(initialCount);
  const [at, setAt] = useState<string | null>(initialAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/ptl/admin/poll/analyze', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || 'Analysis failed.');
        return;
      }
      setA(body.analysis);
      setBasedOn(responseCount);
      setAt(new Date().toISOString());
    } catch {
      setError('Lost the connection. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const stale = a && basedOn !== responseCount;

  return (
    <section className="mt-10 rounded-sm border border-white/10 bg-white/[0.03] p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight">Pilot plan</h2>
          <p className="mt-1 text-sm text-white/50">
            {a
              ? `Built from ${basedOn} ${basedOn === 1 ? 'response' : 'responses'}${at ? ` on ${new Date(at).toLocaleString()}` : ''}.`
              : 'Not built yet.'}
            {stale && <span className="ml-1 text-amber-300">New answers since then. Rebuild it.</span>}
          </p>
        </div>
        <button
          onClick={run}
          disabled={busy || responseCount === 0}
          className="rounded-sm bg-teal-400 px-5 py-3 font-bold text-[#06231F] transition-colors hover:bg-teal-300 disabled:opacity-50"
        >
          {busy ? 'Claude is reading every answer…' : a ? 'Rebuild plan' : 'Build plan with Claude'}
        </button>
      </div>
      {error && <p className="mt-4 text-sm text-red-300">{error}</p>}

      {a && (
        <div className="mt-8 space-y-10 text-white/80">
          <p className="text-xl font-semibold leading-snug text-white">{a.headline}</p>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-400">Recommended pilot</h3>
            <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
              {Object.entries(PLAN_LABELS).map(([k, label]) =>
                a.plan?.[k] ? (
                  <div key={k}>
                    <dt className="text-sm font-bold text-white">{label}</dt>
                    <dd className="mt-1 text-sm leading-relaxed">{a.plan[k]}</dd>
                  </div>
                ) : null,
              )}
            </dl>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-400">Who does what</h3>
            <ul className="mt-4 divide-y divide-white/10 text-sm">
              {a.owners.map((o, i) => (
                <li key={i} className="flex justify-between gap-6 py-2">
                  <span>{o.task}</span>
                  <span className={o.owner === 'Needs an owner' ? 'font-semibold text-amber-300' : 'font-semibold text-white'}>
                    {o.owner}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-400">Decisions the group still has to make</h3>
            <ul className="mt-4 space-y-3 text-sm">
              {a.decisions_needed.map((d, i) => (
                <li key={i}>
                  <p className="font-bold text-white">{d.decision}</p>
                  <p className="text-white/65">Options: {d.options}</p>
                  {d.recommendation && <p className="text-white/80">Recommendation: {d.recommendation}</p>}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-400">Question by question</h3>
            <ul className="mt-4 space-y-4 text-sm">
              {a.by_question.map((q, i) => (
                <li key={i}>
                  <p className="font-bold text-white">
                    {q.question}{' '}
                    <span className={`ml-1 text-xs font-semibold uppercase ${q.agreement === 'strong' ? 'text-teal-300' : 'text-amber-300'}`}>
                      {q.agreement}
                    </span>
                  </p>
                  <p>{q.leaning}</p>
                  {q.notable && <p className="text-white/60">{q.notable}</p>}
                </li>
              ))}
            </ul>
          </div>

          {a.risks.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-400">Risks</h3>
              <ul className="mt-4 list-disc space-y-1 pl-5 text-sm">
                {a.risks.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          )}

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-400">Next steps</h3>
            <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm">
              {a.next_steps.map((s, i) => (
                <li key={i}>
                  {s.step} <span className="text-white/55">({s.owner}{s.by_when ? `, ${s.by_when}` : ''})</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </section>
  );
}

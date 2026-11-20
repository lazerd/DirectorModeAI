'use client';

import { useEffect, useState } from 'react';

type Metric = { key: string; label: string; value: number | null; fmt: 'pct' | 'sec' | 'int'; target: number | null; lowerIsBetter?: boolean; n: string };
type Card = { days: number; next: string; created: number; metrics: Metric[] };

const show = (v: number | null, f: Metric['fmt']) =>
  v == null ? '—' : f === 'pct' ? `${Math.round(v * 100)}%` : f === 'sec' ? `${Math.round(v)}s` : String(v);

export default function PlayScorecardTab() {
  const [c, setC] = useState<Card | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    fetch('/api/admin/play-scorecard').then((r) => (r.ok ? r.json() : Promise.reject(r.status))).then(setC).catch(() => setErr('Could not load the scorecard.'));
  }, []);
  if (err) return <p className="text-sm text-red-600">{err}</p>;
  if (!c) return <p className="text-sm text-gray-500">Loading…</p>;
  return (
    <div className="max-w-2xl">
      <h2 className="text-lg font-semibold">/play: last {c.days} days</h2>
      <p className="mt-2 rounded-lg bg-amber-50 px-4 py-3 text-[15px] text-amber-900">{c.next}</p>
      <table className="mt-5 w-full text-sm">
        <thead><tr className="text-left text-gray-500"><th className="py-2">Metric</th><th>Now</th><th>Target</th><th></th></tr></thead>
        <tbody>
          {c.metrics.map((m) => {
            const hit = m.value != null && m.target != null && (m.lowerIsBetter ? m.value <= m.target : m.value >= m.target);
            return (
              <tr key={m.key} className="border-t">
                <td className="py-2.5 pr-3">{m.label}<div className="text-xs text-gray-400">{m.n}</div></td>
                <td className="font-semibold">{show(m.value, m.fmt)}</td>
                <td className="text-gray-500">{m.target == null ? 'track' : `${m.lowerIsBetter ? '<' : '≥'} ${show(m.target, m.fmt)}`}</td>
                <td>{m.value == null || m.target == null ? '' : hit ? '✅' : '⬜'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-4 text-xs text-gray-400">Targets are Kevin&apos;s starting guesses (11/19), not industry benchmarks. Hosts named test/demo/qa are left out.</p>
    </div>
  );
}

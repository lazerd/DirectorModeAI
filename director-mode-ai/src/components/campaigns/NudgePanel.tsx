'use client';
import { useEffect, useState } from 'react';

// Reusable Broadcast + Nudge panel. Drop into any admin surface that has a
// campaign source (tournament, league, …). Session-authed; the API scopes
// everything to the logged-in director's owned events.

type Status = {
  title: string;
  clubName: string;
  liveUrl: string;
  stats: { label: string; value: string }[];
  everyoneCount: number;
  nudgeCount: number;
};

export default function NudgePanel({ surface, targetId }: { surface: 'tournament' | 'league'; targetId: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await fetch(`/api/campaigns?surface=${surface}&targetId=${targetId}`);
      const d = await r.json().catch(() => ({}));
      if (!alive) return;
      if (r.ok) setStatus(d);
      else setErr(d.error || 'Could not load');
    })();
    return () => {
      alive = false;
    };
  }, [surface, targetId]);

  if (err) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>;
  if (!status) return <div className="text-sm text-gray-500">Loading…</div>;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap gap-6">
          {status.stats.map((s) => (
            <div key={s.label}>
              <div className="text-2xl font-bold text-[#1F4FA0] leading-none">{s.value}</div>
              <div className="text-[11px] uppercase tracking-wide text-gray-500">{s.label}</div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Emails send from <span className="font-medium">{status.clubName}</span> · reply-to your address · unsubscribe-safe · billed to your plan.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <ActionCard
          surface={surface}
          targetId={targetId}
          kind="update"
          count={status.everyoneCount}
          title="📣 Send an Update"
          desc="One warm status email to everyone — where things stand, standings are live, play-ahead reminder."
          confirmVerb={`Send an update to all ${status.everyoneCount} players`}
        />
        <ActionCard
          surface={surface}
          targetId={targetId}
          kind="nudge"
          count={status.nudgeCount}
          title="🎾 Send a Gentle Nudge"
          desc="Personalized reminder to only players who still have a match ready to play — each with their opponent + contact info."
          confirmVerb={`Send a nudge to the ${status.nudgeCount} players who owe matches`}
        />
      </div>
    </div>
  );
}

function ActionCard({
  surface,
  targetId,
  kind,
  count,
  title,
  desc,
  confirmVerb,
}: {
  surface: string;
  targetId: string;
  kind: 'update' | 'nudge';
  count: number;
  title: string;
  desc: string;
  confirmVerb: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ count: number; subject?: string; sampleHtml?: string } | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function call(mode: 'preview' | 'test' | 'live') {
    if (mode === 'live' && !confirm(`${confirmVerb}?\n\nThis sends real emails and cannot be undone.`)) return;
    setBusy(mode);
    setResult(null);
    try {
      const r = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ surface, targetId, kind, mode }),
      });
      const d = await r.json();
      if (!r.ok) {
        setResult(d.error === 'credit_limit' ? d.message : d.error || 'Something went wrong');
      } else if (mode === 'preview') {
        setPreview(d);
      } else if (mode === 'test') {
        setResult(d.sent ? `Test sent to your inbox${d.sampleFor ? ` (sample for ${d.sampleFor})` : ''}.` : d.note || 'Nothing to send.');
      } else {
        setResult(`Sent ${d.sent}/${d.attempted}.${d.creditLimited ? ' Hit your plan email cap — upgrade to send the rest.' : ''}${d.failures?.length ? ` Skipped ${d.failures.length}.` : ''}`);
      }
    } catch (e) {
      setResult('Error: ' + (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const disabled = count === 0;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold text-gray-900">{title}</h3>
        <span className="text-xs font-medium text-gray-500">{count} recipient{count === 1 ? '' : 's'}</span>
      </div>
      <p className="mt-1 text-sm text-gray-600">{desc}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => call('preview')} disabled={!!busy || disabled} className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-40">
          {busy === 'preview' ? '…' : 'Preview'}
        </button>
        <button onClick={() => call('test')} disabled={!!busy || disabled} className="rounded-lg bg-[#0C7B8C] px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">
          {busy === 'test' ? '…' : 'Send test to me'}
        </button>
        <button onClick={() => call('live')} disabled={!!busy || disabled} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40">
          {busy === 'live' ? 'Sending…' : 'Send to all'}
        </button>
      </div>
      {disabled && <p className="mt-2 text-xs text-gray-500">{kind === 'nudge' ? 'Nobody owes a match right now. 🎉' : 'No recipients with an email yet.'}</p>}
      {result && <p className="mt-3 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">{result}</p>}
      {preview && (
        <div className="mt-3">
          <p className="mb-1 text-sm text-gray-800">
            <strong>{preview.count}</strong> recipient{preview.count === 1 ? '' : 's'}{preview.subject ? ` · “${preview.subject}”` : ''}
          </p>
          {preview.sampleHtml ? (
            <iframe title="preview" srcDoc={preview.sampleHtml} className="w-full h-[440px] rounded-lg border border-gray-200 bg-white" />
          ) : (
            <p className="text-sm text-gray-500">No recipients to preview.</p>
          )}
        </div>
      )}
    </div>
  );
}

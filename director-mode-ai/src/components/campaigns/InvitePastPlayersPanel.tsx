'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';

// "Invite past players" — the one-click marketing send for an upcoming event.
//
// Recipients are the families who PAID for the director's past events, picked
// per-event with checkboxes (so a draft that doesn't fit the new age groups can
// be left out). Send-to-all stays locked until the CURRENT selection has been
// previewed: the preview shows the exact rendered email and the full recipient
// list, and changing the selection re-locks it. A blast that fires straight off
// a click is how a wrong list or a wrong date reaches real families.

type PastEvent = { id: string; name: string; eventDate: string | null; paidCount: number };
type Status = { title: string; clubName: string; everyoneCount: number };
type Preview = { count: number; subject?: string; sampleHtml?: string; recipients?: string[] };

const fmtDate = (d: string | null) =>
  d
    ? new Date(d.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'No date';

export default function InvitePastPlayersPanel({ eventId }: { eventId: string }) {
  const [pastEvents, setPastEvents] = useState<PastEvent[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewedKey, setPreviewedKey] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  // Signature of the current selection. The preview is only trustworthy for the
  // selection it was built from, so this is what gates the live send.
  const selectionKey = useMemo(() => [...selected].sort().join(','), [selected]);
  const ids = useMemo(() => [...selected], [selected]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await fetch(`/api/campaigns/past-events?eventId=${eventId}`);
      const d = await r.json().catch(() => ({}));
      if (!alive) return;
      if (!r.ok) return setErr(d.error || 'Could not load past events');
      const list: PastEvent[] = d.events || [];
      setPastEvents(list);
      setSelected(new Set(list.map((e) => e.id))); // default: everyone who's ever paid
    })();
    return () => {
      alive = false;
    };
  }, [eventId]);

  const refreshCount = useCallback(async () => {
    if (!pastEvents) return;
    const qs = new URLSearchParams({ surface: 'quad-promote', targetId: eventId });
    for (const id of ids) qs.append('sourceEventId', id);
    const r = await fetch(`/api/campaigns?${qs.toString()}`);
    const d = await r.json().catch(() => ({}));
    if (r.ok) setStatus(d);
    else setErr(d.error || 'Could not load');
  }, [eventId, ids, pastEvents]);

  useEffect(() => {
    void refreshCount();
  }, [refreshCount]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setPreviewedKey(null); // selection moved — the preview no longer describes the send
    setResult(null);
  }

  async function call(mode: 'preview' | 'test' | 'live') {
    if (mode === 'live') {
      const n = status?.everyoneCount ?? 0;
      if (!confirm(`Send this invitation to all ${n} famil${n === 1 ? 'y' : 'ies'}?\n\nThese are real emails and cannot be unsent.`)) return;
    }
    setBusy(mode);
    setResult(null);
    try {
      const r = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ surface: 'quad-promote', targetId: eventId, kind: 'update', mode, sourceEventIds: ids }),
      });
      const d = await r.json();
      if (!r.ok) {
        setResult(d.error === 'credit_limit' ? d.message : d.error || 'Something went wrong');
      } else if (mode === 'preview') {
        setPreview(d);
        setPreviewedKey(selectionKey);
      } else if (mode === 'test') {
        setResult(d.sent ? 'Test sent to your inbox — check it before sending to everyone.' : d.note || 'Nothing to send.');
      } else {
        setResult(
          `Sent ${d.sent}/${d.attempted}.` +
            (d.creditLimited ? ' Hit your plan email cap — upgrade to send the rest.' : '') +
            (d.failures?.length ? ` Skipped ${d.failures.length}.` : '')
        );
        void refreshCount();
      }
    } catch (e) {
      setResult('Error: ' + (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (err) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>;
  if (!pastEvents) return <div className="text-sm text-gray-500">Loading…</div>;

  if (!pastEvents.length)
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-600">
        No past events with paid entries yet — once you&rsquo;ve run a paid event, those families show up here to invite.
      </div>
    );

  const count = status?.everyoneCount ?? 0;
  const stale = previewedKey !== selectionKey;
  const canSend = count > 0 && !stale && !busy;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold text-gray-900">📣 Invite past players</h3>
        <span className="text-xs font-medium text-gray-500">
          {count} famil{count === 1 ? 'y' : 'ies'}
        </span>
      </div>
      <p className="mt-1 text-sm text-gray-600">
        Emails the families who <strong>paid</strong> for your past events, inviting them to this one. Anyone already
        registered here is left out automatically.
      </p>

      <fieldset className="mt-3">
        <legend className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Pull families from</legend>
        <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2">
          {pastEvents.map((e) => (
            <label
              key={e.id}
              className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm text-gray-800 hover:bg-gray-50"
            >
              <input
                type="checkbox"
                checked={selected.has(e.id)}
                onChange={() => toggle(e.id)}
                className="h-4 w-4 shrink-0 accent-[#1F4FA0]"
              />
              <span className="min-w-0 flex-1 truncate">{e.name}</span>
              <span className="shrink-0 text-xs text-gray-500">{fmtDate(e.eventDate)}</span>
              <span className="shrink-0 text-xs font-semibold tabular-nums text-gray-700">{e.paidCount} paid</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => call('preview')}
          disabled={!!busy || count === 0}
          className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-40"
        >
          {busy === 'preview' ? '…' : stale ? 'Preview' : 'Preview again'}
        </button>
        <button
          onClick={() => call('test')}
          disabled={!!busy || count === 0}
          className="rounded-lg bg-[#0C7B8C] px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
        >
          {busy === 'test' ? '…' : 'Send test to me'}
        </button>
        <button
          onClick={() => call('live')}
          disabled={!canSend}
          title={stale ? 'Preview this exact list first' : undefined}
          className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
        >
          {busy === 'live' ? 'Sending…' : `Send to all ${count}`}
        </button>
      </div>

      {count === 0 ? (
        <p className="mt-2 text-xs text-gray-500">
          Nobody to invite from the events you&rsquo;ve ticked — they may all be registered already.
        </p>
      ) : stale ? (
        <p className="mt-2 text-xs text-gray-500">Preview this exact list to unlock the send.</p>
      ) : null}

      {result && (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{result}</p>
      )}

      {preview && (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-gray-800">
            <strong>{preview.count}</strong> recipient{preview.count === 1 ? '' : 's'}
            {preview.subject ? ` · “${preview.subject}”` : ''}
          </p>
          {!!preview.recipients?.length && (
            <details className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium text-gray-700">
                Who this goes to ({preview.recipients.length})
              </summary>
              <p className="mt-2 max-h-40 overflow-y-auto break-words text-xs leading-relaxed text-gray-600">
                {preview.recipients.join(', ')}
              </p>
            </details>
          )}
          {preview.sampleHtml ? (
            <iframe
              title="Invitation preview"
              srcDoc={preview.sampleHtml}
              className="h-[440px] w-full rounded-lg border border-gray-200 bg-white"
            />
          ) : (
            <p className="text-sm text-gray-500">No recipients to preview.</p>
          )}
        </div>
      )}
    </div>
  );
}

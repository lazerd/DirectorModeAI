'use client';

/**
 * "Tell last term's families the new season is up."
 *
 * The email a club sends most and dreads most. The list is a side effect of
 * every registration, the dates come off the class, and anyone already signed
 * up for the class being promoted is dropped automatically — so the whole job
 * is choosing who and pressing send.
 */

import { useCallback, useEffect, useState } from 'react';
import { formatSessionDate } from '@/lib/programs/sessions';

type Source = {
  id: string;
  title: string;
  range_start: string;
  range_end: string;
  audience: string;
  people: number;
  finished: boolean;
};

type Upcoming = { id: string; title: string; slug: string; range_start: string; audience: string };

export default function PromotePanel({ timeZone }: { timeZone: string }) {
  const [sources, setSources] = useState<Source[]>([]);
  const [upcoming, setUpcoming] = useState<Upcoming[]>([]);
  const [totalPeople, setTotalPeople] = useState(0);
  const [target, setTarget] = useState<string>('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | 'test' | 'live'>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/club-site/programs/past-participants');
    const j = (await res.json().catch(() => ({}))) as {
      sources?: Source[];
      upcoming?: Upcoming[];
      total_people?: number;
      error?: string;
    };
    if (!res.ok) setError(j.error || 'Could not load your past participants.');
    else {
      setSources(j.sources ?? []);
      setUpcoming(j.upcoming ?? []);
      setTotalPeople(j.total_people ?? 0);
      if ((j.upcoming ?? []).length) setTarget(j.upcoming![0].id);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function send(mode: 'test' | 'live') {
    if (!target) return;
    setBusy(mode);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/club-site/programs/${target}/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          source_program_ids: [...chosen],
          note: note.trim() || undefined,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; families?: number };
      if (!res.ok) {
        setError(j.error || 'Could not send.');
        return;
      }
      setMsg(
        mode === 'test'
          ? 'Test sent to you — check your inbox, then send it for real.'
          : `Sent to ${j.families} ${j.families === 1 ? 'family' : 'families'}.`,
      );
    } catch {
      setError('Network problem — try again.');
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <p className="text-white/40">Loading…</p>;

  if (upcoming.length === 0) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-[#002838] p-5">
        <p className="text-white">Nothing to promote yet.</p>
        <p className="mt-1 text-sm text-white/50">
          Publish an upcoming class and you can email it to everyone who has registered before.
          {totalPeople > 0 ? ` You have ${totalPeople} families on the list.` : ''}
        </p>
      </div>
    );
  }

  // Nothing checked means everyone, which is the common case and needs saying.
  const reach = chosen.size
    ? sources.filter((s) => chosen.has(s.id)).reduce((n, s) => n + s.people, 0)
    : totalPeople;

  const field =
    'w-full rounded-lg border border-white/10 bg-[#001820] px-3 py-2 text-sm focus:border-[#D3FB52]/50 focus:outline-none';

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#002838] p-5">
      <h3 className="font-display text-lg text-white">Email past participants</h3>
      <p className="mt-1 text-sm text-white/50">
        Everyone who has ever registered for a class here — {totalPeople}{' '}
        {totalPeople === 1 ? 'family' : 'families'}. Anyone already signed up for the class you pick
        is left out automatically.
      </p>

      <div className="mt-4">
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/40">
          Promote which class
        </label>
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          style={{ color: '#ffffff' }}
          className={field}
        >
          {upcoming.map((u) => (
            <option key={u.id} value={u.id}>
              {u.title} — starts {formatSessionDate(u.range_start, timeZone)}
            </option>
          ))}
        </select>
      </div>

      {sources.length > 0 && (
        <div className="mt-4">
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/40">
            Who to write to
          </label>
          <p className="mb-2 text-xs text-white/40">
            Leave everything unticked to write to all {totalPeople}, or pick the classes whose
            families you want.
          </p>
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {sources.map((s) => (
              <label
                key={s.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-white/[0.04]"
              >
                <input
                  type="checkbox"
                  checked={chosen.has(s.id)}
                  onChange={(e) =>
                    setChosen((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(s.id);
                      else next.delete(s.id);
                      return next;
                    })
                  }
                />
                <span className="text-white/80">{s.title}</span>
                <span className="text-xs text-white/35">
                  {s.people} {s.people === 1 ? 'family' : 'families'} ·{' '}
                  {formatSessionDate(s.range_start, timeZone)}
                  {s.finished ? '' : ' · running now'}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={600}
        placeholder="Anything to add? (optional)"
        style={{ color: '#ffffff' }}
        className={`${field} mt-4`}
      />

      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      {msg && <p className="mt-3 text-sm text-[#D3FB52]">{msg}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => send('live')}
          disabled={busy !== null || !target}
          className="rounded-lg bg-[#D3FB52] px-4 py-2 text-sm font-semibold text-[#001820] disabled:opacity-50"
        >
          {busy === 'live' ? 'Sending…' : `Send to ${reach}`}
        </button>
        <button
          type="button"
          onClick={() => send('test')}
          disabled={busy !== null || !target}
          className="rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-white/70 hover:text-white disabled:opacity-50"
        >
          {busy === 'test' ? 'Sending…' : 'Send me a test first'}
        </button>
      </div>
    </div>
  );
}

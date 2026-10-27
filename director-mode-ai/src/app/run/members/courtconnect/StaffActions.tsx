'use client';

/**
 * The director's actions on one upcoming game (QA #16): take a player off,
 * change the game, or cancel it.
 *
 * Built for the phone call to the office: "take me out", "can we move it to
 * ten?", "it's raining, cancel it". Before this the director could see the
 * game and do nothing about it, and the earlier incident was fixed by hand in
 * SQL. Every action asks once before it happens, and the edit shows what
 * changes and who will be emailed before it saves, the same preview the host
 * gets on their own game page.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, Loader2, Pencil, UserMinus } from 'lucide-react';
import { DURATIONS, durationLabel, type GameChange } from '@/lib/partnerFinder/format';

type Seat = { seatId: string; name: string };
type EditValues = { date: string; time: string; duration: number; court: string; note: string; spots: number };
type Outcome = { ok?: boolean; result?: string; message?: string; error?: string; changes?: GameChange[]; tell?: string[]; noEmail?: string[] };

const btn =
  'inline-flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-2.5 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10 disabled:opacity-50';
const input = 'mt-0.5 w-full rounded-lg border border-white/15 bg-white/[0.04] px-2 py-1.5 text-xs text-white';

export default function StaffActions({
  gameId,
  seats,
  everyone,
  edit,
  maxSpots,
}: {
  gameId: string;
  /** Who is in, besides the host — each with the seat their Remove sends. */
  seats: Seat[];
  /** Host first, then everyone in: who a cancel emails. */
  everyone: string[];
  edit: EditValues;
  maxSpots: number;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<null | 'remove' | 'cancel' | 'edit'>(null);
  const [removing, setRemoving] = useState<Seat | null>(null);
  const [form, setForm] = useState(edit);
  const [preview, setPreview] = useState<null | { changes: GameChange[]; tell: string[]; noEmail: string[] }>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function call(body: Record<string, unknown>): Promise<Outcome> {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/play/games/${gameId}/staff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return (await res.json().catch(() => ({ error: 'That did not work.' }))) as Outcome;
    } catch {
      return { error: 'That did not work. Check your connection.' };
    } finally {
      setBusy(false);
    }
  }

  function finish(r: Outcome) {
    if (r.error || !r.ok) return setMsg({ ok: false, text: r.error || r.message || 'That did not work.' });
    setMsg({ ok: true, text: r.message || 'Done.' });
    setMode(null);
    setRemoving(null);
    setPreview(null);
    router.refresh();
  }

  async function editStep(save: boolean) {
    const r = await call({ action: 'edit', save, ...form });
    if (!save && r.ok) return setPreview({ changes: r.changes ?? [], tell: r.tell ?? [], noEmail: r.noEmail ?? [] });
    finish(r);
  }

  const set = <K extends keyof EditValues>(k: K, v: EditValues[K]) => {
    setPreview(null);
    setForm((f) => ({ ...f, [k]: v }));
  };
  const lowest = Math.max(seats.length, 1);

  return (
    <div className="mt-2 space-y-2">
      {mode == null && (
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => { setForm(edit); setPreview(null); setMode('edit'); }} className={btn}>
            <Pencil size={12} /> Edit
          </button>
          {seats.length > 0 && (
            <button onClick={() => setMode('remove')} className={btn}>
              <UserMinus size={12} /> Remove a player
            </button>
          )}
          <button onClick={() => setMode('cancel')} className={btn}>
            <Ban size={12} /> Cancel game
          </button>
        </div>
      )}

      {mode === 'remove' && (
        <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3 text-xs">
          {removing ? (
            <>
              <p className="font-semibold text-white">Take {removing.name} off this game?</p>
              <p className="mt-1 text-white/55">The host gets an email, and the spot opens for anyone in line.</p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={async () => finish(await call({ action: 'remove', seatId: removing.seatId }))}
                  disabled={busy}
                  className="rounded-lg bg-rose-400 px-2.5 py-1.5 font-semibold text-[#001016] disabled:opacity-50"
                >
                  {busy ? 'One moment…' : `Yes, take ${removing.name} off`}
                </button>
                <button onClick={() => setRemoving(null)} className="px-2.5 py-1.5 text-white/50 hover:text-white/80">
                  Keep them
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="font-semibold text-white">Who is coming off?</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {seats.map((s) => (
                  <button key={s.seatId} onClick={() => setRemoving(s)} className={btn}>
                    {s.name}
                  </button>
                ))}
                <button onClick={() => setMode(null)} className="px-2.5 py-1.5 text-white/50 hover:text-white/80">
                  Never mind
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {mode === 'cancel' && (
        <div className="rounded-xl border border-rose-300/30 bg-rose-400/[0.06] p-3 text-xs">
          <p className="font-semibold text-white">Cancel this game?</p>
          <p className="mt-1 text-white/60">
            Each of them gets an email saying the club cancelled it: {everyone.join(', ')}.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={async () => finish(await call({ action: 'cancel' }))}
              disabled={busy}
              className="rounded-lg bg-rose-400 px-2.5 py-1.5 font-semibold text-[#001016] disabled:opacity-50"
            >
              {busy ? 'One moment…' : 'Yes, cancel it'}
            </button>
            <button onClick={() => setMode(null)} className="px-2.5 py-1.5 text-white/50 hover:text-white/80">
              Keep the game
            </button>
          </div>
        </div>
      )}

      {mode === 'edit' && (
        <div className="space-y-2 rounded-xl border border-[#D3FB52]/30 bg-[#D3FB52]/[0.04] p-3 text-xs text-white/70">
          <div className="grid grid-cols-2 gap-2">
            <label>
              Day
              <input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} className={input} />
            </label>
            <label>
              Time
              <input type="time" step={900} value={form.time} onChange={(e) => set('time', e.target.value)} className={input} />
            </label>
            <label>
              How long
              <select value={form.duration} onChange={(e) => set('duration', Number(e.target.value))} className={input}>
                {[...new Set<number>([...DURATIONS, form.duration])]
                  .sort((a, b) => a - b)
                  .map((d) => (
                    <option key={d} value={d}>{durationLabel(d)}</option>
                  ))}
              </select>
            </label>
            <label>
              Players besides the host
              <select value={form.spots} onChange={(e) => set('spots', Number(e.target.value))} className={input}>
                {Array.from({ length: Math.max(maxSpots - lowest + 1, 1) }, (_, i) => lowest + i).map((n) => (
                  <option key={n} value={n}>
                    {n} ({n + 1} on court)
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block">
            Court
            <input value={form.court} onChange={(e) => set('court', e.target.value)} maxLength={60} placeholder="To be decided" className={input} />
          </label>
          <label className="block">
            Note
            <textarea value={form.note} onChange={(e) => set('note', e.target.value)} maxLength={500} rows={2} className={input} />
          </label>
          {seats.length > 0 && (
            <p className="text-white/40">{seats.length} already in, so players can&rsquo;t go below {seats.length}.</p>
          )}
          {preview ? (
            <div className="space-y-1.5 rounded-lg bg-white/[0.04] p-2">
              <ul className="space-y-0.5">
                {preview.changes.map((c) => (
                  <li key={c.field}>
                    <span className="text-white/45">{c.label}:</span> <span className="text-white/45 line-through">{c.from}</span>{' '}
                    &rarr; <strong className="text-white">{c.to}</strong>
                  </li>
                ))}
              </ul>
              <p className="text-white">
                {preview.tell.length ? `We'll email: ${preview.tell.join(', ')}` : 'Nobody gets an email about this.'}
              </p>
              {preview.noEmail.length > 0 && <p className="text-white/45">No email for {preview.noEmail.join(', ')}.</p>}
              <div className="flex gap-2">
                <button
                  onClick={() => editStep(true)}
                  disabled={busy}
                  className="rounded-lg bg-[#D3FB52] px-2.5 py-1.5 font-semibold text-[#002838] disabled:opacity-50"
                >
                  {busy ? 'Saving…' : 'Save changes'}
                </button>
                <button onClick={() => setPreview(null)} className="px-2.5 py-1.5 text-white/50 hover:text-white/80">
                  Change
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => editStep(false)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#D3FB52] px-2.5 py-1.5 font-semibold text-[#002838] disabled:opacity-50"
              >
                {busy && <Loader2 size={12} className="animate-spin" />} Next
              </button>
              <button onClick={() => setMode(null)} className="px-2.5 py-1.5 text-white/50 hover:text-white/80">
                Never mind
              </button>
            </div>
          )}
        </div>
      )}

      {msg && <span className={`block text-xs ${msg.ok ? 'text-emerald-300' : 'text-rose-300'}`}>{msg.text}</span>}
    </div>
  );
}

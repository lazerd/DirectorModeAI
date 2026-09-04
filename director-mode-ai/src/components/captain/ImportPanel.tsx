'use client';

/**
 * Paste-to-import (CaptainMode spec §7).
 *
 * The captain copies their team page from wherever it lives — TopDog, USTA
 * TennisLink, tenniscores, a spreadsheet — pastes it here, and an LLM pulls out
 * the roster and schedule. Nothing is written until they look at the preview and
 * press the confirm button, and the commit skips anything already on the team,
 * so re-pasting the same page is harmless.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type PPlayer = { name: string; email?: string | null; rating?: number | null; is_sub?: boolean };
type PMatch = {
  date: string;
  time?: string | null;
  is_home: boolean;
  opponent?: string | null;
  location?: string | null;
};
type Preview = { players: PPlayer[]; matches: PMatch[]; notes?: string[] };

const field =
  'w-full px-3 py-2 rounded-lg bg-[#001820] border border-white/10 text-white placeholder-white/25 focus:border-[#D3FB52]/50 focus:outline-none text-sm';

export default function ImportPanel({
  teamId,
  teamIsEmpty = false,
}: {
  teamId: string;
  teamIsEmpty?: boolean;
}) {
  const router = useRouter();
  // A brand-new team opens straight into the paste box. The captain arriving
  // here has nothing to do BUT import, so making them find a button first is
  // the step that sent one captain to the wrong box entirely.
  const [open, setOpen] = useState(teamIsEmpty);
  const [text, setText] = useState('');

  /*
   * The paste survives a remount.
   *
   * Darrin hit "it keeps deleting what I paste into the box" — the text landed
   * and then vanished. Nothing in this component clears `text` except a
   * successful commit, which means the component was being remounted and
   * useState('') was running again. Rather than hunt every possible cause of a
   * remount (a router.refresh from a sibling panel, a re-render that changes
   * this subtree's identity, a background token refresh), the paste is simply
   * made durable: it is the single most expensive thing on this screen to
   * reproduce, because re-creating it means going back to the league site and
   * selecting the whole page again.
   *
   * sessionStorage, not localStorage: this is a scratch buffer for one sitting,
   * not something to greet the captain with next month. Scoped per team so two
   * teams open in two tabs don't overwrite each other. Every access is wrapped —
   * Safari in private mode throws on the getter itself.
   */
  const storageKey = `captain:import:${teamId}`;
  const restored = useRef(false);

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        setText(saved);
        setOpen(true);
      }
    } catch {
      // No session storage (private mode, storage disabled). Nothing to restore.
    }
  }, [storageKey]);

  useEffect(() => {
    // Only after the restore pass, or the first render would blank the saved
    // copy with the empty initial state.
    if (!restored.current) return;
    try {
      if (text) sessionStorage.setItem(storageKey, text);
      else sessionStorage.removeItem(storageKey);
    } catch {
      // Storage full or unavailable — the paste still works, it just won't
      // survive a reload. Never worth breaking the import over.
    }
  }, [text, storageKey]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [skipPlayers, setSkipPlayers] = useState<Set<number>>(new Set());
  const [skipMatches, setSkipMatches] = useState<Set<number>>(new Set());

  function toggle(set: Set<number>, i: number, apply: (s: Set<number>) => void) {
    const next = new Set(set);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    apply(next);
  }

  async function parse(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch('/api/captain/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: teamId, text }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not read that paste.');
      setPreview(json as Preview);
      setSkipPlayers(new Set());
      setSkipMatches(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/captain/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          team_id: teamId,
          commit: true,
          players: preview.players.filter((_, i) => !skipPlayers.has(i)),
          matches: preview.matches.filter((_, i) => !skipMatches.has(i)),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Import failed.');
      const { players, matches } = json.added || {};
      const skipped = (json.skipped?.players ?? 0) + (json.skipped?.matches ?? 0);
      setDone(
        `Added ${players} player${players === 1 ? '' : 's'} and ${matches} match${
          matches === 1 ? '' : 'es'
        }.` + (skipped ? ` ${skipped} already on the team, left alone.` : ''),
      );
      setPreview(null);
      setText('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Ctrl+V anywhere on this panel imports, without hunting for the textarea.
   * The captain has just copied a whole page; the next thing they do is paste,
   * and it should land somewhere no matter where the cursor is.
   */
  function handlePaste(e: React.ClipboardEvent) {
    if (preview) return;
    const pasted = e.clipboardData?.getData('text') ?? '';
    if (!pasted.trim()) return;
    // Let the textarea handle its own paste normally.
    if ((e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
    e.preventDefault();
    setText(pasted);
    setOpen(true);
    setError(null);
    setDone(null);
  }

  const keptPlayers = preview ? preview.players.length - skipPlayers.size : 0;
  const keptMatches = preview ? preview.matches.length - skipMatches.size : 0;

  return (
    <section className="mt-10" onPaste={handlePaste}>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-display text-white">Import from your league site</h2>
        <button
          onClick={() => {
            setOpen((v) => !v);
            setError(null);
            setDone(null);
          }}
          className="text-sm px-4 py-2 rounded-xl border border-white/10 text-white/70 hover:text-white hover:border-white/25"
        >
          {open ? 'Cancel' : '+ Paste a page'}
        </button>
      </div>

      {done && <p className="text-sm text-[#D3FB52] mt-3">{done}</p>}
      {error && <p className="text-sm text-red-300 mt-3">{error}</p>}

      {open && !preview && (
        <form onSubmit={parse} className="mt-4 rounded-2xl border border-white/[0.08] bg-[#002838] p-5">
          <ol className="text-sm text-white/70 mb-3 space-y-1.5">
            <li>
              <span className="text-white/40 mr-2">1.</span>Open your team page on TopDog,
              TennisLink, tenniscores — or a spreadsheet.
            </li>
            <li>
              <span className="text-white/40 mr-2">2.</span>Select the whole page and copy it —{' '}
              <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/80 text-xs">Ctrl</kbd>
              <span className="text-white/30 mx-0.5">+</span>
              <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/80 text-xs">A</kbd>
              <span className="text-white/30 mx-1.5">then</span>
              <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/80 text-xs">Ctrl</kbd>
              <span className="text-white/30 mx-0.5">+</span>
              <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/80 text-xs">C</kbd>
              <span className="text-white/30 ml-2">(⌘ on a Mac)</span>
            </li>
            <li>
              <span className="text-white/40 mr-2">3.</span>Come back here and paste —{' '}
              <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/80 text-xs">Ctrl</kbd>
              <span className="text-white/30 mx-0.5">+</span>
              <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/80 text-xs">V</kbd>
              <span className="text-white/30 ml-2">anywhere on this panel.</span>
            </li>
          </ol>
          <p className="text-xs text-white/35 mb-2">
            Roster, schedule, or both. Menus, footers and adverts are fine — they get ignored.
            Nothing is saved until you review it on the next screen.
          </p>
          <textarea
            id="paste"
            rows={10}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste the whole page here — extra menus and footers are fine, they get ignored."
            className={field}
          />
          <button
            type="submit"
            disabled={busy || !text.trim()}
            className="mt-3 px-5 py-2.5 rounded-xl bg-[#D3FB52] text-[#001820] font-semibold disabled:opacity-50"
          >
            {busy ? 'Reading…' : 'Read this paste'}
          </button>
        </form>
      )}

      {preview && (
        <div className="mt-4 rounded-2xl border border-white/[0.08] bg-[#002838] p-5">
          <p className="text-sm text-white/60">
            Here&apos;s what I found. Untick anything you don&apos;t want, then confirm.
          </p>

          {preview.notes?.length ? (
            <ul className="mt-3 space-y-1">
              {preview.notes.map((n, i) => (
                <li key={i} className="text-xs text-amber-300/90">
                  ⚠ {n}
                </li>
              ))}
            </ul>
          ) : null}

          {preview.players.length > 0 && (
            <div className="mt-5">
              <h3 className="text-white/50 text-sm uppercase tracking-wide mb-2">
                Players ({keptPlayers} of {preview.players.length})
              </h3>
              <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
                {preview.players.map((p, i) => (
                  <label
                    key={i}
                    className="flex items-center gap-3 text-sm text-white/80 py-1 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={!skipPlayers.has(i)}
                      onChange={() => toggle(skipPlayers, i, setSkipPlayers)}
                    />
                    <span className="flex-1">{p.name}</span>
                    <span className="text-white/40 text-xs">{p.email || 'no email'}</span>
                    <span className="text-white/60 text-xs w-10 text-right">
                      {p.rating ?? '—'}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {preview.matches.length > 0 && (
            <div className="mt-5">
              <h3 className="text-white/50 text-sm uppercase tracking-wide mb-2">
                Matches ({keptMatches} of {preview.matches.length})
              </h3>
              <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
                {preview.matches.map((m, i) => (
                  <label
                    key={i}
                    className="flex items-center gap-3 text-sm text-white/80 py-1 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={!skipMatches.has(i)}
                      onChange={() => toggle(skipMatches, i, setSkipMatches)}
                    />
                    <span className="w-28">{m.date}</span>
                    <span className="w-14 text-white/50">{m.time || '—'}</span>
                    <span
                      className={`w-14 text-xs ${m.is_home ? 'text-[#D3FB52]' : 'text-white/40'}`}
                    >
                      {m.is_home ? 'HOME' : 'away'}
                    </span>
                    <span className="flex-1 truncate">{m.opponent || '—'}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={commit}
              disabled={busy || (keptPlayers === 0 && keptMatches === 0)}
              className="px-5 py-2.5 rounded-xl bg-[#D3FB52] text-[#001820] font-semibold disabled:opacity-50"
            >
              {busy ? 'Adding…' : `Add ${keptPlayers} player(s) + ${keptMatches} match(es)`}
            </button>
            <button
              onClick={() => setPreview(null)}
              className="text-sm px-4 py-2 rounded-xl border border-white/10 text-white/70 hover:text-white"
            >
              Back
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

'use client';

/**
 * Paste ratings in from TennisRecord (or anywhere else) and match them to the
 * roster.
 *
 * TennisRecord has no API and blocks automated requests, so the captain looks
 * the players up in their own browser and pastes the block here. Preview is
 * mandatory: giving one player another player's rating is the kind of error
 * nobody catches by eye later.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Match = {
  playerId: string;
  playerName: string;
  rating: number;
  matchedOn: string;
  previousRating: number | null;
};
type Preview = {
  matched: Match[];
  unmatched: { name: string; rating: number }[];
  ambiguous: { parsed: { name: string; rating: number }; candidates: string[] }[];
  missing: string[];
};

export default function RatingsPastePanel({ teamId }: { teamId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [rank, setRank] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(action: 'preview' | 'apply') {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch('/api/captain/ratings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: teamId, text, action, rank }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error || 'Could not read that.');
        return;
      }
      if (action === 'preview') setPreview(j as Preview);
      else {
        setPreview(null);
        setText('');
        setMsg(
          `Updated ${j.updated} rating${j.updated === 1 ? '' : 's'}` +
            (j.ranked ? ` and re-ranked ${j.ranked} players.` : '.'),
        );
        router.refresh();
      }
    } catch {
      setError('Network problem — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-white/[0.08] bg-[#002838] p-5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-sm text-white/70 hover:text-white"
      >
        {open ? '− ' : '+ '}Paste ratings from TennisRecord
      </button>

      {msg && <p className="text-sm text-[#D3FB52] mt-3">{msg}</p>}
      {error && <p className="text-sm text-red-300 mt-3">{error}</p>}

      {open && (
        <div className="mt-4">
          <p className="text-xs text-white/40 mb-2">
            TennisRecord has no API and blocks automated access, so look your players up there and
            copy the block in. Name and rating per line, any column order — &ldquo;Last, First&rdquo;
            and &ldquo;J. Smith&rdquo; both work. Nothing is saved until you confirm.
          </p>
          <textarea
            rows={6}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setPreview(null);
            }}
            // Invented names on purpose: these placeholders were real players
            // from a live roster, shown to every captain who opens the app.
            placeholder={'Jordan Avery\t3.42\t8-4\nEllis, Robin\t3.61\t7-5'}
            style={{ color: '#ffffff' }}
            className="w-full px-3 py-2 rounded-lg bg-[#001820] border border-white/10 placeholder-white/25 focus:border-[#D3FB52]/50 focus:outline-none text-sm font-mono"
          />

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              onClick={() => call('preview')}
              disabled={busy || !text.trim()}
              className="px-4 py-2 rounded-xl border border-white/10 text-white/70 hover:text-white hover:border-white/25 text-sm disabled:opacity-40"
            >
              {busy ? 'Reading…' : 'Preview'}
            </button>
            <label className="flex items-center gap-2 text-sm text-white/50">
              <input
                type="checkbox"
                checked={rank}
                onChange={(e) => setRank(e.target.checked)}
                className="w-4 h-4"
              />
              Also set strength order from these ratings
            </label>
          </div>

          {preview && (
            <div className="mt-4 space-y-3 text-sm">
              {preview.matched.length > 0 ? (
                <div>
                  <h4 className="text-white/50 text-xs uppercase tracking-wide mb-1">
                    Will update ({preview.matched.length})
                  </h4>
                  <ul className="space-y-0.5">
                    {preview.matched.map((m) => (
                      <li key={m.playerId} className="text-white">
                        {m.playerName}{' '}
                        <span className="text-white/35">
                          {m.previousRating ?? '—'} → {m.rating}
                          {m.matchedOn !== 'exact' && ` · matched on ${m.matchedOn}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-amber-300/90">Nothing matched the roster.</p>
              )}

              {preview.ambiguous.length > 0 && (
                <div>
                  <h4 className="text-amber-300/90 text-xs uppercase tracking-wide mb-1">
                    Skipped — more than one player fits
                  </h4>
                  <ul className="space-y-0.5 text-amber-100/70">
                    {preview.ambiguous.map((a, i) => (
                      <li key={i}>
                        {a.parsed.name} ({a.parsed.rating}) — could be {a.candidates.join(' or ')}.
                        Set it by hand.
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {preview.unmatched.length > 0 && (
                <div>
                  <h4 className="text-white/40 text-xs uppercase tracking-wide mb-1">
                    Not on this roster
                  </h4>
                  <p className="text-white/40">
                    {preview.unmatched.map((u) => `${u.name} (${u.rating})`).join(', ')}
                  </p>
                </div>
              )}

              {preview.missing.length > 0 && (
                <div>
                  <h4 className="text-white/40 text-xs uppercase tracking-wide mb-1">
                    No rating pasted for
                  </h4>
                  <p className="text-white/40">{preview.missing.join(', ')}</p>
                </div>
              )}

              {preview.matched.length > 0 && (
                <button
                  onClick={() => call('apply')}
                  disabled={busy}
                  className="px-5 py-2.5 rounded-xl bg-[#D3FB52] text-[#001820] font-semibold disabled:opacity-50"
                >
                  {busy ? 'Saving…' : `Apply ${preview.matched.length} ratings`}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

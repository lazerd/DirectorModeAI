'use client';

/**
 * Paste World Tennis Numbers in and match them to the roster.
 *
 * WTN is what turns line order from an opinion into arithmetic: average the two
 * numbers on a pair and courts 1 through 4 sort themselves. The scale is
 * inverted against NTRP — 1 is a pro, 40 is a beginner — so the preview is
 * mandatory and says "lower is stronger" everywhere a number appears.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Match = {
  playerId: string;
  playerName: string;
  wtn: number;
  wtnDoubles: number | null;
  matchedOn: string;
  previousWtn: number | null;
  previousWtnDoubles: number | null;
};
type Preview = {
  matched: Match[];
  unmatched: { name: string; wtn: number; wtnDoubles: number | null }[];
  ambiguous: { parsed: { name: string; wtn: number }; candidates: string[] }[];
  ntrpLooking: string[];
  missing: string[];
};

const fmt = (m: Match) =>
  m.wtnDoubles != null ? `${m.wtn} S / ${m.wtnDoubles} D` : `${m.wtn}`;
const fmtPrev = (m: Match) =>
  m.previousWtn == null
    ? '—'
    : m.previousWtnDoubles != null
      ? `${m.previousWtn} S / ${m.previousWtnDoubles} D`
      : `${m.previousWtn}`;

export default function WtnPastePanel({ teamId }: { teamId: string }) {
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
      const res = await fetch('/api/captain/wtn', {
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
          `Saved ${j.updated} WTN${j.updated === 1 ? '' : 's'}` +
            (j.ranked ? `, ranked ${j.ranked} players strongest-first` : '') +
            (j.sharedWith
              ? `. ${j.sharedWith} now follow${j.sharedWith === 1 ? 's' : ''} the player across every ClubMode tool.`
              : '.') +
            (j.notLinked
              ? ` ${j.notLinked} stayed on this roster only — they join the rest once the nightly player sync links them up.`
              : ''),
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
      <button onClick={() => setOpen((v) => !v)} className="text-sm text-white/70 hover:text-white">
        {open ? '− ' : '+ '}Paste WTNs from USTA
      </button>

      {msg && <p className="text-sm text-[#D3FB52] mt-3">{msg}</p>}
      {error && <p className="text-sm text-red-300 mt-3">{error}</p>}

      {open && (
        <div className="mt-4">
          <p className="text-xs text-white/40 mb-2">
            On usta.com, open each player&rsquo;s profile (or your team page) and copy the name and
            World Tennis Number across. One player per line, any column order. Two numbers on a line
            are read as <strong className="text-white/60">singles then doubles</strong>.{' '}
            <strong className="text-white/60">Lower is stronger</strong> — WTN runs 40 (beginner) to
            1 (pro), the opposite way to NTRP. Nothing is saved until you confirm.
          </p>
          <textarea
            rows={6}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setPreview(null);
            }}
            placeholder={'Leena Elias\t18.4\t17.9\nMoore, Shannon\t16.2\nPaula Garcia  19.7  19.1'}
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
              Also set strength order from these WTNs
            </label>
          </div>

          {preview && (
            <div className="mt-4 space-y-3 text-sm">
              {preview.matched.length > 0 ? (
                <div>
                  <h4 className="text-white/50 text-xs uppercase tracking-wide mb-1">
                    Will save ({preview.matched.length})
                  </h4>
                  <ul className="space-y-0.5">
                    {preview.matched.map((m) => (
                      <li key={m.playerId} className="text-white">
                        {m.playerName}{' '}
                        <span className="text-white/35">
                          {fmtPrev(m)} → {fmt(m)}
                          {m.matchedOn !== 'exact' && ` · matched on ${m.matchedOn}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-amber-300/90">Nothing matched the roster.</p>
              )}

              {preview.ntrpLooking.length > 0 && (
                <div>
                  <h4 className="text-amber-300/90 text-xs uppercase tracking-wide mb-1">
                    Skipped — these look like NTRP ratings, not WTNs
                  </h4>
                  <p className="text-amber-100/70">
                    {preview.ntrpLooking.slice(0, 6).join(' · ')}
                    {preview.ntrpLooking.length > 6 ? ' …' : ''}
                  </p>
                  <p className="text-white/35 text-xs mt-1">
                    Ratings go in &ldquo;Paste ratings from TennisRecord&rdquo; above. A 3.5 saved
                    here would read as a near-professional WTN and flip your line order.
                  </p>
                </div>
              )}

              {preview.ambiguous.length > 0 && (
                <div>
                  <h4 className="text-amber-300/90 text-xs uppercase tracking-wide mb-1">
                    Skipped — more than one player fits
                  </h4>
                  <ul className="space-y-0.5 text-amber-100/70">
                    {preview.ambiguous.map((a, i) => (
                      <li key={i}>
                        {a.parsed.name} ({a.parsed.wtn}) — could be {a.candidates.join(' or ')}. Set
                        it by hand.
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
                    {preview.unmatched.map((u) => `${u.name} (${u.wtn})`).join(', ')}
                  </p>
                </div>
              )}

              {preview.missing.length > 0 && (
                <div>
                  <h4 className="text-white/40 text-xs uppercase tracking-wide mb-1">
                    No WTN pasted for
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
                  {busy ? 'Saving…' : `Save ${preview.matched.length} WTNs`}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

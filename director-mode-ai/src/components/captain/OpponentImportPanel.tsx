'use client';

/**
 * Paste the league's captain contact list.
 *
 * The section publishes one spreadsheet before the season with every team's
 * captains, USTA numbers, Safe Play expiries, emails and phones. Until now a
 * captain either kept that tab open all season or retyped the two contacts they
 * thought they'd need.
 *
 * Preview then confirm, like every other paste in CaptainMode: nothing is
 * written until the rows are on screen and ticked. Teams outside this team's
 * division, and the captain's own team, arrive UNTICKED — they are almost
 * always noise, but a club fielding an A and a B side in one division means
 * "wrong division" cannot be an automatic exclusion.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ClipboardList } from 'lucide-react';
import type { ParsedOpponentRow } from '@/lib/captain/opponentPaste';

const field =
  'w-full px-3 py-2.5 rounded-xl bg-[#001820] border border-white/10 placeholder-white/25 focus:border-[#D3FB52]/50 focus:outline-none text-sm';
// globals.css styles bare inputs outside Tailwind's layers and wins the
// cascade, so the colour has to be inline. See the note in RosterPanel.
const INPUT_COLOR = { color: '#ffffff' } as const;

export default function OpponentImportPanel({
  teamId,
  division,
}: {
  teamId: string;
  division: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [rows, setRows] = useState<ParsedOpponentRow[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function preview(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch('/api/captain/opponents/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: teamId, text }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error || 'Could not read that.');
        return;
      }
      const parsed = (j.rows || []) as ParsedOpponentRow[];
      setRows(parsed);
      setWarnings(j.warnings || []);
      setPicked(
        new Set(
          parsed.map((r, i) => (r.isSelf || r.otherDivision ? -1 : i)).filter((i) => i >= 0),
        ),
      );
    } catch {
      setError('Network problem — try again.');
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    const chosen = (rows || []).filter((_, i) => picked.has(i));
    if (!chosen.length) {
      setError('Tick at least one team.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/captain/opponents/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: teamId, commit: true, rows: chosen }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error || 'Could not save.');
        return;
      }
      setDone(`${j.added} added, ${j.updated} updated.`);
      setRows(null);
      setText('');
      setOpen(false);
      router.refresh();
    } catch {
      setError('Network problem — try again.');
    } finally {
      setBusy(false);
    }
  }

  const toggle = (i: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  if (!open) {
    return (
      <div className="mt-3">
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 text-white/70 hover:text-white hover:border-white/25 text-sm"
        >
          <ClipboardList size={15} className="text-[#D3FB52]" />
          Paste the league contact list
        </button>
        {done && <p className="mt-2 text-sm text-[#D3FB52]">{done}</p>}
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-2xl border border-white/[0.08] bg-[#002838] p-5">
      {!rows && (
        <form onSubmit={preview} className="space-y-3">
          <div>
            <h3 className="text-white font-semibold">Paste the league contact list</h3>
            <p className="text-white/45 text-[13px] mt-1">
              Open the section&rsquo;s captain contact spreadsheet, select the rows, copy, and paste
              them here — headers and all. Every captain listed for a team comes across with their
              USTA number, Safe Play expiry, email and phone.
            </p>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder={'Team ID\tTeam Name/Program\tDivision\tCaptain Name\tUSTA #\t…'}
            style={INPUT_COLOR}
            className={`${field} font-mono text-[12px]`}
          />
          {error && <p className="text-sm text-red-300">{error}</p>}
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={busy || !text.trim()}
              className="px-5 py-2.5 rounded-xl bg-[#D3FB52] text-[#001820] font-semibold disabled:opacity-50"
            >
              {busy ? 'Reading…' : 'Preview'}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-5 py-2.5 rounded-xl text-white/60 hover:text-white"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {rows && (
        <div className="space-y-3">
          <h3 className="text-white font-semibold">
            {rows.length} {rows.length === 1 ? 'team' : 'teams'} found
            {division ? ` · your division is ${division}` : ''}
          </h3>

          {warnings.map((w) => (
            <p key={w} className="text-[13px] text-amber-200/80">
              {w}
            </p>
          ))}

          <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
            {rows.map((r, i) => (
              <label
                key={r.teamId}
                className={`flex gap-3 items-start rounded-xl border p-3 cursor-pointer transition ${
                  picked.has(i)
                    ? 'border-[#D3FB52]/40 bg-[#D3FB52]/[0.05]'
                    : 'border-white/[0.06] bg-[#001820]/50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={picked.has(i)}
                  onChange={() => toggle(i)}
                  className="mt-1 w-4 h-4 accent-[#D3FB52] shrink-0"
                />
                <div className="min-w-0">
                  <div className="text-white text-sm font-medium">
                    {r.teamName}
                    {r.isSelf && (
                      <span className="ml-2 text-[11px] text-amber-200/80">your own team</span>
                    )}
                    {r.otherDivision && (
                      <span className="ml-2 text-[11px] text-white/35">
                        {r.division} — different division
                      </span>
                    )}
                  </div>
                  <div className="text-white/35 text-[12px]">
                    {r.division} · Team ID {r.teamId}
                  </div>
                  {r.captains.length === 0 ? (
                    <div className="text-white/30 text-[12px] mt-1">no captains listed</div>
                  ) : (
                    <ul className="mt-1 space-y-0.5">
                      {r.captains.map((c) => (
                        <li key={c.name} className="text-[12px] text-white/55">
                          {c.name}
                          {c.email ? ` · ${c.email}` : ''}
                          {c.phone ? ` · ${c.phone}` : ''}
                          {!c.email && !c.phone && (
                            <span className="text-white/30"> · no contact details</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </label>
            ))}
          </div>

          {error && <p className="text-sm text-red-300">{error}</p>}
          <p className="text-[12px] text-white/35">
            Re-pasting a later version of the sheet replaces each team&rsquo;s contacts, so someone
            who has stepped down drops off rather than lingering.
          </p>

          <div className="flex gap-3">
            <button
              onClick={commit}
              disabled={busy}
              className="px-5 py-2.5 rounded-xl bg-[#D3FB52] text-[#001820] font-semibold disabled:opacity-50"
            >
              {busy ? 'Saving…' : `Add ${picked.size} ${picked.size === 1 ? 'team' : 'teams'}`}
            </button>
            <button
              onClick={() => setRows(null)}
              className="px-5 py-2.5 rounded-xl text-white/60 hover:text-white"
            >
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

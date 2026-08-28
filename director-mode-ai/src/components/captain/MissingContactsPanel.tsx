'use client';

/**
 * Fill in every missing mobile number in one pass.
 *
 * The roster's Edit panel can already set a phone, but doing it for twelve
 * players is twelve expand-type-collapse cycles — which is exactly why the Fall
 * B2/B3 roster sat at zero numbers while every texting feature built on top of
 * it stayed inert. One list, one Save.
 *
 * Deliberately shows the players who are MISSING one first and collapses the
 * rest: the job is closing the gap, not admiring the numbers already there.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatPhone, normalizePhone } from '@/lib/captain/phone';

export type ContactRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  is_sub: boolean;
};

const field =
  'w-full px-3 py-2 rounded-lg bg-[#001820] border border-white/10 text-white placeholder-white/25 focus:border-[#D3FB52]/50 focus:outline-none text-sm';

export default function MissingContactsPanel({
  teamId,
  players,
}: {
  teamId: string;
  players: ContactRow[];
}) {
  const router = useRouter();
  const missing = players.filter((p) => !p.phone?.trim());
  const have = players.filter((p) => !!p.phone?.trim());

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [showHave, setShowHave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filled = Object.entries(draft).filter(([, v]) => v.trim().length > 0);

  async function save(rows: { player_id: string; phone: string }[]) {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch('/api/captain/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: teamId, updates: rows }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error || 'Could not save those numbers.');
        return;
      }
      const bad = (j.rejected as { name: string; value: string }[]) || [];
      if (bad.length) {
        setError(
          `Saved ${j.saved}. Could not read: ${bad
            .map((b) => `${b.name} (“${b.value}”)`)
            .join(', ')} — use 10 digits, or +1 and the number.`,
        );
      } else {
        setMsg(`Saved ${j.saved} number${j.saved === 1 ? '' : 's'}.`);
      }
      setDraft({});
      router.refresh();
    } catch {
      setError('Network problem — try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!players.length) return null;

  return (
    <div className="mt-4 rounded-2xl border border-white/[0.08] bg-[#002838] p-5">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="text-white font-medium">Mobile numbers</h3>
        <span className="text-white/45 text-sm">
          {have.length} of {players.length} on file
        </span>
      </div>

      <p className="text-white/40 text-xs mt-1">
        Needed to text a player about a lineup change. Type or paste any format —
        <span className="text-white/60"> 925-555-0148</span> is fine — and they are stored in the
        form the carrier needs.
      </p>

      {msg && <p className="text-sm text-[#D3FB52] mt-3">{msg}</p>}
      {error && <p className="text-sm text-red-300 mt-3">{error}</p>}

      {missing.length === 0 ? (
        <p className="text-sm text-[#D3FB52] mt-3">
          Everyone has a mobile number — the whole roster is reachable by text.
        </p>
      ) : (
        <>
          <div className="mt-4 space-y-2">
            {missing.map((p) => (
              <div key={p.id} className="flex items-center gap-3">
                <span className="flex-1 min-w-0 truncate text-white text-sm">
                  {p.name}
                  {p.is_sub && <span className="text-white/30 text-xs"> · sub</span>}
                  {!p.email && (
                    <span className="text-amber-300/60 text-xs"> · no email either</span>
                  )}
                </span>
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  placeholder="925-555-0148"
                  value={draft[p.id] ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                  onKeyDown={(e) => {
                    // Enter saves the whole list — a captain working down it
                    // with a phone in the other hand shouldn't have to aim.
                    if (e.key === 'Enter' && filled.length) {
                      e.preventDefault();
                      void save(filled.map(([id, v]) => ({ player_id: id, phone: v })));
                    }
                  }}
                  aria-label={`Mobile number for ${p.name}`}
                  style={{ color: '#ffffff' }}
                  className={`${field} w-44 shrink-0`}
                />
              </div>
            ))}
          </div>

          <button
            onClick={() => save(filled.map(([id, v]) => ({ player_id: id, phone: v })))}
            disabled={busy || filled.length === 0}
            className="mt-4 px-5 py-2.5 rounded-xl bg-[#D3FB52] text-[#001820] font-semibold text-sm disabled:opacity-40"
          >
            {busy
              ? 'Saving…'
              : filled.length
                ? `Save ${filled.length} number${filled.length === 1 ? '' : 's'}`
                : `${missing.length} still missing`}
          </button>
        </>
      )}

      {have.length > 0 && (
        <div className="mt-4 pt-4 border-t border-white/[0.08]">
          <button
            onClick={() => setShowHave((v) => !v)}
            className="text-sm text-white/50 hover:text-white"
          >
            {showHave ? '− ' : '+ '}
            {have.length} already on file
          </button>
          {showHave && (
            <div className="mt-3 space-y-2">
              {have.map((p) => (
                <div key={p.id} className="flex items-center gap-3">
                  <span className="flex-1 min-w-0 truncate text-white/70 text-sm">{p.name}</span>
                  <input
                    type="tel"
                    inputMode="tel"
                    // Stored as +19255550148; shown as (925) 555-0148, because
                    // that is how a captain reads a number back to check it.
                    defaultValue={formatPhone(p.phone)}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      // Compare normalised, or re-formatting on render looks
                      // like an edit and saves on every blur.
                      if (normalizePhone(v) !== p.phone) {
                        void save([{ player_id: p.id, phone: v }]);
                      }
                    }}
                    aria-label={`Mobile number for ${p.name}`}
                    style={{ color: '#ffffff' }}
                    className={`${field} w-44 shrink-0`}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

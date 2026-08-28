'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Player = {
  id: string;
  name: string;
  email: string | null;
  /** mobile number, for texting one player about a late change */
  phone: string | null;
  rating: number | null;
  /** World Tennis Number — LOWER is stronger, opposite way to NTRP */
  wtn: number | null;
  wtn_doubles: number | null;
  gender: 'M' | 'F' | null;
  return_side: 'deuce' | 'ad' | null;
  court_limit: string | null;
  court_note: string | null;
  rating_type: 'computer' | 'self' | 'appeal';
  is_sub: boolean;
  notes: string | null;
};

type Pref = { player_id: string; preferred_player_id: string; rank: number };
type Eligibility = {
  playerId: string;
  name: string;
  played: number;
  required: number;
  short: number;
  eligible: boolean;
};

const field =
  'w-full px-3 py-2 rounded-lg bg-[#001820] border border-white/10 text-white placeholder-white/25 focus:border-[#D3FB52]/50 focus:outline-none text-sm';

export default function RosterPanel({
  teamId,
  players,
  partnerPrefs,
  eligibility,
  leagueType,
  eligibilityEnabled,
}: {
  teamId: string;
  players: Player[];
  partnerPrefs: Pref[];
  neverPairs: unknown[];
  eligibility: Eligibility[];
  leagueType: string;
  eligibilityEnabled: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [bulk, setBulk] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsGender = leagueType === 'usta_mixed';

  async function addBulk(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // One player per line: "Name, email, rating"
    const rows = bulk
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, email, rating] = line.split(',').map((s) => s?.trim());
        return {
          name,
          email: email || undefined,
          rating: rating ? Number(rating) : null,
        };
      })
      .filter((p) => p.name);

    if (!rows.length) {
      setError('Add at least one name.');
      setBusy(false);
      return;
    }
    try {
      const res = await fetch('/api/captain/players', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: teamId, players: rows }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setError(j.error || 'Could not add players.');
      else {
        setBulk('');
        setAdding(false);
        router.refresh();
      }
    } catch {
      setError('Network problem — try again.');
    } finally {
      setBusy(false);
    }
  }

  async function patch(playerId: string, body: Record<string, unknown>, prefs?: Pref[]) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/captain/players', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          team_id: teamId,
          player_id: playerId,
          patch: body,
          partner_prefs: prefs?.map((p, i) => ({
            preferred_player_id: p.preferred_player_id,
            rank: i + 1,
          })),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || 'Could not save.');
      } else {
        router.refresh();
      }
    } catch {
      setError('Network problem — try again.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(playerId: string) {
    setBusy(true);
    await fetch(`/api/captain/players?team_id=${teamId}&player_id=${playerId}`, {
      method: 'DELETE',
    });
    setBusy(false);
    router.refresh();
  }

  const elig = (id: string) => eligibility.find((e) => e.playerId === id);
  const prefsFor = (id: string) =>
    partnerPrefs.filter((p) => p.player_id === id).sort((a, b) => a.rank - b.rank);
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? '—';

  const roster = players.filter((p) => !p.is_sub);
  const subs = players.filter((p) => p.is_sub);

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-display text-white">Roster</h2>
        <button
          onClick={() => setAdding((v) => !v)}
          className="text-sm px-4 py-2 rounded-xl border border-white/10 text-white/70 hover:text-white hover:border-white/25"
        >
          {adding ? 'Cancel' : '+ Add players'}
        </button>
      </div>

      {error && <p className="text-sm text-red-300 mt-3">{error}</p>}

      {adding && (
        <form
          onSubmit={addBulk}
          className="mt-4 rounded-2xl border border-white/[0.08] bg-[#002838] p-5"
        >
          <label htmlFor="bulk" className="block text-sm text-white/60 mb-1">
            One player per line — <span className="text-white/40">Name, email, rating</span>
          </label>
          <textarea
            id="bulk"
            rows={5}
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
            placeholder={'Sally Chen, sally@example.com, 3.5\nWendy Ruiz, wendy@example.com, 4.0'}
            className={field}
          />
          <button
            type="submit"
            disabled={busy}
            className="mt-3 px-5 py-2.5 rounded-xl bg-[#D3FB52] text-[#001820] font-semibold disabled:opacity-50"
          >
            {busy ? 'Adding…' : 'Add to roster'}
          </button>
        </form>
      )}

      {[
        { title: 'Players', list: roster },
        { title: 'Subs', list: subs },
      ].map(
        (group) =>
          group.list.length > 0 && (
            <div key={group.title} className="mt-6">
              <h3 className="text-white/50 text-sm uppercase tracking-wide mb-2">{group.title}</h3>
              <div className="space-y-2">
                {group.list.map((p) => {
                  const e = elig(p.id);
                  const isEditing = editing === p.id;
                  return (
                    <div
                      key={p.id}
                      className="rounded-xl border border-white/[0.08] bg-[#002838] p-4"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="text-white font-medium">
                            {p.name}
                            {p.rating != null && (
                              <span className="text-white/40 font-normal"> · {p.rating}</span>
                            )}
                            {(p.wtn_doubles ?? p.wtn) != null && (
                              <span className="text-[#D3FB52]/70 font-normal">
                                {' '}
                                · WTN {p.wtn_doubles ?? p.wtn}
                              </span>
                            )}
                            {p.return_side && (
                              <span className="text-white/40 font-normal"> · {p.return_side}</span>
                            )}
                          </div>
                          <div className="text-white/35 text-sm truncate">
                            {p.email || 'no email — cannot be polled'}
                            {p.phone ? ` · ${p.phone}` : ''}
                          </div>
                          {prefsFor(p.id).length > 0 && (
                            <div className="text-white/35 text-xs mt-1">
                              Prefers: {prefsFor(p.id).map((x) => nameOf(x.preferred_player_id)).join(', ')}
                            </div>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          {e && !p.is_sub && eligibilityEnabled && (
                            <div
                              className={
                                e.eligible ? 'text-[#D3FB52] text-sm' : 'text-amber-300 text-sm'
                              }
                            >
                              {e.played}/{e.required} played
                              {!e.eligible && ` · needs ${e.short}`}
                            </div>
                          )}
                          <button
                            onClick={() => setEditing(isEditing ? null : p.id)}
                            className="text-white/40 hover:text-white text-sm mt-1"
                          >
                            {isEditing ? 'Close' : 'Edit'}
                          </button>
                        </div>
                      </div>

                      {isEditing && (
                        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div>
                            <label className="block text-xs text-white/50 mb-1">Mobile</label>
                            <input
                              type="tel"
                              defaultValue={p.phone ?? ''}
                              placeholder="925-555-0148"
                              onBlur={(ev) => patch(p.id, { phone: ev.target.value.trim() || null })}
                              className={field}
                            />
                          </div>
                          <div>
                            {/* Lower is stronger here. Labelled so nobody types
                                an NTRP rating into the box that orders courts. */}
                            <label className="block text-xs text-white/50 mb-1">
                              WTN <span className="text-white/25">(lower = stronger)</span>
                            </label>
                            <input
                              defaultValue={p.wtn_doubles ?? p.wtn ?? ''}
                              placeholder="18.4"
                              onBlur={(ev) =>
                                patch(p.id, {
                                  wtn_doubles: ev.target.value ? Number(ev.target.value) : null,
                                })
                              }
                              className={field}
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-white/50 mb-1">Rating</label>
                            <input
                              defaultValue={p.rating ?? ''}
                              onBlur={(ev) =>
                                patch(p.id, {
                                  rating: ev.target.value ? Number(ev.target.value) : null,
                                })
                              }
                              className={field}
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-white/50 mb-1">Return side</label>
                            <select
                              defaultValue={p.return_side ?? ''}
                              onChange={(ev) =>
                                patch(p.id, { return_side: ev.target.value || null })
                              }
                              className={field}
                            >
                              <option value="">—</option>
                              <option value="deuce">Deuce</option>
                              <option value="ad">Ad</option>
                            </select>
                          </div>
                          {needsGender && (
                            <div>
                              <label className="block text-xs text-white/50 mb-1">Gender</label>
                              <select
                                defaultValue={p.gender ?? ''}
                                onChange={(ev) => patch(p.id, { gender: ev.target.value || null })}
                                className={field}
                              >
                                <option value="">—</option>
                                <option value="M">M</option>
                                <option value="F">F</option>
                              </select>
                            </div>
                          )}
                          {eligibilityEnabled && (
                            <div>
                              <label className="block text-xs text-white/50 mb-1">
                                Rating type
                              </label>
                              <select
                                defaultValue={p.rating_type ?? 'computer'}
                                onChange={(ev) => patch(p.id, { rating_type: ev.target.value })}
                                className={field}
                              >
                                <option value="computer">Computer</option>
                                <option value="self">Self-rated</option>
                                <option value="appeal">Appeal</option>
                              </select>
                            </div>
                          )}
                          <div>
                            <label className="block text-xs text-white/50 mb-1">Court limit</label>
                            <select
                              defaultValue={p.court_limit ?? ''}
                              onChange={(ev) =>
                                patch(p.id, { court_limit: ev.target.value || null })
                              }
                              className={field}
                            >
                              <option value="">None</option>
                              <option value="singles_only">Singles only</option>
                              <option value="doubles_only">Doubles only</option>
                              <option value="no_court_1">Never court 1</option>
                            </select>
                            {p.court_note && (
                              <p className="text-xs text-white/50 mt-1 italic">
                                Player said: “{p.court_note}”
                              </p>
                            )}
                          </div>
                          <div>
                            <label className="block text-xs text-white/50 mb-1">Role</label>
                            <select
                              defaultValue={p.is_sub ? 'sub' : 'player'}
                              onChange={(ev) => patch(p.id, { is_sub: ev.target.value === 'sub' })}
                              className={field}
                            >
                              <option value="player">Roster</option>
                              <option value="sub">Sub</option>
                            </select>
                          </div>
                          <div className="col-span-2 sm:col-span-4">
                            <label className="block text-xs text-white/50 mb-1">
                              Private note
                            </label>
                            <input
                              defaultValue={p.notes ?? ''}
                              onBlur={(ev) => patch(p.id, { notes: ev.target.value })}
                              placeholder="Can't do Tuesdays after 8"
                              className={field}
                            />
                          </div>
                          <div className="col-span-2 sm:col-span-4">
                            <button
                              onClick={() => remove(p.id)}
                              className="text-red-300/70 hover:text-red-300 text-sm"
                            >
                              Remove from roster
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ),
      )}
    </section>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LEAGUES, leagueSpec } from '@/lib/captain/leagues';

export default function NewTeamForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [leagueType, setLeagueType] = useState('usta_adult');
  // Level means different things per league: an NTRP number in USTA Adult, a
  // combined cap in Combo/Mixed, a ball-colour division in Junior Team Tennis.
  const spec = leagueSpec(leagueType);
  const [level, setLevel] = useState('');
  const [sourceTeamId, setSourceTeamId] = useState('');
  const [eligibilityEnabled, setEligibilityEnabled] = useState(false);
  const [minDefault, setMinDefault] = useState(2);
  const [minSelfRated, setMinSelfRated] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/captain/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          league_type: leagueType,
          level: level || null,
          source_team_id: sourceTeamId.trim() || null,
          eligibility_enabled: eligibilityEnabled,
          min_matches_default: minDefault,
          min_matches_self_rated: minSelfRated,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error || 'Could not create the team.');
        return;
      }
      setOpen(false);
      setName('');
      setLevel('');
      setSourceTeamId('');
      router.refresh();
      if (j.team?.id) router.push(`/captain/${j.team.id}`);
    } catch {
      setError('Network problem — try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-8 px-5 py-3 rounded-xl bg-[#D3FB52] text-[#001820] font-semibold hover:brightness-95 transition"
      >
        + New team
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="mt-8 rounded-2xl border border-white/[0.08] bg-[#002838] p-5 space-y-4"
    >
      <h2 className="text-white font-semibold text-lg">New team</h2>

      <div>
        <label htmlFor="team-name" className="block text-sm text-white/60 mb-1">
          Team name
        </label>
        <input
          id="team-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="Wednesday Night 3.5"
          className="w-full px-3 py-2.5 rounded-xl bg-[#001820] border border-white/10 text-white placeholder-white/25 focus:border-[#D3FB52]/50 focus:outline-none"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="league-type" className="block text-sm text-white/60 mb-1">
            League
          </label>
          <select
            id="league-type"
            value={leagueType}
            onChange={(e) => setLeagueType(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl bg-[#001820] border border-white/10 text-white focus:border-[#D3FB52]/50 focus:outline-none"
          >
            {LEAGUES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="level" className="block text-sm text-white/60 mb-1">
            {spec.levelLabel}
          </label>
          <input
            id="level"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            placeholder={spec.levelPlaceholder}
            className="w-full px-3 py-2.5 rounded-xl bg-[#001820] border border-white/10 text-white placeholder-white/25 focus:border-[#D3FB52]/50 focus:outline-none"
          />
          {(leagueType === 'usta_combo' || leagueType === 'usta_mixed') && (
            <p className="text-xs text-white/40 mt-1">
              Combined rating cap per court — used to reject illegal pairings.
            </p>
          )}
          {leagueType === 'jtt' && (
            <p className="text-xs text-white/40 mt-1">
              Age group and ball colour, e.g. 10U Green Ball.
            </p>
          )}
        </div>
      </div>

      <div>
        <label htmlFor="source-team-id" className="block text-sm text-white/60 mb-1">
          League Team ID <span className="text-white/30">(optional)</span>
        </label>
        <input
          id="source-team-id"
          value={sourceTeamId}
          onChange={(e) => setSourceTeamId(e.target.value)}
          placeholder={leagueType === 'jtt' ? '5083524580' : ''}
          className="w-full px-3 py-2.5 rounded-xl bg-[#001820] border border-white/10 text-white placeholder-white/25 focus:border-[#D3FB52]/50 focus:outline-none"
        />
        {/* Not cosmetic: without it the contact-list import cannot tell which
            row is YOUR team, so your own club lands in the opponent list and
            the season-opener email goes to you and your co-captains. */}
        <p className="text-xs text-white/40 mt-1">
          {leagueType === 'jtt'
            ? 'The number parents type on TennisLink to register. It also stops your own club being imported as an opponent.'
            : 'Your team’s id on the league site, if it has one.'}
        </p>
      </div>

      {leagueType === 'jtt' && (
        <p className="text-xs text-white/45 -mt-1">
          Matches start at {spec.singlesCourts} singles and {spec.doublesCourts} doubles lines, and
          juniors are ordered by WTN and your own strength order rather than NTRP. Both are
          editable once the team exists.
        </p>
      )}

      <div className="rounded-xl border border-white/10 p-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={eligibilityEnabled}
            onChange={(e) => setEligibilityEnabled(e.target.checked)}
            className="mt-1 w-4 h-4 accent-[#D3FB52]"
          />
          <span>
            <span className="text-white text-sm font-medium">
              This league has playoffs with match minimums
            </span>
            <span className="block text-white/40 text-xs mt-0.5">
              Leave off for leagues with no playoffs — nothing will be tracked or shown.
            </span>
          </span>
        </label>

        {eligibilityEnabled && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="min-default" className="block text-sm text-white/60 mb-1">
                Computer-rated players
              </label>
              <input
                id="min-default"
                type="number"
                min={0}
                max={20}
                value={minDefault}
                onChange={(e) => setMinDefault(Number(e.target.value))}
                className="w-24 px-3 py-2.5 rounded-xl bg-[#001820] border border-white/10 text-white focus:border-[#D3FB52]/50 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="min-self" className="block text-sm text-white/60 mb-1">
                Self-rated &amp; appeal players
              </label>
              <input
                id="min-self"
                type="number"
                min={0}
                max={20}
                value={minSelfRated}
                onChange={(e) => setMinSelfRated(Number(e.target.value))}
                className="w-24 px-3 py-2.5 rounded-xl bg-[#001820] border border-white/10 text-white focus:border-[#D3FB52]/50 focus:outline-none"
              />
            </div>
            <p className="sm:col-span-2 text-white/40 text-xs">
              USTA typically requires 3 matches from self-rated and appeal players in a 3-line
              league, and 4 in a 4- or 5-line league. Check your league&rsquo;s rules — these
              numbers are yours to set.
            </p>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-300">{error}</p>}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={busy}
          className="px-5 py-2.5 rounded-xl bg-[#D3FB52] text-[#001820] font-semibold disabled:opacity-50"
        >
          {busy ? 'Creating…' : 'Create team'}
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
  );
}

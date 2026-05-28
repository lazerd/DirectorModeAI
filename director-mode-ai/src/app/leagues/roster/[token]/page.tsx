'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, AlertCircle, UserPlus, Trash2, Check, Users } from 'lucide-react';

type Club = { id: string; name: string; short_code: string };
type League = { id: string; name: string; slug: string; status: string };
type Division = { id: string; name: string; short_code: string };
type Roster = {
  id: string;
  division_id: string;
  player_name: string;
  player_email: string | null;
  parent_name: string | null;
  parent_email: string | null;
  parent_phone: string | null;
  ntrp: number | null;
  utr: number | null;
  ladder_position: number | null;
};

type FetchResult = {
  club: Club;
  league: League;
  divisions: Division[];
  rosters: Roster[];
};

export default function CoachRosterPage() {
  const params = useParams();
  const token = Array.isArray(params.token) ? params.token[0] : (params.token as string);

  const [data, setData] = useState<FetchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add-player form
  const [adding, setAdding] = useState(false);
  const [divisionId, setDivisionId] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [playerEmail, setPlayerEmail] = useState('');
  const [parentName, setParentName] = useState('');
  const [parentEmail, setParentEmail] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [ntrp, setNtrp] = useState('');
  const [utr, setUtr] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/leagues/roster/${token}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as FetchResult;
      setData(json);
      if (json.divisions.length > 0 && !divisionId) {
        setDivisionId(json.divisions[0].id);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token, divisionId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const addPlayer = async () => {
    if (!playerName.trim()) {
      setSubmitMsg({ type: 'err', text: 'Player name is required.' });
      return;
    }
    if (!divisionId) {
      setSubmitMsg({ type: 'err', text: 'Pick a division.' });
      return;
    }
    setSubmitting(true);
    setSubmitMsg(null);
    try {
      const res = await fetch(`/api/leagues/roster/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          division_id: divisionId,
          player_name: playerName.trim(),
          player_email: playerEmail.trim() || null,
          parent_name: parentName.trim() || null,
          parent_email: parentEmail.trim() || null,
          parent_phone: parentPhone.trim() || null,
          ntrp: ntrp || null,
          utr: utr || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setSubmitMsg({ type: 'ok', text: `${playerName.trim()} added!` });
      setPlayerName('');
      setPlayerEmail('');
      setParentName('');
      setParentEmail('');
      setParentPhone('');
      setNtrp('');
      setUtr('');
      fetchData();
    } catch (e: any) {
      setSubmitMsg({ type: 'err', text: e.message });
    } finally {
      setSubmitting(false);
    }
  };

  const removePlayer = async (playerId: string, name: string) => {
    if (!confirm(`Remove ${name} from the roster?`)) return;
    try {
      const res = await fetch(`/api/leagues/roster/${token}?playerId=${playerId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      fetchData();
    } catch (e: any) {
      alert(`Failed to remove: ${e.message}`);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-orange-500" size={24} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 max-w-lg mx-auto">
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5" />
          <div>
            <p className="font-medium">Couldn&apos;t load this roster link.</p>
            <p className="text-sm">{error || 'Unknown error'}</p>
          </div>
        </div>
      </div>
    );
  }

  const { club, league, divisions, rosters } = data;

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-semibold text-2xl text-gray-900">
          {club.name} Roster
        </h1>
        <p className="text-gray-500 text-sm">{league.name}</p>
      </div>

      {/* Add Player Form */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 mb-6">
        <button
          onClick={() => setAdding(!adding)}
          className="w-full flex items-center justify-between text-left"
        >
          <span className="font-medium text-gray-900 flex items-center gap-2">
            <UserPlus size={18} className="text-orange-500" />
            Add a player
          </span>
          <span className="text-gray-400 text-xl">{adding ? '\u2212' : '+'}</span>
        </button>

        {adding && (
          <div className="mt-4 space-y-3">
            {/* Division */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Division</label>
              <select
                value={divisionId}
                onChange={e => setDivisionId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900"
              >
                {divisions.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>

            {/* Player Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Player name <span className="text-red-400">*</span>
              </label>
              <input
                value={playerName}
                onChange={e => setPlayerName(e.target.value)}
                placeholder="First Last"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>

            {/* Player Email */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Player email <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                value={playerEmail}
                onChange={e => setPlayerEmail(e.target.value)}
                placeholder="player@email.com"
                type="email"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>

            {/* Parent Info */}
            <div className="border-t border-gray-100 pt-3">
              <p className="text-xs font-medium text-gray-500 uppercase mb-2">Parent / Guardian</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <input
                    value={parentName}
                    onChange={e => setParentName(e.target.value)}
                    placeholder="Parent name"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input
                    value={parentPhone}
                    onChange={e => setParentPhone(e.target.value)}
                    placeholder="(555) 555-5555"
                    type="tel"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>
              </div>
              <div className="mt-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  value={parentEmail}
                  onChange={e => setParentEmail(e.target.value)}
                  placeholder="parent@email.com"
                  type="email"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
            </div>

            {/* Ratings */}
            <div className="border-t border-gray-100 pt-3">
              <p className="text-xs font-medium text-gray-500 uppercase mb-2">Ratings (optional)</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">NTRP</label>
                  <input
                    value={ntrp}
                    onChange={e => setNtrp(e.target.value)}
                    placeholder="e.g. 3.5"
                    type="number"
                    step="0.5"
                    min="1.0"
                    max="7.0"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">UTR</label>
                  <input
                    value={utr}
                    onChange={e => setUtr(e.target.value)}
                    placeholder="e.g. 5.50"
                    type="number"
                    step="0.01"
                    min="1"
                    max="16"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>
              </div>
            </div>

            {submitMsg && (
              <div
                className={`rounded-md p-3 text-sm flex items-start gap-2 ${
                  submitMsg.type === 'ok'
                    ? 'bg-green-50 border border-green-200 text-green-700'
                    : 'bg-red-50 border border-red-200 text-red-700'
                }`}
              >
                {submitMsg.type === 'ok' ? <Check size={14} className="mt-0.5" /> : <AlertCircle size={14} className="mt-0.5" />}
                {submitMsg.text}
              </div>
            )}

            <button
              onClick={addPlayer}
              disabled={submitting}
              className="w-full py-3 bg-orange-500 text-white rounded-md font-semibold hover:bg-orange-600 disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              <UserPlus size={16} />
              {submitting ? 'Adding...' : 'Add player'}
            </button>
          </div>
        )}
      </div>

      {/* Current Roster by Division */}
      {divisions.map(div => {
        const divRosters = rosters
          .filter((r: Roster) => r.division_id === div.id)
          .sort((a: Roster, b: Roster) => (a.ladder_position ?? 9999) - (b.ladder_position ?? 9999));

        return (
          <div key={div.id} className="mb-6">
            <h2 className="font-semibold text-lg text-gray-900 flex items-center gap-2 mb-3">
              <Users size={18} className="text-orange-500" />
              {div.name}
              <span className="text-sm text-gray-400 font-normal">({divRosters.length} players)</span>
            </h2>

            {divRosters.length === 0 ? (
              <p className="text-gray-400 text-sm italic">No players yet — add some above!</p>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
                {divRosters.map((r: Roster) => (
                  <div key={r.id} className="px-4 py-3 flex items-center justify-between">
                    <div>
                      <span className="text-gray-400 text-xs font-mono mr-2">
                        #{r.ladder_position || '—'}
                      </span>
                      <span className="font-medium text-gray-900">{r.player_name}</span>
                      {r.ntrp && (
                        <span className="ml-2 text-xs text-gray-500">NTRP {r.ntrp}</span>
                      )}
                      {r.utr && (
                        <span className="ml-2 text-xs text-gray-500">UTR {r.utr}</span>
                      )}
                      {r.parent_name && (
                        <span className="ml-3 text-xs text-gray-400">Parent: {r.parent_name}</span>
                      )}
                    </div>
                    <button
                      onClick={() => removePlayer(r.id, r.player_name)}
                      className="text-gray-300 hover:text-red-500 transition-colors"
                      title="Remove player"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Footer */}
      <div className="text-center text-xs text-gray-400 mt-8">
        Powered by <a href="https://club.coachmode.ai" className="underline">CoachMode</a>
      </div>
    </div>
  );
}

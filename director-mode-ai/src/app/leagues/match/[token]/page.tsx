'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Trophy, Loader2, AlertCircle, CheckCircle, Calendar, Phone, Mail, Flag } from 'lucide-react';
import { format } from 'date-fns';

type MatchData = {
  id: string;
  round: number;
  bracket_position: string;
  deadline: string;
  score: string | null;
  status: string;
  reported_at: string | null;
};

type Opponent = {
  entryId: string;
  captainName: string;
  captainEmail: string | null;
  captainPhone: string | null;
  partnerName: string | null;
} | null;

export default function MatchPage() {
  const params = useParams();
  const token = Array.isArray(params.token) ? params.token[0] : params.token;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [match, setMatch] = useState<MatchData | null>(null);
  const [opponent, setOpponent] = useState<Opponent>(null);
  const [me, setMe] = useState<{ entryId: string; captainName: string; partnerName: string | null } | null>(null);
  const [leagueName, setLeagueName] = useState('');

  const [score, setScore] = useState('');
  const [winnerEntryId, setWinnerEntryId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<string | null>(null);
  const [disputing, setDisputing] = useState(false);

  const fetchMatch = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/leagues/match?token=${token}`);
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed'); setLoading(false); return; }
      setMatch(data.match);
      setOpponent(data.opponent);
      setMe(data.me);
      setLeagueName(data.league?.name || '');
    } catch (err: any) {
      setError(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchMatch(); }, [token]);

  const reportScore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!match || !score || !winnerEntryId) return;
    setSubmitting(true);
    setSubmitResult(null);
    try {
      const res = await fetch('/api/leagues/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          matchId: match.id,
          score,
          winnerEntryId,
          action: 'report',
        }),
      });
      const data = await res.json();
      if (!res.ok) { setSubmitResult(`Error: ${data.error || 'Failed'}`); return; }
      setSubmitResult('Score reported. Both players will get a confirmation email with a 24-hour dispute window.');
      fetchMatch();
    } catch (err: any) {
      setSubmitResult(`Error: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const disputeScore = async () => {
    if (!match) return;
    if (!confirm('Dispute this score? The league director will be notified and the match will be paused until they resolve it.')) return;
    setDisputing(true);
    try {
      const res = await fetch('/api/leagues/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, matchId: match.id, action: 'dispute' }),
      });
      const data = await res.json();
      if (!res.ok) { alert(`Failed: ${data.error}`); return; }
      fetchMatch();
    } finally {
      setDisputing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#001820] text-white flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2.5 mb-6">
          <div className="w-10 h-10 rounded-xl bg-[#D3FB52] flex items-center justify-center">
            <Trophy size={22} className="text-[#002838]" />
          </div>
          <span className="font-display text-2xl">CoachMode Leagues</span>
        </div>

        {loading && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-8 text-center">
            <Loader2 size={24} className="animate-spin mx-auto text-[#D3FB52] mb-3" />
            <div className="text-white/70 text-sm">Loading your match…</div>
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 flex items-start gap-3">
            <AlertCircle size={20} className="text-red-400 mt-0.5 flex-shrink-0" />
            <div>
              <div className="font-medium text-red-300 mb-1">Couldn&apos;t load match</div>
              <div className="text-sm text-red-200/80">{error}</div>
            </div>
          </div>
        )}

        {!loading && !error && !match && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-6 text-center">
            <CheckCircle size={32} className="text-[#D3FB52] mx-auto mb-3" />
            <h1 className="font-semibold text-lg mb-2">No open match</h1>
            <p className="text-white/60 text-sm">
              You don&apos;t have an active match right now. Either all your matches are confirmed, the league
              hasn&apos;t started, or you&apos;re out of the bracket. You&apos;ll get a new email when your next
              round is ready.
            </p>
          </div>
        )}

        {!loading && !error && match && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-6">
            <div className="mb-5">
              <div className="text-xs uppercase tracking-wide text-white/40 mb-1">{leagueName}</div>
              <h1 className="font-display text-xl">Round {match.round}</h1>
              <div className="text-sm text-white/50 mt-1 flex items-center gap-1.5">
                <Calendar size={12} />
                Deadline {format(new Date(match.deadline), 'MM/dd/yyyy')}
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-lg p-4 mb-4">
              <div className="text-xs uppercase text-white/40 mb-2">Your match</div>
              <div className="text-sm">
                <div className="font-medium">
                  {me?.captainName}{me?.partnerName && <> &amp; {me.partnerName}</>}
                </div>
                <div className="text-white/40 text-xs my-1">vs</div>
                <div className="font-medium">
                  {opponent?.captainName}{opponent?.partnerName && <> &amp; {opponent.partnerName}</>}
                </div>
              </div>
            </div>

            {opponent && (
              <div className="bg-white/5 border border-white/10 rounded-lg p-4 mb-4">
                <div className="text-xs uppercase text-white/40 mb-2">Opponent contact</div>
                {opponent.captainEmail && (
                  <a href={`mailto:${opponent.captainEmail}`} className="flex items-center gap-2 text-sm text-[#D3FB52] hover:underline mb-1">
                    <Mail size={14} /> {opponent.captainEmail}
                  </a>
                )}
                {opponent.captainPhone && (
                  <a href={`tel:${opponent.captainPhone}`} className="flex items-center gap-2 text-sm text-[#D3FB52] hover:underline">
                    <Phone size={14} /> {opponent.captainPhone}
                  </a>
                )}
              </div>
            )}

            {/* Reported-but-not-confirmed state */}
            {match.status === 'reported' && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-4">
                <div className="text-xs uppercase text-yellow-300 mb-1">Reported score</div>
                <div className="text-2xl font-bold text-yellow-100 mb-2">{match.score}</div>
                <div className="text-xs text-yellow-200/70 mb-3">
                  Awaiting dispute window (24 hours). If this is wrong, dispute now.
                </div>
                <button
                  onClick={disputeScore}
                  disabled={disputing}
                  className="w-full py-2 bg-red-500/20 border border-red-500/40 text-red-200 rounded-lg text-sm font-medium hover:bg-red-500/30"
                >
                  <Flag size={14} className="inline mr-1" />
                  {disputing ? 'Submitting dispute…' : 'Dispute this score'}
                </button>
              </div>
            )}

            {match.status === 'pending' && (
              <form onSubmit={reportScore} className="space-y-3">
                <div>
                  <label className="block text-xs uppercase tracking-wide text-white/50 mb-1">Score *</label>
                  <input
                    required
                    value={score}
                    onChange={e => setScore(e.target.value)}
                    placeholder="6-3, 4-6, 7-5"
                    className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#D3FB52]"
                  />
                  <p className="text-xs text-white/40 mt-1">Standard format: sets separated by commas.</p>
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-wide text-white/50 mb-1">Winner *</label>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 p-3 bg-white/5 border border-white/10 rounded-lg cursor-pointer hover:bg-white/10">
                      <input
                        type="radio"
                        name="winner"
                        checked={winnerEntryId === me?.entryId}
                        onChange={() => me && setWinnerEntryId(me.entryId)}
                        className="w-4 h-4"
                      />
                      <span className="text-sm">
                        {me?.captainName}{me?.partnerName && ` & ${me.partnerName}`} (my team)
                      </span>
                    </label>
                    {opponent && (
                      <label className="flex items-center gap-2 p-3 bg-white/5 border border-white/10 rounded-lg cursor-pointer hover:bg-white/10">
                        <input
                          type="radio"
                          name="winner"
                          checked={winnerEntryId === opponent.entryId}
                          onChange={() => setWinnerEntryId(opponent.entryId)}
                          className="w-4 h-4"
                        />
                        <span className="text-sm">
                          {opponent.captainName}{opponent.partnerName && ` & ${opponent.partnerName}`} (opponent)
                        </span>
                      </label>
                    )}
                  </div>
                </div>

                {submitResult && (
                  <div className={`text-sm p-3 rounded-lg border ${submitResult.startsWith('Error') ? 'bg-red-500/10 border-red-500/30 text-red-200' : 'bg-green-500/10 border-green-500/30 text-green-200'}`}>
                    {submitResult}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting || !score || !winnerEntryId}
                  className="w-full py-3 bg-[#D3FB52] text-[#002838] font-semibold rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {submitting && <Loader2 size={16} className="animate-spin" />}
                  {submitting ? 'Reporting…' : 'Report score'}
                </button>
              </form>
            )}

            {match.status === 'disputed' && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-center">
                <Flag size={20} className="text-red-400 mx-auto mb-2" />
                <div className="font-medium text-red-200 mb-1">Score disputed</div>
                <div className="text-xs text-red-200/70">
                  The league director has been notified. This match is paused until they resolve it.
                </div>
              </div>
            )}

            {match.status === 'confirmed' && (
              <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 text-center">
                <CheckCircle size={20} className="text-green-400 mx-auto mb-2" />
                <div className="font-medium text-green-200 mb-1">Final score: {match.score}</div>
                <div className="text-xs text-green-200/70">
                  This match is locked. Wait for the next round email.
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

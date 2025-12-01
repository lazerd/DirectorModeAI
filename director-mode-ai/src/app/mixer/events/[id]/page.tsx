'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { ArrowLeft, Share2, Users, Trophy, BarChart3, Plus, Trash2, RefreshCw } from 'lucide-react';
import { generateMatches } from '@/lib/mixer/matchGeneration';
import EventCodeQR from '@/components/mixer/EventCodeQR';

interface Event {
  id: string;
  name: string;
  event_date: string;
  start_time: string;
  event_code: string;
  num_courts: number;
  match_format: string;
  scoring_format: string;
  round_length_minutes: number;
  target_games: number;
}

interface Player {
  id: string;
  name: string;
  gender?: string | null;
}

interface EventPlayer {
  player_id: string;
  strength_order: number;
  wins: number;
  losses: number;
  games_won: number;
  games_lost: number;
  player: Player;
}

interface Round {
  id: string;
  round_number: number;
  status: string;
}

interface Match {
  id: string;
  court_number: number;
  player1_id: string | null;
  player2_id: string | null;
  player3_id: string | null;
  player4_id: string | null;
  team1_score: number;
  team2_score: number;
  winner_team: number | null;
  player1?: Player;
  player2?: Player;
  player3?: Player;
  player4?: Player;
}

export default function EventDashboardPage() {
  const params = useParams();
  const router = useRouter();
  const eventId = params.id as string;

  const [event, setEvent] = useState<Event | null>(null);
  const [eventPlayers, setEventPlayers] = useState<EventPlayer[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [activeTab, setActiveTab] = useState('share');
  const [loading, setLoading] = useState(true);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [newPlayerGender, setNewPlayerGender] = useState('male');
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);

  useEffect(() => {
    fetchEventData();
  }, [eventId]);

  useEffect(() => {
    if (selectedRoundId) {
      fetchMatches(selectedRoundId);
    }
  }, [selectedRoundId]);

  const fetchEventData = async () => {
    const supabase = createClient();

    const { data: eventData } = await supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .single();

    if (eventData) {
      setEvent(eventData);
    }

    const { data: playersData } = await supabase
      .from('event_players')
      .select(`
        player_id,
        strength_order,
        wins,
        losses,
        games_won,
        games_lost,
        player:players(id, name, gender)
      `)
      .eq('event_id', eventId)
      .order('strength_order');

    if (playersData) {
      setEventPlayers(playersData as any);
    }

    const { data: roundsData } = await supabase
      .from('rounds')
      .select('*')
      .eq('event_id', eventId)
      .order('round_number');

    if (roundsData) {
      setRounds(roundsData);
      if (roundsData.length > 0) {
        setSelectedRoundId(roundsData[roundsData.length - 1].id);
      }
    }

    setLoading(false);
  };

  const fetchMatches = async (roundId: string) => {
    const supabase = createClient();

    const { data: matchesData } = await supabase
      .from('matches')
      .select(`
        *,
        player1:players!matches_player1_id_fkey(id, name, gender),
        player2:players!matches_player2_id_fkey(id, name, gender),
        player3:players!matches_player3_id_fkey(id, name, gender),
        player4:players!matches_player4_id_fkey(id, name, gender)
      `)
      .eq('round_id', roundId)
      .order('court_number');

    if (matchesData) {
      setMatches(matchesData as any);
    }
  };

  const handleAddPlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlayerName.trim()) return;

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return;

    const { data: player, error: playerError } = await supabase
      .from('players')
      .insert({
        user_id: user.id,
        name: newPlayerName.trim(),
        gender: newPlayerGender,
      })
      .select()
      .single();

    if (playerError || !player) return;

    await supabase
      .from('event_players')
      .insert({
        event_id: eventId,
        player_id: player.id,
        strength_order: eventPlayers.length,
      });

    setNewPlayerName('');
    fetchEventData();
  };

  const handleRemovePlayer = async (playerId: string) => {
    const supabase = createClient();

    await supabase
      .from('event_players')
      .delete()
      .eq('event_id', eventId)
      .eq('player_id', playerId);

    fetchEventData();
  };

  const generateRound = async () => {
    if (!event || eventPlayers.length < 4) return;

    const supabase = createClient();
    const nextRoundNumber = rounds.length + 1;

    const { data: round, error: roundError } = await supabase
      .from('rounds')
      .insert({
        event_id: eventId,
        round_number: nextRoundNumber,
        status: 'upcoming'
      })
      .select()
      .single();

    if (roundError || !round) {
      console.error('Error creating round:', roundError);
      return;
    }

    const matches = generateMatches(
      event.match_format,
      eventPlayers as any,
      event.num_courts,
      [],
      nextRoundNumber
    );

    for (const match of matches) {
      await supabase.from('matches').insert({
        round_id: round.id,
        court_number: match.court_number,
        player1_id: match.player1_id,
        player2_id: match.player2_id,
        player3_id: match.player3_id,
        player4_id: match.player4_id,
      });
    }

    fetchEventData();
  };

  const handleScoreUpdate = async (matchId: string, team1Score: number, team2Score: number) => {
    const supabase = createClient();

    const winnerTeam = team1Score > team2Score ? 1 : team1Score < team2Score ? 2 : null;

    await supabase
      .from('matches')
      .update({
        team1_score: team1Score,
        team2_score: team2Score,
        winner_team: winnerTeam,
      })
      .eq('id', matchId);

    if (selectedRoundId) {
      fetchMatches(selectedRoundId);
    }
  };

  const getStandings = () => {
    return [...eventPlayers].sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      const aDiff = a.games_won - a.games_lost;
      const bDiff = b.games_won - b.games_lost;
      return bDiff - aDiff;
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500"></div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Event not found</p>
      </div>
    );
  }

  const formatDate = (dateStr: string, timeStr: string) => {
    const date = new Date(dateStr);
    return `${date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} at ${timeStr}`;
  };

  // Separate active matches from BYE matches
  const activeMatches = matches.filter(m => m.player2 || m.player3 || m.player4);
  const byeMatches = matches.filter(m => !m.player2 && !m.player3 && !m.player4);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/mixer/home" className="p-2 hover:bg-gray-100 rounded-lg">
                <ArrowLeft size={20} />
              </Link>
              <div>
                <h1 className="font-bold text-lg">{event.name}</h1>
                <p className="text-sm text-gray-500">{formatDate(event.event_date, event.start_time)}</p>
              </div>
            </div>
            <button onClick={fetchEventData} className="p-2 hover:bg-gray-100 rounded-lg">
              <RefreshCw size={20} />
            </button>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="bg-white border-b">
        <div className="max-w-5xl mx-auto px-4">
          <div className="flex gap-1">
            {[
              { id: 'share', label: 'Share', icon: Share2 },
              { id: 'players', label: 'Players', icon: Users },
              { id: 'rounds', label: 'Rounds', icon: Trophy },
              { id: 'standings', label: 'Standings', icon: BarChart3 },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-orange-500 text-orange-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <tab.icon size={18} />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* Share Tab */}
        {activeTab === 'share' && (
          <EventCodeQR eventCode={event.event_code} eventName={event.name} />
        )}

        {/* Players Tab */}
        {activeTab === 'players' && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl border p-6">
              <h2 className="font-bold text-lg mb-4">Add Player</h2>
              <form onSubmit={handleAddPlayer} className="flex gap-3">
                <input
                  type="text"
                  value={newPlayerName}
                  onChange={(e) => setNewPlayerName(e.target.value)}
                  placeholder="Player name"
                  className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
                <select
                  value={newPlayerGender}
                  onChange={(e) => setNewPlayerGender(e.target.value)}
                  className="px-4 py-2 border rounded-lg"
                >
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
                <button
                  type="submit"
                  className="px-6 py-2 bg-orange-500 text-white rounded-lg font-medium hover:bg-orange-600"
                >
                  <Plus size={20} />
                </button>
              </form>
            </div>

            <div className="bg-white rounded-xl border p-6">
              <h2 className="font-bold text-lg mb-4">Players ({eventPlayers.length})</h2>
              {eventPlayers.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No players added yet</p>
              ) : (
                <div className="space-y-2">
                  {eventPlayers.map((ep, index) => (
                    <div
                      key={ep.player_id}
                      className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-8 h-8 bg-orange-500 text-white rounded-full flex items-center justify-center font-bold">
                          {index + 1}
                        </span>
                        <div>
                          <p className="font-medium">{ep.player.name}</p>
                          <p className="text-sm text-gray-500">
                            {ep.wins}W - {ep.losses}L | Games: {ep.games_won}-{ep.games_lost}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemovePlayer(ep.player_id)}
                        className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {eventPlayers.length >= 4 && (
                <button
                  onClick={generateRound}
                  className="mt-6 w-full py-3 bg-orange-500 text-white rounded-lg font-bold hover:bg-orange-600"
                >
                  + Generate Round {rounds.length + 1}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Rounds Tab */}
        {activeTab === 'rounds' && (
          <div className="space-y-6">
            {rounds.length === 0 ? (
              <div className="bg-white rounded-xl border p-8 text-center">
                <p className="text-gray-500 mb-4">No rounds created yet</p>
                <p className="text-sm text-gray-400">Add at least 4 players, then generate a round</p>
              </div>
            ) : (
              <>
                {/* Round Selector */}
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {rounds.map(round => (
                    <button
                      key={round.id}
                      onClick={() => setSelectedRoundId(round.id)}
                      className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap ${
                        selectedRoundId === round.id
                          ? 'bg-orange-500 text-white'
                          : 'bg-white border hover:bg-gray-50'
                      }`}
                    >
                      Round {round.round_number}
                      <span className={`ml-2 text-xs px-2 py-0.5 rounded ${
                        round.status === 'completed' ? 'bg-green-100 text-green-700' :
                        round.status === 'in_progress' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {round.status}
                      </span>
                    </button>
                  ))}
                </div>

                {/* Matches */}
                <div className="grid gap-4 md:grid-cols-2">
                  {activeMatches.map(match => (
                    <div key={match.id} className="bg-white rounded-xl border p-4">
                      <div className="flex justify-between items-center mb-3">
                        <span className="font-bold text-orange-500">Court {match.court_number}</span>
                        {match.winner_team && (
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">Complete</span>
                        )}
                      </div>

                      <div className="space-y-3">
                        {/* Team 1 */}
                        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                          <div>
                            <p className="font-medium">{match.player1?.name || 'TBD'}</p>
                            {match.player3 && <p className="font-medium">{match.player3.name}</p>}
                          </div>
                          <input
                            type="number"
                            value={match.team1_score}
                            onChange={(e) => handleScoreUpdate(match.id, parseInt(e.target.value) || 0, match.team2_score)}
                            className="w-16 text-center text-2xl font-bold border rounded-lg"
                            min={0}
                          />
                        </div>

                        {/* Team 2 */}
                        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                          <div>
                            <p className="font-medium">{match.player2?.name || 'TBD'}</p>
                            {match.player4 && <p className="font-medium">{match.player4.name}</p>}
                          </div>
                          <input
                            type="number"
                            value={match.team2_score}
                            onChange={(e) => handleScoreUpdate(match.id, match.team1_score, parseInt(e.target.value) || 0)}
                            className="w-16 text-center text-2xl font-bold border rounded-lg"
                            min={0}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* BYE Players */}
                {byeMatches.length > 0 && (
                  <div className="bg-white rounded-xl border p-4">
                    <h3 className="font-bold mb-3">On BYE</h3>
                    <div className="grid gap-2 md:grid-cols-3">
                      {byeMatches.map(match => (
                        <div key={match.id} className="p-3 bg-gray-100 rounded-lg text-center">
                          <p className="font-medium">{match.player1?.name || 'TBD'}</p>
                          <p className="text-sm text-gray-500">Sitting out this round</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Generate Next Round */}
                <button
                  onClick={generateRound}
                  className="w-full py-3 bg-orange-500 text-white rounded-lg font-bold hover:bg-orange-600"
                >
                  + Generate Round {rounds.length + 1}
                </button>
              </>
            )}
          </div>
        )}

        {/* Standings Tab */}
        {activeTab === 'standings' && (
          <div className="bg-white rounded-xl border overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Rank</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Player</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-500">W</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-500">L</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-500">Games</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-500">Win %</th>
                </tr>
              </thead>
              <tbody>
                {getStandings().map((ep, index) => {
                  const totalGames = ep.wins + ep.losses;
                  const winPct = totalGames > 0 ? Math.round((ep.wins / totalGames) * 100) : 0;
                  const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '';

                  return (
                    <tr key={ep.player_id} className="border-t">
                      <td className="px-4 py-3 font-bold">
                        {medal || index + 1}
                      </td>
                      <td className="px-4 py-3 font-medium">{ep.player.name}</td>
                      <td className="px-4 py-3 text-center text-green-600 font-medium">{ep.wins}</td>
                      <td className="px-4 py-3 text-center text-red-600 font-medium">{ep.losses}</td>
                      <td className="px-4 py-3 text-center">{ep.games_won}-{ep.games_lost}</td>
                      <td className="px-4 py-3 text-center font-medium">{winPct}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

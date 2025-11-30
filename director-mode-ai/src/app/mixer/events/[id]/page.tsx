'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { 
  ArrowLeft, Share2, Users, Trophy, BarChart3, 
  Plus, Play, Trash2, UserPlus,
  Copy, QrCode, RefreshCw
} from 'lucide-react';
import { format } from 'date-fns';
import { generateMatches } from '@/lib/mixer/matchGeneration';

interface Event {
  id: string;
  name: string;
  event_date: string;
  start_time: string;
  num_courts: number;
  scoring_format: string;
  match_format: string;
  event_code: string;
  round_length_minutes: number;
  target_games: number;
}

interface Player {
  id: string;
  name: string;
  gender?: string | null;
}

interface EventPlayer {
  id: string;
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
  matches: Match[];
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
}

export default function EventDashboardPage() {
  const params = useParams();
  const router = useRouter();
  const eventId = params.id as string;
  
  const [event, setEvent] = useState<Event | null>(null);
  const [eventPlayers, setEventPlayers] = useState<EventPlayer[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'share' | 'players' | 'rounds' | 'standings'>('players');
  const [newPlayerName, setNewPlayerName] = useState('');
  const [newPlayerGender, setNewPlayerGender] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (eventId) {
      fetchEventData();
    }
  }, [eventId]);

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
      .select('*, player:players(*)')
      .eq('event_id', eventId)
      .order('strength_order');
    
    if (playersData) {
      setEventPlayers(playersData);
    }

    const { data: roundsData } = await supabase
      .from('rounds')
      .select('*, matches(*)')
      .eq('event_id', eventId)
      .order('round_number');
    
    if (roundsData) {
      setRounds(roundsData);
    }

    setLoading(false);
  };

  const addPlayer = async () => {
    if (!newPlayerName.trim()) return;
    
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: player, error: playerError } = await supabase
      .from('players')
      .insert({
        user_id: user.id,
        name: newPlayerName.trim(),
        gender: newPlayerGender || null,
      })
      .select()
      .single();

    if (playerError || !player) {
      console.error('Error creating player:', playerError);
      return;
    }

    const { error: eventPlayerError } = await supabase
      .from('event_players')
      .insert({
        event_id: eventId,
        player_id: player.id,
        strength_order: eventPlayers.length,
      });

    if (eventPlayerError) {
      console.error('Error adding player to event:', eventPlayerError);
      return;
    }

    setNewPlayerName('');
    setNewPlayerGender('');
    fetchEventData();
  };

  const removePlayer = async (eventPlayerId: string) => {
    const supabase = createClient();
    await supabase.from('event_players').delete().eq('id', eventPlayerId);
    fetchEventData();
  };

  const generateRound = async () => {
    if (!event || eventPlayers.length < 2) return;
    
    const supabase = createClient();
    const nextRoundNumber = rounds.length + 1;

    const { data: round, error: roundError } = await supabase
      .from('rounds')
      .insert({
        event_id: eventId,
        round_number: nextRoundNumber,
        status: 'upcoming',
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

  const updateMatchScore = async (matchId: string, team1Score: number, team2Score: number) => {
    const supabase = createClient();
    const winnerTeam = team1Score > team2Score ? 1 : team2Score > team1Score ? 2 : null;
    
    await supabase
      .from('matches')
      .update({
        team1_score: team1Score,
        team2_score: team2Score,
        winner_team: winnerTeam,
      })
      .eq('id', matchId);

    fetchEventData();
  };

  const copyEventCode = () => {
    if (event) {
      navigator.clipboard.writeText(event.event_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const getPlayerName = (playerId: string | null) => {
    if (!playerId) return 'TBD';
    const ep = eventPlayers.find(p => p.player_id === playerId);
    return ep?.player?.name || 'Unknown';
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-orange-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-bold mb-2">Event not found</h2>
          <Link href="/mixer/home" className="text-orange-500 hover:underline">Back to events</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/mixer/home" className="p-2 hover:bg-gray-100 rounded-lg">
                <ArrowLeft size={20} />
              </Link>
              <div>
                <h1 className="font-bold text-lg">{event.name}</h1>
                <p className="text-sm text-gray-500">
                  {format(new Date(event.event_date), 'EEEE, MMMM d, yyyy')}
                  {event.start_time && ` at ${event.start_time}`}
                </p>
              </div>
            </div>
            <button onClick={fetchEventData} className="p-2 hover:bg-gray-100 rounded-lg">
              <RefreshCw size={20} />
            </button>
          </div>
        </div>
      </header>

      <div className="bg-white border-b">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex gap-1">
            {[
              { id: 'share', label: 'Share', icon: Share2 },
              { id: 'players', label: 'Players', icon: Users },
              { id: 'rounds', label: 'Rounds', icon: Trophy },
              { id: 'standings', label: 'Standings', icon: BarChart3 },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-4 py-3 border-b-2 font-medium transition-colors ${
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

      <main className="max-w-6xl mx-auto px-4 py-6">
        {activeTab === 'share' && (
          <div className="bg-white rounded-xl border p-6 max-w-md mx-auto text-center">
            <QrCode size={48} className="mx-auto text-gray-400 mb-4" />
            <h2 className="text-xl font-bold mb-2">Event Code</h2>
            <p className="text-gray-500 mb-4">Share this code with players to join</p>
            <div className="text-4xl font-mono font-bold text-orange-600 mb-4 tracking-widest">
              {event.event_code}
            </div>
            <button
              onClick={copyEventCode}
              className="flex items-center justify-center gap-2 w-full py-3 bg-orange-500 text-white rounded-xl font-medium hover:bg-orange-600"
            >
              <Copy size={18} />
              {copied ? 'Copied!' : 'Copy Code'}
            </button>
          </div>
        )}

        {activeTab === 'players' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border p-4">
              <div className="flex gap-3">
                <input
                  type="text"
                  value={newPlayerName}
                  onChange={(e) => setNewPlayerName(e.target.value)}
                  placeholder="Player name"
                  className="flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
                  onKeyPress={(e) => e.key === 'Enter' && addPlayer()}
                />
                <select
                  value={newPlayerGender}
                  onChange={(e) => setNewPlayerGender(e.target.value)}
                  className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
                >
                  <option value="">Gender</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
                <button
                  onClick={addPlayer}
                  disabled={!newPlayerName.trim()}
                  className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50"
                >
                  <UserPlus size={20} />
                </button>
              </div>
            </div>

            <div className="bg-white rounded-xl border divide-y">
              {eventPlayers.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <Users size={32} className="mx-auto mb-2 text-gray-300" />
                  No players added yet
                </div>
              ) : (
                eventPlayers.map((ep, index) => (
                  <div key={ep.id} className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center text-orange-600 font-bold">
                        {index + 1}
                      </span>
                      <div>
                        <p className="font-medium">{ep.player.name}</p>
                        <p className="text-sm text-gray-500">
                          {ep.wins}W - {ep.losses}L
                          {ep.player.gender && ` • ${ep.player.gender}`}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => removePlayer(ep.id)}
                      className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))
              )}
            </div>

            {eventPlayers.length >= 2 && (
              <button
                onClick={generateRound}
                className="w-full py-3 bg-orange-500 text-white rounded-xl font-semibold hover:bg-orange-600 flex items-center justify-center gap-2"
              >
                <Play size={20} />
                Generate Round {rounds.length + 1}
              </button>
            )}
          </div>
        )}

        {activeTab === 'rounds' && (
          <div className="space-y-4">
            {rounds.length === 0 ? (
              <div className="bg-white rounded-xl border p-8 text-center text-gray-500">
                <Trophy size={32} className="mx-auto mb-2 text-gray-300" />
                No rounds yet. Add players and generate a round!
              </div>
            ) : (
              rounds.map((round) => (
                <div key={round.id} className="bg-white rounded-xl border overflow-hidden">
                  <div className="p-4 bg-gray-50 border-b flex items-center justify-between">
                    <h3 className="font-bold">Round {round.round_number}</h3>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      round.status === 'completed' ? 'bg-green-100 text-green-700' :
                      round.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {round.status.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="divide-y">
                    {round.matches.map((match) => (
                      <div key={match.id} className="p-4">
                        <div className="text-sm text-gray-500 mb-2">Court {match.court_number}</div>
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <p className="font-medium">
                              {getPlayerName(match.player1_id)}
                              {match.player2_id && ` & ${getPlayerName(match.player2_id)}`}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              value={match.team1_score || 0}
                              onChange={(e) => updateMatchScore(match.id, parseInt(e.target.value) || 0, match.team2_score)}
                              className="w-12 h-10 text-center border rounded-lg"
                              min={0}
                            />
                            <span className="text-gray-400">-</span>
                            <input
                              type="number"
                              value={match.team2_score || 0}
                              onChange={(e) => updateMatchScore(match.id, match.team1_score, parseInt(e.target.value) || 0)}
                              className="w-12 h-10 text-center border rounded-lg"
                              min={0}
                            />
                          </div>
                          <div className="flex-1 text-right">
                            <p className="font-medium">
                              {getPlayerName(match.player3_id)}
                              {match.player4_id && ` & ${getPlayerName(match.player4_id)}`}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}

            {eventPlayers.length >= 2 && (
              <button
                onClick={generateRound}
                className="w-full py-3 bg-orange-500 text-white rounded-xl font-semibold hover:bg-orange-600 flex items-center justify-center gap-2"
              >
                <Plus size={20} />
                Generate Round {rounds.length + 1}
              </button>
            )}
          </div>
        )}

        {activeTab === 'standings' && (
          <div className="bg-white rounded-xl border overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold">#</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold">Player</th>
                  <th className="px-4 py-3 text-center text-sm font-semibold">W</th>
                  <th className="px-4 py-3 text-center text-sm font-semibold">L</th>
                  <th className="px-4 py-3 text-center text-sm font-semibold">Games</th>
                  <th className="px-4 py-3 text-center text-sm font-semibold">Win %</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {[...eventPlayers]
                  .sort((a, b) => {
                    if (b.wins !== a.wins) return b.wins - a.wins;
                    return (b.games_won - b.games_lost) - (a.games_won - a.games_lost);
                  })
                  .map((ep, index) => {
                    const total = ep.wins + ep.losses;
                    const winPct = total > 0 ? Math.round((ep.wins / total) * 100) : 0;
                    return (
                      <tr key={ep.id} className={index < 3 ? 'bg-orange-50' : ''}>
                        <td className="px-4 py-3">
                          {index === 0 && '🥇'}
                          {index === 1 && '🥈'}
                          {index === 2 && '🥉'}
                          {index > 2 && index + 1}
                        </td>
                        <td className="px-4 py-3 font-medium">{ep.player.name}</td>
                        <td className="px-4 py-3 text-center text-green-600 font-medium">{ep.wins}</td>
                        <td className="px-4 py-3 text-center text-red-600">{ep.losses}</td>
                        <td className="px-4 py-3 text-center text-gray-600">
                          {ep.games_won}-{ep.games_lost}
                        </td>
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


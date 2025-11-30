'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Users, Plus, Play, Trophy, QrCode, Share2, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type Event = {
  id: string;
  name: string;
  event_code: string;
  event_date: string;
  start_time: string | null;
  num_courts: number;
};

type Player = {
  id: string;
  name: string;
  skill_level: number;
  checked_in: boolean;
  wins: number;
  losses: number;
};

export default function EventDashboardPage() {
  const params = useParams();
  const eventId = params.id as string;

  const [event, setEvent] = useState<Event | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [newPlayer, setNewPlayer] = useState({ name: '', email: '', skill_level: 3 });

  useEffect(() => {
    fetchEvent();
    fetchPlayers();
  }, [eventId]);

  const fetchEvent = async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from('mixer_events')
      .select('*')
      .eq('id', eventId)
      .single();
    if (data) setEvent(data);
    setLoading(false);
  };

  const fetchPlayers = async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from('mixer_players')
      .select('*')
      .eq('event_id', eventId)
      .order('name');
    if (data) setPlayers(data);
  };

  const addPlayer = async () => {
    if (!newPlayer.name) return;
    const supabase = createClient();
    await supabase.from('mixer_players').insert({
      event_id: eventId,
      name: newPlayer.name,
      email: newPlayer.email || null,
      skill_level: newPlayer.skill_level,
    });
    setNewPlayer({ name: '', email: '', skill_level: 3 });
    setShowAddPlayer(false);
    fetchPlayers();
  };

  const toggleCheckIn = async (playerId: string, currentStatus: boolean) => {
    const supabase = createClient();
    await supabase
      .from('mixer_players')
      .update({ checked_in: !currentStatus, checked_in_at: !currentStatus ? new Date().toISOString() : null })
      .eq('id', playerId);
    fetchPlayers();
  };

  const deletePlayer = async (playerId: string) => {
    const supabase = createClient();
    await supabase.from('mixer_players').delete().eq('id', playerId);
    fetchPlayers();
  };

  const checkedInCount = players.filter(p => p.checked_in).length;

  if (loading) {
    return <div className="p-6 flex justify-center"><div className="animate-spin h-8 w-8 border-4 border-orange-500 border-t-transparent rounded-full" /></div>;
  }

  if (!event) {
    return <div className="p-6 text-center"><p>Event not found</p><Link href="/mixer/home" className="text-orange-500">Back to events</Link></div>;
  }

  return (
    <div className="p-6 lg:p-8">
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link href="/mixer/home" className="p-2 hover:bg-gray-100 rounded-lg"><ArrowLeft size={20} /></Link>
          <div>
            <h1 className="font-semibold text-2xl">{event.name}</h1>
            <p className="text-gray-500 text-sm">{new Date(event.event_date).toLocaleDateString()} • {event.num_courts} courts</p>
          </div>
        </div>
        <div className="bg-orange-100 text-orange-600 px-3 py-1.5 rounded-lg font-mono font-bold">{event.event_code}</div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center"><Users size={20} className="text-blue-600" /></div>
          <div><p className="text-sm text-gray-500">Players</p><p className="text-xl font-semibold">{players.length}</p></div>
        </div>
        <div className="bg-white rounded-xl border p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center"><Trophy size={20} className="text-green-600" /></div>
          <div><p className="text-sm text-gray-500">Checked In</p><p className="text-xl font-semibold">{checkedInCount}</p></div>
        </div>
        <div className="bg-white rounded-xl border p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center"><Play size={20} className="text-orange-600" /></div>
          <div><p className="text-sm text-gray-500">Rounds</p><p className="text-xl font-semibold">0</p></div>
        </div>
      </div>

      <div className="bg-white rounded-xl border">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="font-semibold text-lg">Players</h2>
          <button onClick={() => setShowAddPlayer(true)} className="flex items-center gap-2 px-3 py-1.5 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600">
            <Plus size={16} />Add Player
          </button>
        </div>

        {showAddPlayer && (
          <div className="p-4 border-b bg-gray-50">
            <div className="flex gap-3">
              <input type="text" value={newPlayer.name} onChange={(e) => setNewPlayer({ ...newPlayer, name: e.target.value })} className="flex-1 px-3 py-2 border rounded-lg" placeholder="Player name" />
              <select value={newPlayer.skill_level} onChange={(e) => setNewPlayer({ ...newPlayer, skill_level: parseInt(e.target.value) })} className="px-3 py-2 border rounded-lg">
                <option value={1}>1-Beginner</option><option value={2}>2-Int</option><option value={3}>3-Adv</option><option value={4}>4-Expert</option><option value={5}>5-Pro</option>
              </select>
              <button onClick={addPlayer} className="px-4 py-2 bg-orange-500 text-white rounded-lg">Add</button>
              <button onClick={() => setShowAddPlayer(false)} className="px-4 py-2 border rounded-lg">Cancel</button>
            </div>
          </div>
        )}

        {players.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No players yet. Add players to get started.</div>
        ) : (
          <div className="divide-y">
            {players.map((player) => (
              <div key={player.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                <div className="flex items-center gap-3">
                  <button onClick={() => toggleCheckIn(player.id, player.checked_in)} className={`w-8 h-8 rounded-full flex items-center justify-center ${player.checked_in ? 'bg-green-500 text-white' : 'bg-gray-200'}`}>
                    {player.checked_in ? '✓' : ''}
                  </button>
                  <div>
                    <p className="font-medium">{player.name}</p>
                    <p className="text-sm text-gray-500">Level {player.skill_level} • {player.wins}W / {player.losses}L</p>
                  </div>
                </div>
                <button onClick={() => deletePlayer(player.id)} className="p-2 text-gray-400 hover:text-red-500"><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {checkedInCount >= 4 && (
        <button className="w-full mt-6 py-3 bg-green-500 text-white rounded-xl font-medium hover:bg-green-600 flex items-center justify-center gap-2">
          <Play size={20} />Generate Round ({checkedInCount} players)
        </button>
      )}
    </div>
  );
}

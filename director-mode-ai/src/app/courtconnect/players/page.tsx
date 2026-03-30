'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Search, Users } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

const SPORTS = [
  { value: '', label: 'All Sports' },
  { value: 'tennis', label: 'Tennis' },
  { value: 'pickleball', label: 'Pickleball' },
  { value: 'padel', label: 'Padel' },
  { value: 'squash', label: 'Squash' },
  { value: 'badminton', label: 'Badminton' },
  { value: 'racquetball', label: 'Racquetball' },
  { value: 'table_tennis', label: 'Table Tennis' },
];

type Player = {
  id: string;
  display_name: string;
  primary_sport: string;
  bio: string | null;
  sports: {
    sport: string;
    ntrp_rating: number | null;
    utr_rating: number | null;
    level_label: string | null;
    is_self_rated: boolean;
  }[];
};

export default function PlayersPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [sportFilter, setSportFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchPlayers();
  }, [sportFilter]);

  const fetchPlayers = async () => {
    setLoading(true);
    const supabase = createClient();

    let query = supabase
      .from('cc_players')
      .select('*, sports:cc_player_sports(sport, ntrp_rating, utr_rating, level_label, is_self_rated)')
      .order('display_name');

    if (sportFilter) {
      query = query.eq('primary_sport', sportFilter);
    }

    const { data } = await query;
    if (data) setPlayers(data);
    setLoading(false);
  };

  const filtered = players.filter(p =>
    !searchQuery || p.display_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const sportLabel = (sport: string) =>
    sport.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());

  return (
    <div className="p-6 max-w-5xl mx-auto page-enter">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display">Players</h1>
          <p className="text-gray-500 mt-1">Browse player profiles and find matches</p>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4 mb-6">
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[200px] relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none z-10" />
            <input
              type="text"
              placeholder="Search players..."
              className="input pl-10"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          <select
            className="input w-auto"
            value={sportFilter}
            onChange={e => setSportFilter(e.target.value)}
          >
            {SPORTS.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Player List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="spinner" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-8 text-center">
          <Users size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">No players found.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map(player => (
            <Link
              key={player.id}
              href={`/courtconnect/players/${player.id}`}
              className="card card-interactive p-5"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-courtconnect-light flex items-center justify-center">
                  <span className="text-courtconnect font-semibold">
                    {player.display_name.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div>
                  <h3 className="font-semibold">{player.display_name}</h3>
                  <span className="text-xs text-gray-500">{sportLabel(player.primary_sport)}</span>
                </div>
              </div>

              {player.bio && (
                <p className="text-sm text-gray-600 mb-3 line-clamp-2">{player.bio}</p>
              )}

              {player.sports.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {player.sports.map(s => (
                    <span key={s.sport} className="badge badge-courtconnect text-xs">
                      {sportLabel(s.sport)}
                      {s.ntrp_rating && ` ${s.ntrp_rating}`}
                      {s.is_self_rated && ' (self)'}
                    </span>
                  ))}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

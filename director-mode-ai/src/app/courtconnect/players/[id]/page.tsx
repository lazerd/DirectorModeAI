'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Trophy, Star } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type PlayerDetail = {
  id: string;
  display_name: string;
  bio: string | null;
  primary_sport: string;
  preferred_days: string[] | null;
  preferred_times: string[] | null;
  sports: {
    sport: string;
    ntrp_rating: number | null;
    utr_rating: number | null;
    level_label: string | null;
    is_self_rated: boolean;
    admin_override: boolean;
  }[];
};

export default function PlayerDetailPage() {
  const params = useParams();
  const playerId = params.id as string;

  const [player, setPlayer] = useState<PlayerDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPlayer();
  }, [playerId]);

  const fetchPlayer = async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from('cc_players')
      .select('*, sports:cc_player_sports(*)')
      .eq('id', playerId)
      .single();
    setPlayer(data);
    setLoading(false);
  };

  const sportLabel = (sport: string) =>
    sport.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="spinner" />
      </div>
    );
  }

  if (!player) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <p className="text-gray-500">Player not found.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto page-enter">
      <Link
        href="/courtconnect/players"
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-6"
      >
        <ArrowLeft size={16} />
        Back to Players
      </Link>

      {/* Player Header */}
      <div className="card p-6 mb-6">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-16 h-16 rounded-xl bg-courtconnect-light flex items-center justify-center">
            <span className="text-courtconnect font-bold text-2xl">
              {player.display_name.charAt(0).toUpperCase()}
            </span>
          </div>
          <div>
            <h1 className="text-2xl font-display">{player.display_name}</h1>
            <span className="text-gray-500">{sportLabel(player.primary_sport)} player</span>
          </div>
        </div>
        {player.bio && <p className="text-gray-600">{player.bio}</p>}
      </div>

      {/* Sport Ratings */}
      {player.sports.length > 0 && (
        <div className="card p-6 mb-6">
          <h2 className="font-semibold text-lg mb-4 flex items-center gap-2">
            <Trophy size={20} />
            Sport Ratings
          </h2>
          <div className="space-y-4">
            {player.sports.map(s => (
              <div key={s.sport} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <span className="font-medium">{sportLabel(s.sport)}</span>
                  {s.level_label && (
                    <span className="text-sm text-gray-500 ml-2">({s.level_label})</span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-sm">
                  {s.ntrp_rating && (
                    <span className="badge badge-courtconnect">
                      NTRP {s.ntrp_rating}
                      {s.is_self_rated && !s.admin_override && (
                        <span className="text-xs opacity-75 ml-1">self</span>
                      )}
                      {s.admin_override && (
                        <Star size={12} className="ml-1" />
                      )}
                    </span>
                  )}
                  {s.utr_rating && (
                    <span className="badge badge-primary">UTR {s.utr_rating}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Availability */}
      {(player.preferred_days?.length || player.preferred_times?.length) && (
        <div className="card p-6">
          <h2 className="font-semibold text-lg mb-4">Availability</h2>
          <div className="flex flex-wrap gap-2">
            {player.preferred_days?.map(day => (
              <span key={day} className="badge badge-courtconnect capitalize">{day}</span>
            ))}
            {player.preferred_times?.map(time => (
              <span key={time} className="badge badge-primary capitalize">{time}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

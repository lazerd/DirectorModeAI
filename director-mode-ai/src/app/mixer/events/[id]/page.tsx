'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { ArrowLeft, RefreshCw, Share2, Users, Trophy, BarChart3 } from 'lucide-react';
import PlayersTab from '@/components/mixer/event/PlayersTab';
import RoundsTab from '@/components/mixer/event/RoundsTab';
import StandingsTab from '@/components/mixer/event/StandingsTab';
import EventCodeQR from '@/components/mixer/event/EventCodeQR';

interface Event {
  id: string;
  name: string;
  event_date: string;
  start_time: string | null;
  num_courts: number;
  scoring_format: string;
  round_length_minutes: number | null;
  match_format: string | null;
  target_games: number | null;
  event_code: string;
  user_id: string;
}

export default function EventDashboard() {
  const params = useParams();
  const router = useRouter();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'share' | 'players' | 'rounds' | 'standings'>('players');

  useEffect(() => {
    fetchEvent();
  }, [params.id]);

  const fetchEvent = async () => {
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .eq('id', params.id)
      .single();

    if (error || !data) {
      router.push('/mixer/home');
      return;
    }

    setEvent(data);
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500"></div>
      </div>
    );
  }

  if (!event) return null;

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const tabs = [
    { id: 'share', label: 'Share', icon: Share2 },
    { id: 'players', label: 'Players', icon: Users },
    { id: 'rounds', label: 'Rounds', icon: Trophy },
    { id: 'standings', label: 'Standings', icon: BarChart3 },
  ] as const;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => router.push('/mixer/home')}
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <h1 className="text-xl font-bold">{event.name}</h1>
                <p className="text-sm text-gray-500">
                  {formatDate(event.event_date)}
                  {event.start_time && ` at ${event.start_time}`}
                </p>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={fetchEvent}>
              <RefreshCw className="h-5 w-5" />
            </Button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-4 border-b -mb-px">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-orange-500 text-orange-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 py-6">
        {activeTab === 'share' && (
          <EventCodeQR eventCode={event.event_code} eventName={event.name} />
        )}

        {activeTab === 'players' && (
          <PlayersTab event={event} onFormatUpdated={fetchEvent} />
        )}

        {activeTab === 'rounds' && (
          <RoundsTab event={event} />
        )}

        {activeTab === 'standings' && (
          <StandingsTab eventId={event.id} />
        )}
      </main>
    </div>
  );
}

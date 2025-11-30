'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Calendar, Users, Trophy, Clock } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

export default function CreateEventPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [formData, setFormData] = useState({
    name: '',
    event_date: '',
    start_time: '',
    num_courts: 4,
    match_format: 'doubles',
    scoring_format: 'fixed_games',
    round_length_minutes: 20,
    target_games: 6,
    format_notes: '',
  });

  const generateEventCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        setError('You must be logged in');
        return;
      }

      const eventCode = generateEventCode();

      const { data, error: insertError } = await supabase
        .from('mixer_events')
        .insert({
          ...formData,
          user_id: user.id,
          event_code: eventCode,
        })
        .select()
        .single();

      if (insertError) {
        setError(insertError.message);
        return;
      }

      router.push(`/mixer/events/${data.id}`);
    } catch (err) {
      setError('An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-2xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <Link href="/mixer/home" className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="font-semibold text-2xl">Create New Event</h1>
          <p className="text-gray-500 text-sm">Set up your mixer or tournament</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold text-lg mb-4 flex items-center gap-2">
            <Calendar size={20} className="text-orange-500" />
            Event Details
          </h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Event Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                placeholder="Friday Night Mixer"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Date *</label>
                <input
                  type="date"
                  value={formData.event_date}
                  onChange={(e) => setFormData({ ...formData, event_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Start Time</label>
                <input
                  type="time"
                  value={formData.start_time}
                  onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold text-lg mb-4 flex items-center gap-2">
            <Users size={20} className="text-orange-500" />
            Format Settings
          </h2>
          
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Number of Courts</label>
                <input
                  type="number"
                  value={formData.num_courts}
                  onChange={(e) => setFormData({ ...formData, num_courts: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                  min={1}
                  max={20}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Match Format</label>
                <select
                  value={formData.match_format}
                  onChange={(e) => setFormData({ ...formData, match_format: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                >
                  <option value="doubles">Doubles</option>
                  <option value="singles">Singles</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Scoring Format</label>
              <select
                value={formData.scoring_format}
                onChange={(e) => setFormData({ ...formData, scoring_format: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
              >
                <option value="fixed_games">Fixed Games (e.g., play 6 games)</option>
                <option value="timed">Timed Rounds</option>
                <option value="first_to_x">First to X Games</option>
                <option value="pro_set">Pro Set (first to 8)</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Round Length (minutes)</label>
                <input
                  type="number"
                  value={formData.round_length_minutes}
                  onChange={(e) => setFormData({ ...formData, round_length_minutes: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                  min={10}
                  max={60}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Games per Round</label>
                <input
                  type="number"
                  value={formData.target_games}
                  onChange={(e) => setFormData({ ...formData, target_games: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                  min={4}
                  max={12}
                />
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <Link href="/mixer/home" className="flex-1 py-2 text-center border border-gray-300 rounded-lg hover:bg-gray-50">
            Cancel
          </Link>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 py-2 bg-orange-500 text-white rounded-lg font-medium hover:bg-orange-600 disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create Event'}
          </button>
        </div>
      </form>
    </div>
  );
}

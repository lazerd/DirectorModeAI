'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { ArrowLeft, Calendar, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { generateEventCode } from '@/lib/mixer/eventCodeGenerator';

export default function CreateEventPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedFormat = searchParams.get('format') || 'doubles';
  
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    eventDate: format(new Date(), 'yyyy-MM-dd'),
    startTime: format(new Date(), 'HH:mm'),
    numCourts: 4,
    scoringFormat: 'timed',
    roundLengthMinutes: 20,
    targetGames: 6,
  });

  const formatNames: { [key: string]: string } = {
    'doubles': 'Doubles',
    'singles': 'Singles',
    'mixed-doubles': 'Mixed Doubles',
    'king-of-court': 'King of the Court',
    'round-robin': 'Team Round Robin',
    'maximize-courts': 'Maximize Courts',
    'single-elimination': 'Single Elimination Tournament',
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) return;
    
    setLoading(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      router.push('/login');
      return;
    }

    // Generate unique event code
    let eventCode = generateEventCode();
    let codeExists = true;
    
    while (codeExists) {
      const { data: existing } = await supabase
        .from('events')
        .select('id')
        .eq('event_code', eventCode)
        .single();
      
      if (!existing) {
        codeExists = false;
      } else {
        eventCode = generateEventCode();
      }
    }

    const { data, error } = await supabase
      .from('events')
      .insert({
        user_id: user.id,
        name: formData.name,
        event_date: formData.eventDate,
        start_time: formData.startTime || null,
        num_courts: formData.numCourts,
        scoring_format: formData.scoringFormat,
        round_length_minutes: formData.scoringFormat === 'timed' ? formData.roundLengthMinutes : null,
        target_games: formData.scoringFormat !== 'timed' ? formData.targetGames : null,
        event_code: eventCode,
        match_format: selectedFormat,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating event:', error);
      alert('Error creating event: ' + error.message);
      setLoading(false);
      return;
    }

    router.push(`/mixer/events/${data.id}`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-orange-50">
      <header className="border-b bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <Link href="/mixer/select-format" className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900">
            <ArrowLeft size={18} />
            Back
          </Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        <div className="bg-white rounded-2xl border p-6 md:p-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-100 rounded-lg">
                <Calendar className="text-orange-600" size={24} />
              </div>
              <div>
                <h1 className="text-2xl font-bold">Create New Event</h1>
                <p className="text-gray-500 text-sm">Set up your mixer or tournament</p>
              </div>
            </div>
            <span className="px-3 py-1 bg-orange-100 text-orange-700 rounded-full text-sm font-medium">
              {formatNames[selectedFormat]}
            </span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Event Details */}
            <div className="space-y-4 p-4 bg-gray-50 rounded-xl">
              <h2 className="font-semibold flex items-center gap-2">
                <Calendar size={18} />
                Event Details
              </h2>
              
              <div>
                <label className="block text-sm font-medium mb-1">Event Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
                  placeholder="e.g., Saturday Morning Social"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Date *</label>
                  <input
                    type="date"
                    value={formData.eventDate}
                    onChange={(e) => setFormData({ ...formData, eventDate: e.target.value })}
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Start Time</label>
                  <input
                    type="time"
                    value={formData.startTime}
                    onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Format Settings */}
            <div className="space-y-4 p-4 bg-gray-50 rounded-xl">
              <h2 className="font-semibold flex items-center gap-2">
                <Clock size={18} />
                Format Settings
              </h2>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Number of Courts</label>
                  <input
                    type="number"
                    value={formData.numCourts}
                    onChange={(e) => setFormData({ ...formData, numCourts: parseInt(e.target.value) || 1 })}
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
                    min={1}
                    max={50}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Match Format</label>
                  <input
                    type="text"
                    value={formatNames[selectedFormat]}
                    disabled
                    className="w-full px-4 py-2 border rounded-lg bg-gray-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Scoring Format</label>
                <select
                  value={formData.scoringFormat}
                  onChange={(e) => setFormData({ ...formData, scoringFormat: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
                >
                  <option value="timed">Timed Rounds</option>
                  <option value="fixed_games">Fixed Number of Games</option>
                  <option value="first_to_x">First to X Games</option>
                </select>
              </div>

              {formData.scoringFormat === 'timed' && (
                <div>
                  <label className="block text-sm font-medium mb-1">Round Length (minutes)</label>
                  <input
                    type="number"
                    value={formData.roundLengthMinutes}
                    onChange={(e) => setFormData({ ...formData, roundLengthMinutes: parseInt(e.target.value) || 20 })}
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
                    min={5}
                    max={180}
                  />
                </div>
              )}

              {(formData.scoringFormat === 'fixed_games' || formData.scoringFormat === 'first_to_x') && (
                <div>
                  <label className="block text-sm font-medium mb-1">Games per Round</label>
                  <input
                    type="number"
                    value={formData.targetGames}
                    onChange={(e) => setFormData({ ...formData, targetGames: parseInt(e.target.value) || 6 })}
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
                    min={1}
                    max={21}
                  />
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <Link
                href="/mixer/select-format"
                className="flex-1 py-3 border rounded-xl text-center font-medium hover:bg-gray-50"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={loading || !formData.name}
                className="flex-1 py-3 bg-orange-500 text-white rounded-xl font-semibold hover:bg-orange-600 disabled:opacity-50"
              >
                {loading ? 'Creating...' : 'Create Event'}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}

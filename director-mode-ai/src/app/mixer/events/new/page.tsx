'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Calendar, Users, Swords } from 'lucide-react';
import { supabase } from '@/lib/supabase';

function CreateEventForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [formData, setFormData] = useState({
    name: '',
    event_date: '',
    start_time: '',
    num_courts: 4,
    match_format: '',
    scoring_format: 'fixed_games',
    round_length_minutes: 20,
    target_games: 6,
    format_notes: '',
  });

  // Team Battle specific state
  const [team1Name, setTeam1Name] = useState('Team A');
  const [team2Name, setTeam2Name] = useState('Team B');

  useEffect(() => {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().slice(0, 5);
    const formatFromUrl = searchParams.get('format') || '';
    
    setFormData(prev => ({
      ...prev,
      event_date: dateStr,
      start_time: timeStr,
      match_format: formatFromUrl,
    }));
  }, [searchParams]);

  const generateEventCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  const getFormatDisplayName = (format: string) => {
    const names: Record<string, string> = {
      'singles': 'Singles Mixer',
      'doubles': 'Doubles Mixer',
      'mixed-doubles': 'Mixed Doubles Mixer',
      'maximize-courts': 'Optimize Courts (Auto Singles/Doubles)',
      'king-of-court': 'King of the Court',
      'round-robin': 'Team Round Robin',
      'single-elimination': 'Single Elimination Tournament',
      'single-elimination-singles': 'Singles Tournament',
      'single-elimination-doubles': 'Doubles Tournament',
      'team-battle': 'Team Battle',
    };
    return names[format] || format;
  };

  const isTeamBattle = formData.match_format === 'team-battle';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        setError('You must be logged in');
        setLoading(false);
        return;
      }

      // Validate team names for team battle
      if (isTeamBattle) {
        if (!team1Name.trim() || !team2Name.trim()) {
          setError('Both team names are required');
          setLoading(false);
          return;
        }
      }

      const eventCode = generateEventCode();

      const { data, error: insertError } = await supabase
        .from('events')
        .insert({
          ...formData,
          user_id: user.id,
          event_code: eventCode,
        })
        .select()
        .single();

      if (insertError) {
        setError(insertError.message);
        setLoading(false);
        return;
      }

      // Create teams for team battle
      if (isTeamBattle) {
        const { error: teamsError } = await supabase
          .from('event_teams')
          .insert([
            { event_id: data.id, name: team1Name.trim(), color: '#3B82F6' },
            { event_id: data.id, name: team2Name.trim(), color: '#EF4444' },
          ]);

        if (teamsError) {
          console.error('Error creating teams:', teamsError);
          // Don't fail the whole event creation, teams can be added later
        }
      }

      router.push(`/mixer/events/${data.id}`);
    } catch (err) {
      setError('An error occurred');
      setLoading(false);
    }
  };

  const goToSelectFormat = () => {
    router.push('/mixer/select-format');
  };

  const handleNumberChange = (field: string, value: string, min: number = 1) => {
    if (value === '') {
      setFormData(prev => ({ ...prev, [field]: 0 }));
    } else {
      setFormData(prev => ({ ...prev, [field]: parseInt(value) || 0 }));
    }
  };

  const handleNumberBlur = (field: string, min: number = 1) => {
    setFormData(prev => ({
      ...prev,
      [field]: prev[field as keyof typeof prev] && (prev[field as keyof typeof prev] as number) >= min 
        ? prev[field as keyof typeof prev] 
        : min
    }));
  };

  return (
    <div className="p-6 lg:p-8 max-w-2xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <button 
          type="button"
          onClick={goToSelectFormat} 
          className="p-2 hover:bg-gray-100 rounded-lg"
        >
          <ArrowLeft size={20} />
        </button>
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
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-orange-500"
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
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Start Time</label>
                <input
                  type="time"
                  value={formData.start_time}
                  onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-orange-500"
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
            {formData.match_format ? (
              <div className={`p-4 rounded-xl border-2 ${isTeamBattle ? 'bg-red-50 border-red-200' : 'bg-orange-50 border-orange-200'}`}>
                <p className="text-sm text-gray-600">Selected Format:</p>
                <p className={`font-bold text-lg ${isTeamBattle ? 'text-red-700' : 'text-orange-700'}`}>
                  {isTeamBattle && '⚔️ '}{getFormatDisplayName(formData.match_format)}
                </p>
                <button 
                  type="button"
                  onClick={goToSelectFormat} 
                  className={`text-sm hover:underline mt-1 ${isTeamBattle ? 'text-red-600' : 'text-orange-600'}`}
                >
                  Change format →
                </button>
              </div>
            ) : (
              <div className="p-4 bg-gray-50 rounded-xl border-2 border-gray-200">
                <p className="text-gray-600">No format selected.</p>
                <button 
                  type="button"
                  onClick={goToSelectFormat} 
                  className="text-sm text-orange-600 hover:underline mt-1"
                >
                  Select a format →
                </button>
              </div>
            )}

            {/* Team Battle Team Names */}
            {isTeamBattle && (
              <div className="p-4 bg-gray-50 rounded-xl border-2 border-gray-200 space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <Swords size={20} className="text-red-500" />
                  <h3 className="font-semibold">Team Names</h3>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Team 1 Name *</label>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded-full bg-blue-500 flex-shrink-0"></div>
                      <input
                        type="text"
                        value={team1Name}
                        onChange={(e) => setTeam1Name(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Team A"
                        required={isTeamBattle}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Team 2 Name *</label>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded-full bg-red-500 flex-shrink-0"></div>
                      <input
                        type="text"
                        value={team2Name}
                        onChange={(e) => setTeam2Name(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-red-500"
                        placeholder="Team B"
                        required={isTeamBattle}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-1">Number of Courts</label>
              <input
                type="number"
                value={formData.num_courts || ''}
                onChange={(e) => handleNumberChange('num_courts', e.target.value)}
                onBlur={() => handleNumberBlur('num_courts', 1)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                min={1}
                max={20}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Scoring Format</label>
              <select
                value={formData.scoring_format}
                onChange={(e) => setFormData({ ...formData, scoring_format: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-orange-500"
              >
                <option value="fixed_games">Fixed Games (e.g., play 6 games)</option>
                <option value="timed">Timed Rounds</option>
                <option value="first_to_x">First to X Games</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {formData.scoring_format === 'timed' && (
                <div>
                  <label className="block text-sm font-medium mb-1">Round Length (minutes)</label>
                  <input
                    type="number"
                    value={formData.round_length_minutes || ''}
                    onChange={(e) => handleNumberChange('round_length_minutes', e.target.value)}
                    onBlur={() => handleNumberBlur('round_length_minutes', 5)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                    min={5}
                    max={60}
                  />
                </div>
              )}
              {(formData.scoring_format === 'fixed_games' || formData.scoring_format === 'first_to_x') && (
                <div>
                  <label className="block text-sm font-medium mb-1">Target Games</label>
                  <input
                    type="number"
                    value={formData.target_games || ''}
                    onChange={(e) => handleNumberChange('target_games', e.target.value)}
                    onBlur={() => handleNumberBlur('target_games', 1)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                    min={1}
                    max={21}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={goToSelectFormat}
            className="flex-1 py-2 text-center border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || !formData.match_format}
            className={`flex-1 py-2 text-white rounded-lg font-medium disabled:opacity-50 ${
              isTeamBattle 
                ? 'bg-red-500 hover:bg-red-600' 
                : 'bg-orange-500 hover:bg-orange-600'
            }`}
          >
            {loading ? 'Creating...' : isTeamBattle ? 'Create Team Battle' : 'Create Event'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function CreateEventPage() {
  return (
    <Suspense fallback={<div className="p-6 text-center">Loading...</div>}>
      <CreateEventForm />
    </Suspense>
  );
}

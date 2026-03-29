'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Plus, Trash2, Save } from 'lucide-react';

const SPORTS = [
  { value: 'tennis', label: 'Tennis' },
  { value: 'pickleball', label: 'Pickleball' },
  { value: 'padel', label: 'Padel' },
  { value: 'squash', label: 'Squash' },
  { value: 'badminton', label: 'Badminton' },
  { value: 'racquetball', label: 'Racquetball' },
  { value: 'table_tennis', label: 'Table Tennis' },
];

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const TIMES = ['morning', 'afternoon', 'evening'];

type SportRating = {
  id?: string;
  sport: string;
  ntrp_rating: string;
  utr_rating: string;
  level_label: string;
};

export default function PlayerProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [primarySport, setPrimarySport] = useState('tennis');
  const [preferredDays, setPreferredDays] = useState<string[]>([]);
  const [preferredTimes, setPreferredTimes] = useState<string[]>([]);
  const [sportRatings, setSportRatings] = useState<SportRating[]>([
    { sport: 'tennis', ntrp_rating: '', utr_rating: '', level_label: '' },
  ]);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    // Get profile name as default
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single();

    // Check for existing player profile
    const { data: player } = await supabase
      .from('cc_players')
      .select('*, sports:cc_player_sports(*)')
      .eq('profile_id', user.id)
      .single();

    if (player) {
      setPlayerId(player.id);
      setDisplayName(player.display_name);
      setBio(player.bio || '');
      setPrimarySport(player.primary_sport);
      setPreferredDays(player.preferred_days || []);
      setPreferredTimes(player.preferred_times || []);

      if (player.sports?.length > 0) {
        setSportRatings(
          player.sports.map((s: any) => ({
            id: s.id,
            sport: s.sport,
            ntrp_rating: s.ntrp_rating?.toString() || '',
            utr_rating: s.utr_rating?.toString() || '',
            level_label: s.level_label || '',
          }))
        );
      }
    } else {
      setDisplayName(profile?.full_name || '');
    }

    setLoading(false);
  };

  const toggleDay = (day: string) => {
    setPreferredDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const toggleTime = (time: string) => {
    setPreferredTimes(prev =>
      prev.includes(time) ? prev.filter(t => t !== time) : [...prev, time]
    );
  };

  const addSport = () => {
    const usedSports = sportRatings.map(s => s.sport);
    const available = SPORTS.find(s => !usedSports.includes(s.value));
    if (available) {
      setSportRatings(prev => [
        ...prev,
        { sport: available.value, ntrp_rating: '', utr_rating: '', level_label: '' },
      ]);
    }
  };

  const removeSport = (index: number) => {
    setSportRatings(prev => prev.filter((_, i) => i !== index));
  };

  const updateSport = (index: number, field: keyof SportRating, value: string) => {
    setSportRatings(prev =>
      prev.map((s, i) => (i === index ? { ...s, [field]: value } : s))
    );
  };

  const handleSave = async () => {
    setSaving(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }

    const playerData = {
      profile_id: user.id,
      display_name: displayName,
      bio: bio || null,
      primary_sport: primarySport,
      preferred_days: preferredDays,
      preferred_times: preferredTimes,
    };

    let currentPlayerId = playerId;

    if (playerId) {
      await supabase.from('cc_players').update(playerData).eq('id', playerId);
    } else {
      const { data } = await supabase.from('cc_players').insert(playerData).select().single();
      if (data) {
        currentPlayerId = data.id;
        setPlayerId(data.id);
      }
    }

    if (currentPlayerId) {
      // Delete existing sport ratings and re-insert
      await supabase.from('cc_player_sports').delete().eq('player_id', currentPlayerId);

      const ratingsToInsert = sportRatings
        .filter(s => s.sport)
        .map(s => ({
          player_id: currentPlayerId!,
          sport: s.sport,
          ntrp_rating: s.ntrp_rating ? parseFloat(s.ntrp_rating) : null,
          utr_rating: s.utr_rating ? parseFloat(s.utr_rating) : null,
          level_label: s.level_label || null,
          is_self_rated: true,
        }));

      if (ratingsToInsert.length > 0) {
        await supabase.from('cc_player_sports').insert(ratingsToInsert);
      }
    }

    setSaving(false);
    router.push('/courtconnect/home');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto page-enter">
      <h1 className="text-2xl font-display mb-6">
        {playerId ? 'Edit Player Profile' : 'Create Player Profile'}
      </h1>

      <div className="space-y-6">
        {/* Basic Info */}
        <div className="card p-6 space-y-4">
          <h2 className="font-semibold text-lg">Basic Info</h2>
          <div>
            <label className="label">Display Name *</label>
            <input
              type="text"
              className="input"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Your name"
              required
            />
          </div>
          <div>
            <label className="label">Bio</label>
            <textarea
              className="input"
              value={bio}
              onChange={e => setBio(e.target.value)}
              placeholder="Tell other players about yourself..."
              rows={3}
            />
          </div>
          <div>
            <label className="label">Primary Sport</label>
            <select
              className="input"
              value={primarySport}
              onChange={e => setPrimarySport(e.target.value)}
            >
              {SPORTS.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Sport Ratings */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-lg">Sport Ratings</h2>
            {sportRatings.length < SPORTS.length && (
              <button onClick={addSport} className="btn btn-ghost btn-sm">
                <Plus size={16} />
                Add Sport
              </button>
            )}
          </div>
          <div className="space-y-4">
            {sportRatings.map((rating, index) => (
              <div key={index} className="p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center justify-between mb-3">
                  <select
                    className="input w-auto"
                    value={rating.sport}
                    onChange={e => updateSport(index, 'sport', e.target.value)}
                  >
                    {SPORTS.map(s => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                  {sportRatings.length > 1 && (
                    <button
                      onClick={() => removeSport(index)}
                      className="btn btn-ghost btn-icon btn-sm text-red-500"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="label text-xs">NTRP (1.0-7.0)</label>
                    <input
                      type="number"
                      className="input"
                      min={1.0}
                      max={7.0}
                      step={0.5}
                      placeholder="e.g. 3.5"
                      value={rating.ntrp_rating}
                      onChange={e => updateSport(index, 'ntrp_rating', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label text-xs">UTR (1-16.5)</label>
                    <input
                      type="number"
                      className="input"
                      min={1}
                      max={16.5}
                      step={0.01}
                      placeholder="e.g. 8.5"
                      value={rating.utr_rating}
                      onChange={e => updateSport(index, 'utr_rating', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label text-xs">Level Label</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="e.g. Advanced"
                      value={rating.level_label}
                      onChange={e => updateSport(index, 'level_label', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Availability */}
        <div className="card p-6">
          <h2 className="font-semibold text-lg mb-4">Availability</h2>
          <div className="mb-4">
            <label className="label text-sm">Preferred Days</label>
            <div className="flex flex-wrap gap-2">
              {DAYS.map(day => (
                <button
                  key={day}
                  onClick={() => toggleDay(day)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    preferredDays.includes(day)
                      ? 'bg-courtconnect text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {day.charAt(0).toUpperCase() + day.slice(0, 3)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label text-sm">Preferred Times</label>
            <div className="flex flex-wrap gap-2">
              {TIMES.map(time => (
                <button
                  key={time}
                  onClick={() => toggleTime(time)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    preferredTimes.includes(time)
                      ? 'bg-courtconnect text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {time.charAt(0).toUpperCase() + time.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Save */}
        <button
          onClick={handleSave}
          className="btn btn-courtconnect w-full btn-lg"
          disabled={saving || !displayName}
        >
          {saving ? <div className="spinner" /> : (
            <>
              <Save size={18} />
              {playerId ? 'Save Changes' : 'Create Profile'}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

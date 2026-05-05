'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Calendar, Users, Swords, DollarSign, AlertCircle } from 'lucide-react';
import { trackEvent } from '@/lib/analytics';
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

  // Public signup + payment (orthogonal to format — works on any mixer)
  const [publicCfg, setPublicCfg] = useState({
    public_registration: false,
    entry_fee_dollars: 0,
    max_players: 20,
    age_max: '' as string | number,
    gender_restriction: 'coed' as 'boys' | 'girls' | 'coed',
    registration_closes_at: '',
  });
  const [stripeReady, setStripeReady] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_account_id, stripe_charges_enabled')
        .eq('id', user.id)
        .maybeSingle();
      setStripeReady(!!(profile?.stripe_account_id && profile?.stripe_charges_enabled));
    })();
  }, []);

  const slugify = (input: string) =>
    input.toLowerCase().trim().replace(/['"]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);

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

      // Public-signup events need a slug + Stripe Connect snapshot if paid
      let publicFields: Record<string, any> = {};
      if (publicCfg.public_registration) {
        const wantsPayment = publicCfg.entry_fee_dollars > 0;
        if (wantsPayment && !stripeReady) {
          setError('Connect Stripe before charging entry fees. Open Settings → Payouts.');
          setLoading(false);
          return;
        }
        const { data: profile } = await supabase
          .from('profiles')
          .select('stripe_account_id')
          .eq('id', user.id)
          .maybeSingle();
        const slugBase = slugify(formData.name);
        const slug = `${slugBase}-${Math.random().toString(36).slice(2, 6)}`;
        const ageNum =
          typeof publicCfg.age_max === 'number'
            ? publicCfg.age_max
            : publicCfg.age_max === ''
              ? null
              : parseInt(String(publicCfg.age_max), 10) || null;
        publicFields = {
          slug,
          public_registration: true,
          entry_fee_cents: Math.round(publicCfg.entry_fee_dollars * 100),
          max_players: publicCfg.max_players || null,
          age_max: ageNum,
          gender_restriction: publicCfg.gender_restriction,
          registration_opens_at: new Date().toISOString(),
          registration_closes_at: publicCfg.registration_closes_at
            ? new Date(publicCfg.registration_closes_at).toISOString()
            : null,
          stripe_account_id: profile?.stripe_account_id || null,
          public_status: 'open',
        };
      }

      const { data, error: insertError } = await supabase
        .from('events')
        .insert({
          ...formData,
          ...publicFields,
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

      trackEvent('feature_use', 'create_event', 'mixer');
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
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto">
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
        <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

        <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

        {/* Public signup + payment (orthogonal to format) */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 space-y-4">
          <h2 className="font-semibold text-lg flex items-center gap-2">
            <DollarSign size={20} className="text-emerald-500" />
            Public Signup & Payment
          </h2>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={publicCfg.public_registration}
              onChange={(e) =>
                setPublicCfg({ ...publicCfg, public_registration: e.target.checked })
              }
              className="mt-0.5 rounded border-gray-300"
            />
            <div>
              <div className="font-medium">Open to public signup</div>
              <div className="text-xs text-gray-600">
                Players self-register at <code>/events/[slug]</code>. Uncheck for a director-only
                event you set up day-of.
              </div>
            </div>
          </label>

          {publicCfg.public_registration && (
            <>
              {publicCfg.entry_fee_dollars > 0 && stripeReady === false && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 flex items-start gap-2 text-sm">
                  <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                  <div>
                    Stripe not connected.{' '}
                    <Link href="/mixer/settings" className="underline font-medium">
                      Connect Stripe →
                    </Link>{' '}
                    required for paid events.
                  </div>
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Entry Fee (USD)</label>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500">$</span>
                    <input
                      type="number"
                      min={0}
                      max={500}
                      step={1}
                      value={publicCfg.entry_fee_dollars}
                      onChange={(e) =>
                        setPublicCfg({
                          ...publicCfg,
                          entry_fee_dollars: parseFloat(e.target.value || '0'),
                        })
                      }
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900"
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    0 = free. Paid via Stripe Connect (3% platform fee).
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Max Players (cap)</label>
                  <input
                    type="number"
                    min={2}
                    max={64}
                    value={publicCfg.max_players}
                    onChange={(e) =>
                      setPublicCfg({
                        ...publicCfg,
                        max_players: parseInt(e.target.value || '2', 10),
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900"
                  />
                  <p className="text-xs text-gray-500 mt-1">Extras → waitlist.</p>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Age Cap</label>
                  <input
                    type="number"
                    min={5}
                    max={99}
                    value={publicCfg.age_max}
                    onChange={(e) =>
                      setPublicCfg({
                        ...publicCfg,
                        age_max: e.target.value === '' ? '' : parseInt(e.target.value, 10),
                      })
                    }
                    placeholder="18"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Gender</label>
                  <select
                    value={publicCfg.gender_restriction}
                    onChange={(e) =>
                      setPublicCfg({
                        ...publicCfg,
                        gender_restriction: e.target.value as typeof publicCfg.gender_restriction,
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900"
                  >
                    <option value="coed">Coed</option>
                    <option value="boys">Boys only</option>
                    <option value="girls">Girls only</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Registration Closes</label>
                <input
                  type="datetime-local"
                  value={publicCfg.registration_closes_at}
                  onChange={(e) =>
                    setPublicCfg({ ...publicCfg, registration_closes_at: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900"
                />
                <p className="text-xs text-gray-500 mt-1">Blank = stays open until you close it.</p>
              </div>
            </>
          )}
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

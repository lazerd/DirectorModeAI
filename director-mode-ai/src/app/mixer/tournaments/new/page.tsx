'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Calendar,
  Trophy,
  DollarSign,
  Users,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  QUAD_SCORING_FORMATS,
  GENDER_RESTRICTIONS,
  type QuadScoringFormatId,
  type GenderRestriction,
} from '@/lib/quads';

const FORMAT_LABELS: Record<string, string> = {
  'rr-singles': 'Round Robin — Singles',
  'rr-doubles': 'Round Robin — Doubles',
  'single-elim-singles': 'Single Elimination — Singles',
  'single-elim-doubles': 'Single Elimination — Doubles',
  'fmlc-singles': 'First-Match Loser Consolation — Singles',
  'fmlc-doubles': 'First-Match Loser Consolation — Doubles',
  'ffic-singles': 'Full Feed-In Consolation — Singles',
  'ffic-doubles': 'Full Feed-In Consolation — Doubles',
};

const VALID_FORMATS = new Set(Object.keys(FORMAT_LABELS));

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function generateEventCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 6; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
}

function CreateTournamentForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const formatParam = searchParams.get('format') || '';
  const validFormat = VALID_FORMATS.has(formatParam) ? formatParam : '';

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stripeConnected, setStripeConnected] = useState<boolean | null>(null);

  const [form, setForm] = useState({
    name: '',
    event_date: '',
    end_date: '',
    daily_start_time: '09:00',
    daily_end_time: '18:00',
    num_courts: 4,
    age_max: '' as string | number,
    gender_restriction: 'coed' as GenderRestriction,
    scoring_format: 'pro8' as QuadScoringFormatId,
    custom_scoring: '',
    entry_fee_dollars: 25,
    max_players: 16,
    public_registration: true,
    registration_opens_now: true,
    registration_closes_at: '',
    default_match_length_minutes: 90,
    player_rest_minutes: 60,
    match_buffer_minutes: 30,
  });

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    setForm((p) => ({ ...p, event_date: today, end_date: today }));
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_account_id, stripe_charges_enabled')
        .eq('id', user.id)
        .maybeSingle();
      setStripeConnected(!!(profile?.stripe_account_id && profile?.stripe_charges_enabled));
    })();
  }, []);

  if (!validFormat) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <p className="text-red-700 bg-red-50 border border-red-200 rounded-lg p-4">
          Missing or invalid <code>format</code> URL param. Pick a tournament format from{' '}
          <Link href="/mixer/select-format" className="underline">
            /mixer/select-format
          </Link>
          .
        </p>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError('You must be logged in.');
        setLoading(false);
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_account_id, stripe_charges_enabled')
        .eq('id', user.id)
        .maybeSingle();

      const wantsPayment = (form.entry_fee_dollars ?? 0) > 0;
      const stripeReady = !!(profile?.stripe_account_id && profile?.stripe_charges_enabled);
      if (wantsPayment && !stripeReady) {
        setError('Connect Stripe before creating a paid tournament. Open Settings → Payouts.');
        setLoading(false);
        return;
      }

      const slugBase = slugify(form.name);
      const slug = `${slugBase}-${Math.random().toString(36).slice(2, 6)}`;

      const ageNum =
        typeof form.age_max === 'number'
          ? form.age_max
          : form.age_max === ''
            ? null
            : parseInt(String(form.age_max), 10) || null;

      const { data, error: insertErr } = await supabase
        .from('events')
        .insert({
          user_id: user.id,
          event_code: generateEventCode(),
          name: form.name.trim(),
          event_date: form.event_date,
          end_date: form.end_date || form.event_date,
          start_time: form.daily_start_time || null,
          daily_start_time: form.daily_start_time || null,
          daily_end_time: form.daily_end_time || null,
          num_courts: form.num_courts,
          match_format: validFormat,
          scoring_format: 'fixed_games', // legacy column unused for tournaments
          slug,
          public_registration: form.public_registration,
          entry_fee_cents: Math.round((form.entry_fee_dollars || 0) * 100),
          registration_opens_at: form.registration_opens_now
            ? new Date().toISOString()
            : null,
          registration_closes_at: form.registration_closes_at
            ? new Date(form.registration_closes_at).toISOString()
            : null,
          max_players: form.max_players || null,
          age_max: ageNum,
          gender_restriction: form.gender_restriction,
          event_scoring_format:
            form.scoring_format === 'custom'
              ? form.custom_scoring.trim() || 'Custom format'
              : form.scoring_format,
          stripe_account_id: profile?.stripe_account_id || null,
          public_status: form.public_registration ? 'open' : 'draft',
          default_match_length_minutes: form.default_match_length_minutes,
          player_rest_minutes: form.player_rest_minutes,
          match_buffer_minutes: form.match_buffer_minutes,
        })
        .select('id, slug')
        .single();

      if (insertErr || !data) {
        setError(insertErr?.message || 'Failed to create tournament');
        setLoading(false);
        return;
      }

      router.push(`/mixer/events/${data.id}`);
    } catch (err: any) {
      setError(err?.message || 'An error occurred');
      setLoading(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/mixer/select-format" className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="font-semibold text-2xl">New Tournament</h1>
          <p className="text-gray-500 text-sm">{FORMAT_LABELS[validFormat]}</p>
        </div>
      </div>

      {form.public_registration && form.entry_fee_dollars > 0 && stripeConnected === false && (
        <div className="mb-6 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle size={18} className="mt-0.5 flex-shrink-0" />
          <div className="text-sm flex-1">
            <p className="font-medium">Stripe not connected.</p>
            <p>
              Required for paid tournaments.{' '}
              <Link href="/mixer/settings" className="underline font-medium">
                Connect Stripe →
              </Link>
            </p>
          </div>
        </div>
      )}

      <form onSubmit={submit} className="space-y-6">
        {/* Tournament details */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
          <h2 className="font-semibold text-lg mb-4 flex items-center gap-2">
            <Trophy size={20} className="text-orange-500" />
            Tournament
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                placeholder="Spring Open — Singles"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-orange-500 focus:outline-none text-gray-900"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Start Date *</label>
                <input
                  type="date"
                  value={form.event_date}
                  onChange={(e) => {
                    const v = e.target.value;
                    setForm({
                      ...form,
                      event_date: v,
                      // Snap end_date forward if it's now before start_date
                      end_date: form.end_date && form.end_date < v ? v : form.end_date || v,
                    });
                  }}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-orange-500 focus:outline-none text-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">End Date *</label>
                <input
                  type="date"
                  value={form.end_date}
                  min={form.event_date}
                  onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-orange-500 focus:outline-none text-gray-900"
                />
                <p className="text-xs text-gray-500 mt-1">Same as start = single-day.</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Daily Start Time</label>
                <input
                  type="time"
                  value={form.daily_start_time}
                  onChange={(e) => setForm({ ...form, daily_start_time: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-orange-500 focus:outline-none text-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Daily End Time</label>
                <input
                  type="time"
                  value={form.daily_end_time}
                  onChange={(e) => setForm({ ...form, daily_end_time: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-orange-500 focus:outline-none text-gray-900"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Number of Courts</label>
              <input
                type="number"
                min={1}
                max={50}
                value={form.num_courts}
                onChange={(e) =>
                  setForm({ ...form, num_courts: parseInt(e.target.value || '1', 10) })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-orange-500 focus:outline-none text-gray-900"
              />
            </div>
          </div>
        </div>

        {/* Eligibility */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
          <h2 className="font-semibold text-lg mb-4 flex items-center gap-2">
            <Users size={20} className="text-orange-500" />
            Eligibility
          </h2>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Age Cap</label>
                <input
                  type="number"
                  min={5}
                  max={99}
                  value={form.age_max}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      age_max: e.target.value === '' ? '' : parseInt(e.target.value, 10),
                    })
                  }
                  placeholder="18"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-orange-500 focus:outline-none text-gray-900"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Players must be this age or younger. Blank = open age.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Gender</label>
                <select
                  value={form.gender_restriction}
                  onChange={(e) =>
                    setForm({ ...form, gender_restriction: e.target.value as GenderRestriction })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-orange-500 focus:outline-none text-gray-900"
                >
                  {GENDER_RESTRICTIONS.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Max Players (cap)</label>
              <input
                type="number"
                min={2}
                max={128}
                value={form.max_players}
                onChange={(e) =>
                  setForm({
                    ...form,
                    max_players: parseInt(e.target.value || '2', 10),
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-orange-500 focus:outline-none text-gray-900"
              />
              <p className="text-xs text-gray-500 mt-1">Extras land on the waitlist.</p>
            </div>
          </div>
        </div>

        {/* Scheduling defaults */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 space-y-4">
          <h2 className="font-semibold text-lg flex items-center gap-2">
            <Calendar size={20} className="text-orange-500" />
            Scheduling
          </h2>
          <p className="text-sm text-gray-600">
            Used by Auto-schedule to fit matches into your daily windows. Override later
            per-match if needed.
          </p>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Match length (min)</label>
              <input
                type="number"
                min={5}
                max={480}
                step={5}
                value={form.default_match_length_minutes}
                onChange={(e) =>
                  setForm({
                    ...form,
                    default_match_length_minutes: parseInt(e.target.value || '90', 10),
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900"
              />
              <p className="text-xs text-gray-500 mt-1">Default 90 (best-of-3 singles).</p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Player rest (min)</label>
              <input
                type="number"
                min={0}
                max={480}
                step={15}
                value={form.player_rest_minutes}
                onChange={(e) =>
                  setForm({
                    ...form,
                    player_rest_minutes: parseInt(e.target.value || '60', 10),
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900"
              />
              <p className="text-xs text-gray-500 mt-1">Min gap between same player's matches.</p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Buffer (min)</label>
              <input
                type="number"
                min={0}
                max={240}
                step={5}
                value={form.match_buffer_minutes}
                onChange={(e) =>
                  setForm({
                    ...form,
                    match_buffer_minutes: parseInt(e.target.value || '30', 10),
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900"
              />
              <p className="text-xs text-gray-500 mt-1">Gap between dependent matches.</p>
            </div>
          </div>
        </div>

        {/* Format / Scoring */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
          <h2 className="font-semibold text-lg mb-4">Match Scoring</h2>
          <select
            value={form.scoring_format}
            onChange={(e) =>
              setForm({ ...form, scoring_format: e.target.value as QuadScoringFormatId })
            }
            className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-orange-500 focus:outline-none text-gray-900"
          >
            {QUAD_SCORING_FORMATS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
          {form.scoring_format === 'custom' && (
            <input
              type="text"
              value={form.custom_scoring}
              onChange={(e) => setForm({ ...form, custom_scoring: e.target.value })}
              placeholder='e.g. "First to 4 games, no-ad scoring"'
              maxLength={120}
              className="w-full mt-2 px-3 py-2 border border-orange-300 rounded-lg bg-white text-gray-900"
            />
          )}
        </div>

        {/* Signup + payment */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 space-y-4">
          <h2 className="font-semibold text-lg flex items-center gap-2">
            <DollarSign size={20} className="text-emerald-500" />
            Signup & Payment
          </h2>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.public_registration}
              onChange={(e) =>
                setForm({ ...form, public_registration: e.target.checked })
              }
              className="mt-0.5 rounded border-gray-300"
            />
            <div>
              <div className="font-medium">Public signup page</div>
              <div className="text-xs text-gray-600">
                When checked, players self-register at <code>/tournaments/[slug]</code>. Uncheck to
                add players manually as the director.
              </div>
            </div>
          </label>

          {form.public_registration && (
            <div>
              <label className="block text-sm font-medium mb-1">Entry Fee (USD)</label>
              <div className="flex items-center gap-2">
                <span className="text-gray-500">$</span>
                <input
                  type="number"
                  min={0}
                  max={500}
                  step={1}
                  value={form.entry_fee_dollars}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      entry_fee_dollars: parseFloat(e.target.value || '0'),
                    })
                  }
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900"
                />
              </div>
              <p className="text-xs text-gray-500 mt-2">
                0 = free tournament. Paid entries flow through Stripe Connect to your account
                (3% platform fee).
              </p>
            </div>
          )}
        </div>

        {/* Registration window */}
        {form.public_registration && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
            <h2 className="font-semibold text-lg mb-4 flex items-center gap-2">
              <Calendar size={20} className="text-orange-500" />
              Registration Window
            </h2>
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.registration_opens_now}
                  onChange={(e) =>
                    setForm({ ...form, registration_opens_now: e.target.checked })
                  }
                  className="rounded border-gray-300"
                />
                Open registration immediately
              </label>
              <div>
                <label className="block text-sm font-medium mb-1">Closes At</label>
                <input
                  type="datetime-local"
                  value={form.registration_closes_at}
                  onChange={(e) =>
                    setForm({ ...form, registration_closes_at: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900"
                />
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 flex items-start gap-2 text-sm">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
            <div>{error}</div>
          </div>
        )}

        <div className="flex gap-3">
          <Link
            href="/mixer/select-format"
            className="flex-1 py-2 text-center border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={loading || !form.name.trim()}
            className="flex-1 py-2 text-white rounded-lg font-medium disabled:opacity-50 bg-orange-500 hover:bg-orange-600 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            {loading ? 'Creating…' : 'Create Tournament'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function NewTournamentPage() {
  return (
    <Suspense fallback={<div className="p-6 text-center">Loading...</div>}>
      <CreateTournamentForm />
    </Suspense>
  );
}

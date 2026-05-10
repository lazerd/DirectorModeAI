'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
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

export default function NewQuadsTournamentPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stripeConnected, setStripeConnected] = useState<boolean | null>(null);

  const [form, setForm] = useState({
    name: '',
    event_date: '',
    start_time: '09:00',
    num_courts: 4,
    age_max: '' as string | number, // empty = open
    gender_restriction: 'coed' as GenderRestriction,
    scoring_format: 'pro8' as QuadScoringFormatId,
    custom_scoring: '',
    entry_fee_dollars: 25,
    max_players: 16,
    registration_opens_now: true,
    registration_closes_at: '',
  });

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    setForm((p) => ({ ...p, event_date: today }));
    // Check Stripe Connect status
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

      // Get director's Stripe account snapshot
      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_account_id, stripe_charges_enabled')
        .eq('id', user.id)
        .maybeSingle();

      const wantsPayment = (form.entry_fee_dollars ?? 0) > 0;
      const stripeReady = !!(profile?.stripe_account_id && profile?.stripe_charges_enabled);
      if (wantsPayment && !stripeReady) {
        setError(
          'Connect Stripe before creating a paid tournament. Open Settings → Payouts.'
        );
        setLoading(false);
        return;
      }

      const slugBase = slugify(form.name);
      // Append a short random suffix so the URL is unique even if someone names two tournaments the same.
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
          start_time: form.start_time || null,
          num_courts: form.num_courts,
          match_format: 'quads',
          scoring_format: 'fixed_games', // legacy column, not used by quads
          // quads-specific
          slug,
          public_registration: true,
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
          public_status: 'open',
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
          <h1 className="font-semibold text-2xl">New Quads Tournament</h1>
          <p className="text-gray-500 text-sm">
            Public-signup, paid entry, flights of 4. 3 singles + 1 doubles per flight.
          </p>
        </div>
      </div>

      {stripeConnected === false && (
        <div className="mb-6 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle size={18} className="mt-0.5 flex-shrink-0" />
          <div className="text-sm flex-1">
            <p className="font-medium">Stripe not connected.</p>
            <p>
              You need to connect Stripe to accept entry fees.{' '}
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
                placeholder="10U Boys Quads — Spring 2026"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-orange-500 focus:outline-none text-gray-900"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Date *</label>
                <input
                  type="date"
                  value={form.event_date}
                  onChange={(e) => setForm({ ...form, event_date: e.target.value })}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-orange-500 focus:outline-none text-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Start Time</label>
                <input
                  type="time"
                  value={form.start_time}
                  onChange={(e) => setForm({ ...form, start_time: e.target.value })}
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
              <p className="text-xs text-gray-500 mt-1">
                Each flight needs 2 courts to run R1–R3 simultaneously, then 1 court for R4 doubles.
              </p>
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
                  placeholder="10"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-orange-500 focus:outline-none text-gray-900"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Players must be this age or younger. Leave blank for open age.
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
                min={4}
                max={64}
                step={4}
                value={form.max_players}
                onChange={(e) =>
                  setForm({
                    ...form,
                    max_players: parseInt(e.target.value || '4', 10),
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-orange-500 focus:outline-none text-gray-900"
              />
              <p className="text-xs text-gray-500 mt-1">
                {Math.floor((form.max_players || 0) / 4)} flight
                {Math.floor((form.max_players || 0) / 4) === 1 ? '' : 's'} max. Extras go to the
                waitlist.
              </p>
            </div>
          </div>
        </div>

        {/* Format */}
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
              placeholder='e.g. "First to 4 games, no-ad scoring, no tiebreak"'
              maxLength={120}
              className="w-full mt-2 px-3 py-2 border border-orange-300 rounded-lg bg-white focus:ring-2 focus:ring-orange-500 focus:outline-none text-gray-900"
            />
          )}
          <p className="text-xs text-gray-500 mt-2">
            Used for all 6 singles matches and the round-4 doubles in every flight.
          </p>
        </div>

        {/* Payment */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
          <h2 className="font-semibold text-lg mb-4 flex items-center gap-2">
            <DollarSign size={20} className="text-emerald-500" />
            Payment
          </h2>
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
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-orange-500 focus:outline-none text-gray-900"
            />
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Set to 0 for a free tournament. Paid entries go straight to your connected Stripe
            account.
          </p>
        </div>

        {/* Registration window */}
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
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-orange-500 focus:outline-none text-gray-900"
              />
              <p className="text-xs text-gray-500 mt-1">
                Leave blank to keep open until you manually close it.
              </p>
            </div>
          </div>
        </div>

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

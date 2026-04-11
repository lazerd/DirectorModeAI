'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Trophy, Calendar, DollarSign, Link as LinkIcon, AlertCircle, GitBranch, RotateCw, Compass } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { slugify, CATEGORY_ORDER, CATEGORY_LABELS, isDoubles, type CategoryKey } from '@/lib/leagueUtils';

type CategoryConfig = {
  key: CategoryKey;
  enabled: boolean;
  entry_fee: string; // dollars, string so empty is allowed
};

function LeagueTypeOption({
  active,
  onClick,
  icon: Icon,
  label,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-3 rounded-lg border transition-colors ${
        active
          ? 'border-orange-500 bg-orange-50 ring-1 ring-orange-500'
          : 'border-gray-200 hover:border-gray-300 bg-white'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon size={16} className={active ? 'text-orange-600' : 'text-gray-400'} />
        <div className="font-semibold text-sm text-gray-900">{label}</div>
      </div>
      <div className="text-xs text-gray-500 leading-snug">{desc}</div>
    </button>
  );
}

export default function NewLeaguePage() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugDirty, setSlugDirty] = useState(false);
  const [description, setDescription] = useState('');
  const [leagueType, setLeagueType] = useState<'compass' | 'round_robin' | 'single_elimination'>('compass');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [regOpens, setRegOpens] = useState('');
  const [regCloses, setRegCloses] = useState('');

  const [venmo, setVenmo] = useState('');
  const [zelle, setZelle] = useState('');
  const [stripeLink, setStripeLink] = useState('');

  const [categories, setCategories] = useState<CategoryConfig[]>(
    CATEGORY_ORDER.map(key => ({ key, enabled: true, entry_fee: '40' }))
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-derive slug from name until user edits it manually.
  const derivedSlug = useMemo(() => slugify(name), [name]);
  const effectiveSlug = slugDirty ? slug : derivedSlug;

  const updateCategory = (key: CategoryKey, patch: Partial<CategoryConfig>) => {
    setCategories(prev => prev.map(c => (c.key === key ? { ...c, ...patch } : c)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) return setError('Name is required.');
    if (!effectiveSlug) return setError('Slug is required.');
    if (!startDate || !endDate) return setError('Start and end dates are required.');
    if (new Date(endDate) < new Date(startDate)) return setError('End date must be after start date.');
    if (!categories.some(c => c.enabled)) return setError('At least one category must be enabled.');

    setSaving(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError('You must be signed in.');
      setSaving(false);
      return;
    }

    // 1. Insert league
    const { data: league, error: insertErr } = await supabase
      .from('leagues')
      .insert({
        director_id: user.id,
        name: name.trim(),
        slug: effectiveSlug,
        description: description.trim() || null,
        league_type: leagueType,
        start_date: startDate,
        end_date: endDate,
        registration_opens_at: regOpens || null,
        registration_closes_at: regCloses || null,
        venmo_handle: venmo.trim() || null,
        zelle_handle: zelle.trim() || null,
        stripe_payment_link: stripeLink.trim() || null,
        status: 'open',
      })
      .select()
      .single();

    if (insertErr || !league) {
      setError(`Failed to create league: ${insertErr?.message || 'unknown error'}`);
      setSaving(false);
      return;
    }

    // 2. Insert enabled categories
    const categoryRows = categories
      .filter(c => c.enabled)
      .map(c => ({
        league_id: (league as any).id,
        category_key: c.key,
        entry_fee_cents: Math.round(parseFloat(c.entry_fee || '0') * 100),
        is_enabled: true,
      }));

    if (categoryRows.length > 0) {
      const { error: catErr } = await supabase.from('league_categories').insert(categoryRows);
      if (catErr) {
        setError(`League created but categories failed: ${catErr.message}`);
        setSaving(false);
        return;
      }
    }

    router.push(`/mixer/leagues/${(league as any).id}`);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/mixer/leagues" className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="font-semibold text-2xl text-gray-900">Create League</h1>
          <p className="text-gray-500 text-sm">Set up a summer compass-draw league with 4 categories.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Basics */}
        <section className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
          <h2 className="font-semibold text-lg mb-4 flex items-center gap-2 text-gray-900">
            <Trophy size={18} className="text-orange-500" />
            Basics
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700">League name *</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                placeholder="Lamorinda Summer 2026"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700">URL slug *</label>
              <div className="flex items-center gap-2">
                <span className="text-gray-400 text-sm">club.coachmode.ai/leagues/</span>
                <input
                  type="text"
                  value={effectiveSlug}
                  onChange={e => { setSlug(slugify(e.target.value)); setSlugDirty(true); }}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-gray-900 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  placeholder="lamorinda-summer-2026"
                  required
                />
              </div>
              <p className="text-xs text-gray-400 mt-1">Auto-generated from name. Edit for a custom URL.</p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700">Description</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                placeholder="Compass draw format. Every player plays 4 matches, one every 2 weeks."
              />
            </div>
          </div>
        </section>

        {/* League type */}
        <section className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
          <h2 className="font-semibold text-lg mb-4 flex items-center gap-2 text-gray-900">
            <GitBranch size={18} className="text-orange-500" />
            League type
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <LeagueTypeOption
              active={leagueType === 'compass'}
              onClick={() => setLeagueType('compass')}
              icon={Compass}
              label="Compass Draw"
              desc="Everyone plays 4 matches (3 for 8-player), no early eliminations. Flights of 16 or 8."
            />
            <LeagueTypeOption
              active={leagueType === 'round_robin'}
              onClick={() => setLeagueType('round_robin')}
              icon={RotateCw}
              label="Round Robin"
              desc="Everyone plays everyone in the flight. Max matches. One flight, any size 2+."
            />
            <LeagueTypeOption
              active={leagueType === 'single_elimination'}
              onClick={() => setLeagueType('single_elimination')}
              icon={Trophy}
              label="Single Elimination"
              desc="Classic knockout — one loss and you're out. Bracket sized to next power of 2."
            />
          </div>
        </section>

        {/* Dates */}
        <section className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
          <h2 className="font-semibold text-lg mb-4 flex items-center gap-2 text-gray-900">
            <Calendar size={18} className="text-orange-500" />
            Schedule
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700">Start date *</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700">End date *</label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700">Registration opens</label>
              <input
                type="datetime-local"
                value={regOpens}
                onChange={e => setRegOpens(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
              <p className="text-xs text-gray-400 mt-1">Leave blank to open immediately.</p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700">Registration closes</label>
              <input
                type="datetime-local"
                value={regCloses}
                onChange={e => setRegCloses(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
              <p className="text-xs text-gray-400 mt-1">Typically a week before start date.</p>
            </div>
          </div>
        </section>

        {/* Categories + fees */}
        <section className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
          <h2 className="font-semibold text-lg mb-4 flex items-center gap-2 text-gray-900">
            <DollarSign size={18} className="text-orange-500" />
            Categories &amp; fees
          </h2>
          <p className="text-sm text-gray-500 mb-1">
            Enable the divisions you want to run. Set each fee independently.
          </p>
          <p className="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded-md px-3 py-2 mb-4">
            <strong>Heads up:</strong> singles fees are charged <strong>per player</strong>, doubles fees are charged <strong>per team</strong> (the captain pays once for both players). If you want each doubles player to pay the same as each singles player, set the doubles fee to 2× the singles fee.
          </p>
          <div className="space-y-3">
            {categories.map(cat => {
              const doubles = isDoubles(cat.key);
              return (
                <div key={cat.key} className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg">
                  <input
                    type="checkbox"
                    checked={cat.enabled}
                    onChange={e => updateCategory(cat.key, { enabled: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-900">{CATEGORY_LABELS[cat.key]}</div>
                    <div className="text-xs text-gray-400">{doubles ? 'Charged per team' : 'Charged per player'}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-gray-400 text-sm">$</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={cat.entry_fee}
                      onChange={e => updateCategory(cat.key, { entry_fee: e.target.value })}
                      disabled={!cat.enabled}
                      className="w-20 px-2 py-1 border border-gray-300 rounded text-sm text-right text-gray-900 disabled:bg-gray-50 disabled:text-gray-400"
                    />
                    <span className="text-xs text-gray-500 whitespace-nowrap ml-1">
                      / {doubles ? 'team' : 'player'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Payment rails */}
        <section className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
          <h2 className="font-semibold text-lg mb-4 flex items-center gap-2 text-gray-900">
            <LinkIcon size={18} className="text-orange-500" />
            Payment options
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            Fill in any rails you want to offer. Players pay off-site — you mark entries paid manually.
            Leave all blank for a free league.
          </p>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700">Venmo handle</label>
              <input
                type="text"
                value={venmo}
                onChange={e => setVenmo(e.target.value)}
                placeholder="@darrin-cohen"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700">Zelle email or phone</label>
              <input
                type="text"
                value={zelle}
                onChange={e => setZelle(e.target.value)}
                placeholder="darrin@example.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700">Stripe Payment Link</label>
              <input
                type="url"
                value={stripeLink}
                onChange={e => setStripeLink(e.target.value)}
                placeholder="https://buy.stripe.com/..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
              <p className="text-xs text-gray-400 mt-1">
                Create in Stripe Dashboard → Payment Links. Paste the full URL here.
              </p>
            </div>
          </div>
        </section>

        {error && (
          <div className="bg-red-50 text-red-700 border border-red-200 rounded-lg p-3 flex items-start gap-2">
            <AlertCircle size={16} className="mt-0.5" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        <div className="flex gap-3">
          <Link
            href="/mixer/leagues"
            className="flex-1 py-2 text-center border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 py-2 bg-orange-500 text-white rounded-lg font-medium hover:bg-orange-600 disabled:opacity-50"
          >
            {saving ? 'Creating...' : 'Create league'}
          </button>
        </div>
      </form>
    </div>
  );
}

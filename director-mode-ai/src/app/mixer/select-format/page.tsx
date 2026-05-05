'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Users,
  Trophy,
  Sparkles,
  Swords,
  Compass,
  CalendarDays,
  DollarSign,
} from 'lucide-react';

type FormatStatus = 'live' | 'coming-soon';

interface FormatOption {
  id: string;
  name: string;
  description: string;
  icon: string;
  paid?: boolean; // shows a "Paid option" badge if Stripe-Connect-backed
  privateOnly?: boolean; // shows "Private only" badge — director adds players manually, no public signup yet
  status?: FormatStatus;
}

export default function SelectFormatPage() {
  const router = useRouter();
  const [aiOpen, setAiOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<{ format: string; reason: string } | null>(null);
  const [aiInput, setAiInput] = useState({ player_count: '', court_count: '', vibe: 'social' });

  const requestAiRecommendation = async () => {
    setAiLoading(true);
    setAiError(null);
    setAiResult(null);
    try {
      const res = await fetch('/api/mixer/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player_count: aiInput.player_count ? parseInt(aiInput.player_count, 10) : undefined,
          court_count: aiInput.court_count ? parseInt(aiInput.court_count, 10) : undefined,
          vibe: aiInput.vibe,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.format) {
        throw new Error(data.error || 'No recommendation returned');
      }
      setAiResult({ format: data.format, reason: data.reason });
    } catch (err: any) {
      setAiError(err.message || 'Failed to get recommendation');
    } finally {
      setAiLoading(false);
    }
  };

  // ============ Bucket 1: Mixers / Socials ============
  // Private events the director sets up day-of. Rotation/social formats —
  // no winner declared, no public signup, no payment.
  const mixerFormats: FormatOption[] = [
    {
      id: 'doubles',
      name: 'Doubles',
      description: '4 players per court. Teams rotate each round for balanced play.',
      icon: '👥',
    },
    {
      id: 'singles',
      name: 'Singles',
      description: '2 players per court. Head-to-head matchups.',
      icon: '🎾',
    },
    {
      id: 'mixed-doubles',
      name: 'Mixed Doubles',
      description: '4 players per court. One male, one female per team.',
      icon: '👫',
    },
    {
      id: 'king-of-court',
      name: 'King of the Court',
      description: 'Winners stay, losers rotate. Continuous play format.',
      icon: '👑',
    },
    {
      id: 'round-robin',
      name: 'Team Round Robin',
      description: 'Fixed teams compete against all other teams.',
      icon: '🔄',
    },
    {
      id: 'maximize-courts',
      name: 'Maximize Courts',
      description: 'Fills all courts optimally with mixed singles/doubles.',
      icon: '⚙️',
    },
  ];

  // ============ Bucket 2: Tournament Formats ============
  // Competitive — winner declared. "Private only" = director adds players
  // manually (no public signup). "Paid option" = Quads-style spine: public
  // signup + Stripe Connect + magic-link scoring + results page.
  const tournamentFormats: FormatOption[] = [
    {
      id: 'quads',
      name: 'Quads',
      description:
        'Flights of 4. Each flight: 3 singles round-robin, then doubles 1+4 vs 2+3.',
      icon: '🎯',
      paid: true,
      status: 'live',
    },
    {
      id: 'single-elimination-singles',
      name: 'Single Elimination — Singles',
      description: 'Traditional bracket. 1v1 matches, win or go home.',
      icon: '🏆',
      privateOnly: true,
      status: 'live',
    },
    {
      id: 'single-elimination-doubles',
      name: 'Single Elimination — Doubles',
      description: 'Traditional bracket. 2v2 team matches, win or go home.',
      icon: '🥇',
      privateOnly: true,
      status: 'live',
    },
    {
      id: 'team-battle',
      name: 'Team Battle',
      description:
        'Two named teams compete across multiple rounds. Flexible singles/doubles mix. Most match wins takes it.',
      icon: '⚔️',
      privateOnly: true,
      status: 'live',
    },
    {
      id: 'feed-in-qf',
      name: 'Feed-In Quarters',
      description:
        'Single-elim with a back-draw — quarter-finalists feed into a consolation bracket. Includes 3rd/4th place playoff.',
      icon: '🏅',
      paid: true,
      status: 'coming-soon',
    },
    {
      id: 'round-robin-tournament',
      name: 'Round Robin Tournament',
      description: 'Everyone plays everyone. Standings by W-L. Public signup version.',
      icon: '🔁',
      paid: true,
      status: 'coming-soon',
    },
  ];

  // ============ Bucket 3: Leagues ============
  // Multi-week recurring formats. Different data model.
  const leagueFormats: FormatOption[] = [
    {
      id: 'compass',
      name: 'Compass Draw',
      description:
        'Every player plays same # of matches. Winners East, losers West. Splits into Compass/Plate/Bowl/Shield brackets.',
      icon: '🧭',
      paid: true,
      status: 'live',
    },
    {
      id: 'rr-league',
      name: 'Round Robin League',
      description: 'Multi-week round-robin. Standings update each week.',
      icon: '📅',
      paid: true,
      status: 'live',
    },
    {
      id: 'single-elim-league',
      name: 'Single-Elim League',
      description: 'Multi-week single-elimination bracket.',
      icon: '🥇',
      paid: true,
      status: 'live',
    },
    {
      id: 'jtt',
      name: 'Junior Team Tennis (JTT)',
      description:
        'Clubs vs clubs. Multiple divisions, weekly matchups, singles + doubles lines per matchup.',
      icon: '🏟️',
      paid: false,
      status: 'live',
    },
  ];

  const handleMixerClick = (formatId: string) => {
    router.push(`/mixer/events/new?format=${formatId}`);
  };

  const handleTournamentClick = (formatId: string, status?: FormatStatus) => {
    if (status === 'coming-soon') return;
    if (formatId === 'quads') {
      router.push('/mixer/quads/new');
      return;
    }
    // Existing single-elim + team-battle live as private events for now;
    // upgrade to public-signup + payment later by routing into the
    // /mixer/tournaments/new flow (when built).
    router.push(`/mixer/events/new?format=${formatId}`);
  };

  const handleLeagueClick = (formatId: string) => {
    if (formatId === 'jtt') {
      router.push('/mixer/leagues/new?type=jtt');
      return;
    }
    router.push(`/mixer/leagues/new?type=${formatId}`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-orange-50">
      <header className="border-b bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <Link
            href="/mixer/home"
            className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft size={18} />
            Back to Events
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        {/* AI helper */}
        <div className="bg-gradient-to-r from-blue-50 to-blue-100 rounded-2xl border-2 border-blue-200 p-6">
          <div className="flex items-center gap-3 mb-2">
            <Sparkles className="text-blue-600" size={24} />
            <h2 className="text-xl font-bold text-gray-900">Need help choosing?</h2>
          </div>
          <p className="text-gray-700 mb-4">
            Tell the AI your player count + courts + vibe and it picks a format.
          </p>
          <button
            type="button"
            onClick={() => setAiOpen((o) => !o)}
            className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 flex items-center justify-center gap-2"
          >
            <Sparkles size={20} />
            {aiOpen ? 'Hide AI helper' : 'Get an AI recommendation'}
          </button>

          {aiOpen && (
            <div className="mt-4 p-4 bg-white rounded-xl border border-blue-200 space-y-3">
              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Players</label>
                  <input
                    type="number"
                    min={2}
                    value={aiInput.player_count}
                    onChange={(e) => setAiInput({ ...aiInput, player_count: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-gray-900"
                    placeholder="e.g. 12"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Courts</label>
                  <input
                    type="number"
                    min={1}
                    value={aiInput.court_count}
                    onChange={(e) => setAiInput({ ...aiInput, court_count: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-gray-900"
                    placeholder="e.g. 3"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Vibe</label>
                  <select
                    value={aiInput.vibe}
                    onChange={(e) => setAiInput({ ...aiInput, vibe: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-gray-900"
                  >
                    <option value="social">Social mixer</option>
                    <option value="competitive">Competitive league</option>
                    <option value="tournament">Tournament / bracket</option>
                  </select>
                </div>
              </div>

              <button
                type="button"
                onClick={requestAiRecommendation}
                disabled={aiLoading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {aiLoading ? 'Thinking...' : 'Recommend a format'}
              </button>

              {aiError && <div className="text-sm text-red-600">{aiError}</div>}

              {aiResult && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="text-sm text-gray-700 mb-2">{aiResult.reason}</div>
                  <button
                    type="button"
                    onClick={() => handleMixerClick(aiResult.format)}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
                  >
                    Use this format →
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ============ Bucket 1: Mixers / Socials ============ */}
        <FormatSection
          icon={<Users className="text-orange-500" size={24} />}
          title="Mixers / Socials"
          subtitle="Casual play, you set up day-of. No public signup, no payment."
          accentColor="orange"
        >
          <div className="grid gap-4 md:grid-cols-2">
            {mixerFormats.map((f) => (
              <FormatCard
                key={f.id}
                format={f}
                onClick={() => handleMixerClick(f.id)}
                accentColor="orange"
              />
            ))}
          </div>
        </FormatSection>

        {/* ============ Bucket 2: Tournament Formats ============ */}
        <FormatSection
          icon={<Trophy className="text-yellow-500" size={24} />}
          title="Tournament Formats"
          subtitle="One-day tournaments with public signup. Free or paid (Stripe Connect). Players self-register, scores via magic-link, live results."
          accentColor="yellow"
        >
          <div className="grid gap-4 md:grid-cols-2">
            {tournamentFormats.map((f) => (
              <FormatCard
                key={f.id}
                format={f}
                onClick={() => handleTournamentClick(f.id, f.status)}
                accentColor="yellow"
              />
            ))}
          </div>
        </FormatSection>

        {/* ============ Bucket 3: Leagues ============ */}
        <FormatSection
          icon={<CalendarDays className="text-emerald-600" size={24} />}
          title="Leagues"
          subtitle="Multi-week recurring competitions. Public signup, weekly matches, ongoing standings."
          accentColor="emerald"
        >
          <div className="grid gap-4 md:grid-cols-2">
            {leagueFormats.map((f) => (
              <FormatCard
                key={f.id}
                format={f}
                onClick={() => handleLeagueClick(f.id)}
                accentColor="emerald"
              />
            ))}
          </div>
        </FormatSection>
      </main>
    </div>
  );
}

// ====================== sub-components ======================

function FormatSection({
  icon,
  title,
  subtitle,
  accentColor,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  accentColor: 'orange' | 'yellow' | 'emerald';
  children: React.ReactNode;
}) {
  const borderColor =
    accentColor === 'orange'
      ? 'border-orange-200'
      : accentColor === 'yellow'
        ? 'border-yellow-200'
        : 'border-emerald-200';

  return (
    <div className={`bg-white rounded-2xl border-2 ${borderColor} p-6`}>
      <div className="flex items-center gap-3 mb-2">
        {icon}
        <h2 className="text-xl font-bold text-gray-900">{title}</h2>
      </div>
      <p className="text-gray-600 mb-6">{subtitle}</p>
      {children}
    </div>
  );
}

function FormatCard({
  format,
  onClick,
  accentColor,
}: {
  format: FormatOption;
  onClick: () => void;
  accentColor: 'orange' | 'yellow' | 'emerald';
}) {
  const isComingSoon = format.status === 'coming-soon';
  const hoverBorder =
    accentColor === 'orange'
      ? 'hover:border-orange-400'
      : accentColor === 'yellow'
        ? 'hover:border-yellow-400'
        : 'hover:border-emerald-400';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isComingSoon}
      className={`p-4 rounded-xl border-2 border-gray-200 text-left transition-all relative ${
        isComingSoon
          ? 'opacity-60 cursor-not-allowed bg-gray-50'
          : `hover:shadow-lg ${hoverBorder} cursor-pointer`
      }`}
    >
      <div className="flex items-start gap-3 mb-2">
        <span className="text-3xl flex-shrink-0">{format.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-lg text-gray-900">{format.name}</h3>
            {format.paid && !isComingSoon && (
              <span
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-[10px] font-semibold"
                title="Director can charge entry fees via Stripe Connect"
              >
                <DollarSign size={10} /> Paid option
              </span>
            )}
            {format.privateOnly && !isComingSoon && (
              <span
                className="px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded-full text-[10px] font-semibold"
                title="Director adds players manually. Public signup + payment coming later."
              >
                Private only
              </span>
            )}
            {isComingSoon && (
              <span className="px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded-full text-[10px] font-semibold">
                Coming soon
              </span>
            )}
          </div>
        </div>
      </div>
      <p className="text-sm text-gray-600">{format.description}</p>
    </button>
  );
}

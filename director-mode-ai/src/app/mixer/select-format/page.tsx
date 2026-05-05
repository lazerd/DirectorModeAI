'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Users,
  Trophy,
  Sparkles,
  CalendarDays,
} from 'lucide-react';

type FormatStatus = 'live' | 'coming-soon';

interface FormatOption {
  id: string;
  name: string;
  description: string;
  icon: string;
  status?: FormatStatus;
}

/** Sub-choice within an expandable Tournament card (e.g. consolation type). */
interface SubChoice {
  id: string;
  name: string;
  description: string;
  status: FormatStatus;
  route?: string; // where to send the user when they click (only required if status='live')
}

/** Top-level tournament draw type. Either has subChoices to expand, OR a directRoute. */
interface TournamentCard {
  id: string;
  name: string;
  description: string;
  icon: string;
  status?: FormatStatus;
  subChoices?: SubChoice[];
  directRoute?: string;
}

export default function SelectFormatPage() {
  const router = useRouter();
  const [aiOpen, setAiOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<{ format: string; reason: string } | null>(null);
  const [aiInput, setAiInput] = useState({ player_count: '', court_count: '', vibe: 'social' });
  const [expandedTournament, setExpandedTournament] = useState<string | null>(null);

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
    {
      id: 'team-battle',
      name: 'Team Battle',
      description:
        'Two named teams compete across rounds. Flexible singles/doubles mix. Most match wins takes it.',
      icon: '⚔️',
    },
  ];

  // ============ Bucket 2: Tournament Formats ============
  // 5 top-level draw types. Singles, Doubles, and Round Robin expand
  // inline to show sub-options. Quads is self-contained. Compass routes
  // to the existing leagues flow which handles singles/doubles internally.
  const tournamentFormats: TournamentCard[] = [
    {
      id: 'singles',
      name: 'Singles',
      description: '1 vs 1 bracket play. Pick your consolation style after.',
      icon: '🎾',
      subChoices: [
        {
          id: 'single-elimination-singles',
          name: 'Single Elimination',
          description: 'Lose once and you\'re out.',
          status: 'live',
          route: '/mixer/events/new?format=single-elimination-singles',
        },
        {
          id: 'fmlc-singles',
          name: 'First-Match Loser Consolation',
          description: 'Only first-round losers get a consolation bracket.',
          status: 'coming-soon',
        },
        {
          id: 'ffic-singles',
          name: 'Full Feed-In Consolation',
          description: 'Every loser feeds into a consolation bracket — everyone plays multiple matches.',
          status: 'coming-soon',
        },
      ],
    },
    {
      id: 'doubles',
      name: 'Doubles',
      description: '2 vs 2 bracket play. Pick your consolation style after.',
      icon: '👥',
      subChoices: [
        {
          id: 'single-elimination-doubles',
          name: 'Single Elimination',
          description: 'Lose once and you\'re out.',
          status: 'live',
          route: '/mixer/events/new?format=single-elimination-doubles',
        },
        {
          id: 'fmlc-doubles',
          name: 'First-Match Loser Consolation',
          description: 'Only first-round losers get a consolation bracket.',
          status: 'coming-soon',
        },
        {
          id: 'ffic-doubles',
          name: 'Full Feed-In Consolation',
          description: 'Every loser feeds into a consolation bracket — everyone plays multiple matches.',
          status: 'coming-soon',
        },
      ],
    },
    {
      id: 'round-robin-tournament',
      name: 'Round Robin',
      description: 'Everyone plays everyone. Standings by W-L. One day.',
      icon: '🔁',
      subChoices: [
        {
          id: 'rr-tournament-singles',
          name: 'Singles RR',
          description: 'Each player plays every other player once.',
          status: 'coming-soon',
        },
        {
          id: 'rr-tournament-doubles',
          name: 'Doubles RR',
          description: 'Each pair plays every other pair once.',
          status: 'coming-soon',
        },
      ],
    },
    {
      id: 'quads',
      name: 'Quads',
      description: 'Flights of 4. Each flight: 3 singles round-robin, then doubles 1+4 vs 2+3.',
      icon: '🎯',
      status: 'live',
      directRoute: '/mixer/quads/new',
    },
    {
      id: 'compass',
      name: 'Compass Draw',
      description:
        'Every player plays the same # of matches over one weekend. Winners East, losers West. Splits into Compass / Plate / Bowl / Shield sub-brackets.',
      icon: '🧭',
      status: 'live',
      directRoute: '/mixer/leagues/new?type=compass',
    },
  ];

  // ============ Bucket 3: Leagues ============
  // Multi-week recurring formats only. (Compass Draw lives in Tournament
  // Formats above — it's a one-event tournament that happens to use the
  // legacy `leagues` data model under the hood.)
  const leagueFormats: FormatOption[] = [
    {
      id: 'rr-league',
      name: 'Round Robin League',
      description: 'Multi-week round-robin. Each week you play a different opponent. Standings update weekly.',
      icon: '📅',
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

  const handleTournamentClick = (card: TournamentCard) => {
    // Card with a direct route (Quads, Compass) — go immediately.
    if (card.directRoute) {
      router.push(card.directRoute);
      return;
    }
    // Card with sub-choices — toggle inline expansion.
    if (card.subChoices) {
      setExpandedTournament((cur) => (cur === card.id ? null : card.id));
      return;
    }
  };

  const handleSubChoiceClick = (sub: SubChoice) => {
    if (sub.status === 'coming-soon' || !sub.route) return;
    router.push(sub.route);
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
          subtitle="One-day tournaments — individual signup to a draw, declared winner. Every format supports public-signup + paid-or-free at creation."
          accentColor="yellow"
        >
          <div className="grid gap-4 md:grid-cols-2">
            {tournamentFormats.map((card) => (
              <TournamentDrawCard
                key={card.id}
                card={card}
                expanded={expandedTournament === card.id}
                onClick={() => handleTournamentClick(card)}
                onSubChoiceClick={handleSubChoiceClick}
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

function TournamentDrawCard({
  card,
  expanded,
  onClick,
  onSubChoiceClick,
}: {
  card: TournamentCard;
  expanded: boolean;
  onClick: () => void;
  onSubChoiceClick: (sub: SubChoice) => void;
}) {
  const hasSubs = card.subChoices && card.subChoices.length > 0;
  return (
    <div
      className={`rounded-xl border-2 transition-all ${
        expanded
          ? 'border-yellow-400 shadow-lg bg-yellow-50/40'
          : 'border-gray-200 hover:border-yellow-400 hover:shadow-lg'
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        className="w-full p-4 text-left"
      >
        <div className="flex items-start gap-3 mb-2">
          <span className="text-3xl flex-shrink-0">{card.icon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-lg text-gray-900">{card.name}</h3>
              {hasSubs && (
                <span className="text-xs text-gray-500">
                  {expanded ? '▾' : '▸'} {card.subChoices!.length} variants
                </span>
              )}
            </div>
          </div>
        </div>
        <p className="text-sm text-gray-600">{card.description}</p>
      </button>

      {expanded && hasSubs && (
        <div className="border-t border-yellow-200 bg-white/60 p-3 space-y-2">
          {card.subChoices!.map((sub) => {
            const isComingSoon = sub.status === 'coming-soon';
            return (
              <button
                key={sub.id}
                type="button"
                onClick={() => onSubChoiceClick(sub)}
                disabled={isComingSoon}
                className={`w-full text-left p-3 rounded-lg border transition-all ${
                  isComingSoon
                    ? 'border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed'
                    : 'border-gray-200 bg-white hover:border-yellow-400 hover:shadow cursor-pointer'
                }`}
              >
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <span className="font-semibold text-gray-900">{sub.name}</span>
                  {isComingSoon && (
                    <span className="px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded-full text-[10px] font-semibold">
                      Coming soon
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-600">{sub.description}</div>
              </button>
            );
          })}
        </div>
      )}
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

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Trophy, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export default async function PublicMatchupPage({
  params,
}: {
  params: Promise<{ slug: string; matchupId: string }>;
}) {
  const { slug, matchupId } = await params;
  const supabase = getSupabaseAdmin();

  const { data: league } = await supabase
    .from('leagues')
    .select('id, name, slug, format, status')
    .eq('slug', slug)
    .maybeSingle();
  if (!league) return notFound();
  const l = league as any;
  if (l.format !== 'team') return notFound();

  const { data: matchup } = await supabase
    .from('league_team_matchups')
    .select('*')
    .eq('id', matchupId)
    .maybeSingle();
  if (!matchup) return notFound();
  const m = matchup as any;

  const [divRes, clubsRes, linesRes, rostersRes] = await Promise.all([
    supabase.from('league_divisions').select('*').eq('id', m.division_id).single(),
    supabase
      .from('league_clubs')
      .select('*')
      .in('id', [m.home_club_id, m.away_club_id]),
    supabase
      .from('league_matchup_lines')
      .select('*')
      .eq('matchup_id', matchupId)
      .order('line_number'),
    supabase
      .from('league_team_rosters')
      .select('id, player_name, club_id, ladder_position')
      .eq('division_id', m.division_id)
      .in('club_id', [m.home_club_id, m.away_club_id]),
  ]);

  const division = (divRes.data as any) || null;
  const clubs = (clubsRes.data as any[]) || [];
  const lines = (linesRes.data as any[]) || [];
  const rosters = (rostersRes.data as any[]) || [];

  const homeClub = clubs.find(c => c.id === m.home_club_id);
  const awayClub = clubs.find(c => c.id === m.away_club_id);
  const rosterName = new Map(rosters.map(r => [r.id, r.player_name]));

  if (!division || !homeClub || !awayClub) return notFound();

  const dateLabel = new Date(m.match_date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const statusLabel = (s: string) =>
    s === 'completed' ? 'Final' :
    s === 'in_progress' ? 'Live' :
    s === 'cancelled' ? 'Cancelled' :
    s === 'postponed' ? 'Postponed' :
    'Scheduled';

  const playerDisplay = (id: string | null): string | null => {
    if (!id) return null;
    return rosterName.get(id) || '—';
  };

  return (
    <div className="min-h-screen bg-[#001820] text-white">
      <header className="border-b border-white/10">
        <div className="max-w-3xl mx-auto px-4 py-5 flex items-center gap-3">
          <Link
            href={`/leagues/${l.slug}`}
            className="p-2 rounded-lg hover:bg-white/10 text-white/70"
          >
            <ArrowLeft size={18} />
          </Link>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-white/40 truncate">{l.name}</div>
            <h1 className="font-display text-lg truncate">
              {awayClub.name} <span className="text-white/40">@</span> {homeClub.name}
            </h1>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6">
        <section className="bg-white/5 border border-white/10 rounded-xl p-5 mb-5">
          <div className="flex items-start gap-2 text-sm text-white/60 mb-1">
            <Calendar size={14} className="mt-0.5 flex-shrink-0" />
            <span>{dateLabel}</span>
          </div>
          <div className="text-xs text-white/40">
            {division.name}
            {division.start_time && ` · ${division.start_time.slice(0, 5)}`}
          </div>

          <div className="mt-4 flex items-center justify-center gap-6">
            <TeamScore
              name={awayClub.name}
              score={m.away_lines_won}
              isWinner={m.winner === 'away'}
              side="Away"
            />
            <span className="text-white/20 text-2xl">—</span>
            <TeamScore
              name={homeClub.name}
              score={m.home_lines_won}
              isWinner={m.winner === 'home'}
              side="Home"
            />
          </div>
          <div className="mt-3 text-center text-xs text-white/50 uppercase tracking-wide">
            {statusLabel(m.status)}
          </div>
        </section>

        {/* Lines */}
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-white/60 mb-3 flex items-center gap-2">
            <Trophy size={14} />
            Lines
          </h2>

          {lines.length === 0 ? (
            <div className="bg-white/5 border border-white/10 rounded-xl p-5 text-sm text-white/60">
              No lines have been generated yet.
            </div>
          ) : (
            <ul className="space-y-2">
              {lines.map(line => {
                const home1 = playerDisplay(line.home_player1_id);
                const home2 = playerDisplay(line.home_player2_id);
                const away1 = playerDisplay(line.away_player1_id);
                const away2 = playerDisplay(line.away_player2_id);
                const homeName = [home1, home2].filter(Boolean).join(' / ') || 'TBD';
                const awayName = [away1, away2].filter(Boolean).join(' / ') || 'TBD';
                const winnerIsHome = line.winner === 'home';
                const winnerIsAway = line.winner === 'away';
                return (
                  <li
                    key={line.id}
                    className="bg-white/5 border border-white/10 rounded-lg p-3"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-white/50 uppercase">
                        Line {line.line_number} · {line.line_type}
                      </span>
                      {line.status === 'completed' && (
                        <span className="text-xs font-medium text-[#D3FB52]">
                          Final
                        </span>
                      )}
                    </div>
                    <div className="space-y-1 text-sm">
                      <div
                        className={`flex items-center gap-2 ${
                          winnerIsAway ? 'text-white font-semibold' : 'text-white/70'
                        }`}
                      >
                        <span className="w-4 flex-shrink-0 text-xs">
                          {winnerIsAway ? '▸' : ''}
                        </span>
                        <span className="flex-1">{awayName}</span>
                        <span className="text-xs text-white/40">
                          {awayClub.short_code}
                        </span>
                      </div>
                      <div
                        className={`flex items-center gap-2 ${
                          winnerIsHome ? 'text-white font-semibold' : 'text-white/70'
                        }`}
                      >
                        <span className="w-4 flex-shrink-0 text-xs">
                          {winnerIsHome ? '▸' : ''}
                        </span>
                        <span className="flex-1">{homeName}</span>
                        <span className="text-xs text-white/40">
                          {homeClub.short_code}
                        </span>
                      </div>
                    </div>
                    {line.score && (
                      <div className="mt-2 pt-2 border-t border-white/10 text-sm text-white/80 font-mono">
                        {line.score}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="text-center text-xs text-white/30 mt-8 py-6 border-t border-white/10">
          <Link href={`/leagues/${l.slug}/standings`} className="text-[#D3FB52] hover:underline">
            League standings →
          </Link>
        </div>
      </main>
    </div>
  );
}

function TeamScore({
  name,
  score,
  isWinner,
  side,
}: {
  name: string;
  score: number;
  isWinner: boolean;
  side: string;
}) {
  return (
    <div className="text-center">
      <div className="text-xs uppercase text-white/40">{side}</div>
      <div
        className={`text-4xl font-bold ${isWinner ? 'text-[#D3FB52]' : 'text-white'}`}
      >
        {score}
      </div>
      <div className="text-xs text-white/70 font-medium mt-1">{name}</div>
    </div>
  );
}

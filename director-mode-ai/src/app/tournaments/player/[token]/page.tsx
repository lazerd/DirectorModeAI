import { notFound } from 'next/navigation';
import { Trophy } from 'lucide-react';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { quadScoringLabel } from '@/lib/quads';
import PlayerScoringList from './PlayerScoringList';

export const dynamic = 'force-dynamic';

export default async function PlayerScoringPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = getSupabaseAdmin();

  const { data: entry } = await supabase
    .from('tournament_entries')
    .select('*')
    .eq('player_token', token)
    .maybeSingle();
  if (!entry) return notFound();
  const e: any = entry;

  const [{ data: ev }, { data: allEntries }, { data: allMatches }] = await Promise.all([
    supabase
      .from('events')
      .select('id, name, slug, event_date, event_scoring_format, match_format')
      .eq('id', e.event_id)
      .maybeSingle(),
    supabase
      .from('tournament_entries')
      .select('id, player_name, partner_name, seed')
      .eq('event_id', e.event_id),
    supabase
      .from('tournament_matches')
      .select('*')
      .eq('event_id', e.event_id)
      .order('round'),
  ]);

  const matchesList = ((allMatches as any[]) || []).filter(
    (m) =>
      m.player1_id === e.id ||
      m.player2_id === e.id ||
      m.player3_id === e.id ||
      m.player4_id === e.id
  );

  const event = ev as any;

  return (
    <div className="min-h-screen bg-[#001820] text-white px-4 py-8">
      <div className="max-w-md mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-[#D3FB52] flex items-center justify-center flex-shrink-0">
            <Trophy size={22} className="text-[#002838]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-white/50 truncate">{event?.name ?? 'Tournament'}</div>
            <h1 className="text-xl font-semibold truncate">{e.player_name}</h1>
            <div className="text-xs text-white/60">
              {e.seed ? `Seed ${e.seed}` : 'Awaiting seed'}
              {e.partner_name && ` · w/ ${e.partner_name}`}
              {event?.event_scoring_format && ` · ${quadScoringLabel(event.event_scoring_format)}`}
            </div>
          </div>
        </div>

        {matchesList.length === 0 ? (
          <div className="bg-white/5 rounded-xl p-6 text-center text-white/70">
            No matches scheduled yet — director hasn't generated the bracket.
          </div>
        ) : (
          <PlayerScoringList
            entryId={e.id}
            entryName={e.player_name}
            matches={matchesList}
            entries={(allEntries as any[]) || []}
          />
        )}

        <div className="mt-6 text-center">
          <a
            href={`/tournaments/${event?.slug}/results`}
            className="text-sm text-white/50 hover:text-white/80"
          >
            See live standings →
          </a>
        </div>
      </div>
    </div>
  );
}

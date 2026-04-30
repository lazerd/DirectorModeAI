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
    .from('quad_entries')
    .select('*')
    .eq('player_token', token)
    .maybeSingle();
  if (!entry) return notFound();
  const e: any = entry;

  const [{ data: ev }, { data: flight }, { data: flightEntries }] = await Promise.all([
    supabase
      .from('events')
      .select('id, name, slug, event_date, event_scoring_format')
      .eq('id', e.event_id)
      .maybeSingle(),
    e.flight_id
      ? supabase
          .from('quad_flights')
          .select('id, name, tier_label')
          .eq('id', e.flight_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    e.flight_id
      ? supabase
          .from('quad_entries')
          .select('id, player_name, flight_seed')
          .eq('flight_id', e.flight_id)
      : Promise.resolve({ data: [] }),
  ]);

  let matches: any[] = [];
  if (e.flight_id) {
    const { data: ms } = await supabase
      .from('quad_matches')
      .select('*')
      .eq('flight_id', e.flight_id)
      .order('round');
    matches = ((ms as any[]) || []).filter(
      (m) =>
        m.player1_id === e.id ||
        m.player2_id === e.id ||
        m.player3_id === e.id ||
        m.player4_id === e.id
    );
  }

  const event = ev as any;
  const flightData = flight as any;

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
              {flightData ? `${flightData.name} · seed ${e.flight_seed}` : 'Awaiting flight assignment'}
              {event?.event_scoring_format && ` · ${quadScoringLabel(event.event_scoring_format)}`}
            </div>
          </div>
        </div>

        {!flightData ? (
          <div className="bg-white/5 rounded-xl p-6 text-center text-white/70">
            You're registered, but flights haven't been generated yet. Check back closer to start
            time.
          </div>
        ) : matches.length === 0 ? (
          <div className="bg-white/5 rounded-xl p-6 text-center text-white/70">
            No matches scheduled yet.
          </div>
        ) : (
          <PlayerScoringList
            entryId={e.id}
            entryName={e.player_name}
            matches={matches}
            flightEntries={(flightEntries as any[]) || []}
          />
        )}

        <div className="mt-6 text-center">
          <a
            href={`/quads/${event?.slug}/results`}
            className="text-sm text-white/50 hover:text-white/80"
          >
            See live standings →
          </a>
        </div>
      </div>
    </div>
  );
}

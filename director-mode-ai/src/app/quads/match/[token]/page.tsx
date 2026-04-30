import { notFound } from 'next/navigation';
import { Trophy } from 'lucide-react';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { quadScoringLabel } from '@/lib/quads';
import ScoreEntryForm from './ScoreEntryForm';

export const dynamic = 'force-dynamic';

export default async function PublicMatchScoringPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = getSupabaseAdmin();

  const { data: match } = await supabase
    .from('quad_matches')
    .select('*')
    .eq('score_token', token)
    .maybeSingle();
  if (!match) return notFound();

  const m = match as any;

  const [{ data: flight }, { data: entries }] = await Promise.all([
    supabase
      .from('quad_flights')
      .select('*, event:events(name, slug, event_scoring_format)')
      .eq('id', m.flight_id)
      .single(),
    supabase
      .from('quad_entries')
      .select('id, player_name')
      .eq('flight_id', m.flight_id),
  ]);

  if (!flight) return notFound();

  const playerById = new Map(((entries as any[]) || []).map((e) => [e.id, e.player_name]));
  const f = flight as any;

  const isDoubles = m.match_type === 'doubles';
  const sideALabel = isDoubles
    ? `${playerById.get(m.player1_id) ?? '?'} + ${playerById.get(m.player2_id) ?? '?'}`
    : playerById.get(m.player1_id) ?? '?';
  const sideBLabel = isDoubles
    ? `${playerById.get(m.player3_id) ?? '?'} + ${playerById.get(m.player4_id) ?? '?'}`
    : playerById.get(m.player3_id) ?? '?';

  return (
    <div className="min-h-screen bg-[#001820] text-white px-4 py-12">
      <div className="max-w-md mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-[#D3FB52] flex items-center justify-center">
            <Trophy size={22} className="text-[#002838]" />
          </div>
          <div>
            <div className="text-xs text-white/50">{f.event.name}</div>
            <h1 className="text-xl font-semibold">
              {f.name} · {isDoubles ? 'Round 4 Doubles' : `Round ${m.round} Singles`}
            </h1>
          </div>
        </div>

        <div className="bg-white/5 rounded-xl p-4 mb-4 text-sm">
          <div className="text-white/60 mb-1">
            Scoring: {quadScoringLabel(f.event.event_scoring_format)}
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div className="bg-white/5 rounded-lg p-3 text-center">
              <div className="text-xs text-white/50 mb-1">Side A</div>
              <div className="font-semibold">{sideALabel}</div>
            </div>
            <div className="bg-white/5 rounded-lg p-3 text-center">
              <div className="text-xs text-white/50 mb-1">Side B</div>
              <div className="font-semibold">{sideBLabel}</div>
            </div>
          </div>
        </div>

        <div className="bg-white text-gray-900 rounded-2xl p-5">
          {m.status === 'completed' ? (
            <div className="text-center space-y-3">
              <p className="text-sm text-emerald-700 bg-emerald-50 rounded-lg p-3">
                ✓ Score reported: {m.score} ({m.winner_side === 'a' ? sideALabel : sideBLabel} won)
              </p>
              <ScoreEntryForm
                token={token}
                sideA={sideALabel}
                sideB={sideBLabel}
                initialScore={m.score}
                initialWinner={m.winner_side}
                allowEdit
              />
            </div>
          ) : (
            <ScoreEntryForm token={token} sideA={sideALabel} sideB={sideBLabel} />
          )}
        </div>
      </div>
    </div>
  );
}

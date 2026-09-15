'use client';

/**
 * WildCardPanel — the director's one-button schedule for a Wild Card.
 *
 * Replaces the per-round "Generate / Shuffle Pairings" controls on the Rounds
 * tab for this format. The director picks mixed or open and how many rounds,
 * sees what the checked-in roster will do on the courts they have, and builds
 * the whole morning at once. Re-shuffle draws a new seed for every round that
 * hasn't started; anything already played or scored stays put.
 *
 * Printing and the players' phone view are one tap away, because the printed
 * sheet on the board is how most of the players will find their court.
 */

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Printer, Shuffle, Smartphone, Sparkles } from 'lucide-react';
import { newWildCardSeed, planWildCardRound, rowsToWildCardRound, wildCardStats, type WildCardMode } from '@/lib/wildCard';
import { buildWildCardSchedule } from '@/lib/wildCardSchedule';

interface Props {
  event: {
    id: string;
    num_courts: number;
    court_names?: string[] | null;
    event_code?: string;
  };
  /** Rounds currently on the event — the panel re-reads after any change. */
  roundCount: number;
  onChanged: () => void;
}

export default function WildCardPanel({ event, roundCount, onChanged }: Props) {
  const { toast } = useToast();
  const [mode, setMode] = useState<WildCardMode>('mixed');
  const [totalRounds, setTotalRounds] = useState(3);
  const [seed, setSeed] = useState<number | null>(null);
  const [counts, setCounts] = useState({ men: 0, women: 0, other: 0 });
  const [quality, setQuality] = useState<ReturnType<typeof wildCardStats> | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: ev }, { data: eps }, { data: rounds }] = await Promise.all([
      supabase.from('events').select('wild_card_mode, wild_card_rounds, wild_card_seed, event_code').eq('id', event.id).maybeSingle(),
      supabase.from('event_players').select('player_id, players(gender)').eq('event_id', event.id).eq('active', true),
      supabase.from('rounds').select('id, round_number').eq('event_id', event.id).order('round_number'),
    ]);
    if (ev) {
      if (ev.wild_card_mode === 'mixed' || ev.wild_card_mode === 'open') setMode(ev.wild_card_mode);
      if (ev.wild_card_rounds) setTotalRounds(ev.wild_card_rounds);
      setSeed(ev.wild_card_seed ?? null);
    }
    const c = { men: 0, women: 0, other: 0 };
    ((eps as any[]) || []).forEach((ep) => {
      const g = ep.players?.gender;
      if (g === 'male') c.men++;
      else if (g === 'female') c.women++;
      else c.other++;
    });
    setCounts(c);

    const ids = ((rounds as any[]) || []).map((r) => r.id);
    if (ids.length === 0) {
      setQuality(null);
      return;
    }
    const { data: matches } = await supabase
      .from('matches')
      .select('round_id, court_number, player1_id, player2_id, player3_id, player4_id')
      .in('round_id', ids);
    setQuality(
      wildCardStats(ids.map((id) => rowsToWildCardRound(((matches as any[]) || []).filter((m) => m.round_id === id)))),
    );
  }, [event.id]);

  useEffect(() => {
    load();
  }, [load, roundCount]);

  const build = async (reshuffle: boolean) => {
    if (reshuffle && !confirm('Re-shuffle every round that hasn\'t started? Rounds already played or scored are kept.')) return;
    setBusy(true);
    try {
      const nextSeed = newWildCardSeed();
      const result = await buildWildCardSchedule(supabase, event, { mode, totalRounds, seed: nextSeed });
      setSeed(nextSeed);
      toast({
        title: reshuffle ? 'Re-shuffled' : 'Wild Card schedule built',
        description:
          `${result.built} round${result.built === 1 ? '' : 's'} for ${result.players} players` +
          (result.locked ? ` · ${result.locked} played round${result.locked === 1 ? '' : 's'} kept` : '') +
          ` · ${result.stats.repeatPartners} repeat partner${result.stats.repeatPartners === 1 ? '' : 's'}`,
      });
      onChanged();
      load();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Could not build the schedule', description: err?.message || String(err) });
    } finally {
      setBusy(false);
    }
  };

  // Unknown-gender players fill the short side, same as the generator.
  let men = counts.men;
  let women = counts.women;
  for (let i = 0; i < counts.other; i++) {
    if (women < men) women++;
    else men++;
  }
  const plan = planWildCardRound(men, women, event.num_courts, mode);
  const total = counts.men + counts.women + counts.other;
  const courtsUsed = plan.mixedCourts + plan.openCourts;
  const code = event.event_code;
  const sitRange = quality ? Object.values(quality.sitOuts) : [];

  return (
    <Card className="bg-white border-2 border-amber-300">
      <CardHeader>
        <CardTitle className="flex items-center gap-2" style={{ color: '#111827' }}>
          <Sparkles className="h-5 w-5 text-amber-500" />
          Wild Card: rotating partners
        </CardTitle>
        <CardDescription className="text-gray-600">
          New partner and new opponents every round, courts and sit-outs drawn for you. The winner is the player with the most games.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-sm font-medium text-gray-700">Partners</p>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['mixed', 'Mixed', 'One man + one woman per team'],
                  ['open', 'Open', 'Anyone with anyone'],
                ] as const
              ).map(([value, label, hint]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  className={`rounded-xl border-2 p-3 text-left ${mode === value ? 'border-amber-500 bg-amber-50' : 'border-gray-200 bg-white'}`}
                >
                  <div className="font-semibold text-gray-900">{label}</div>
                  <div className="text-xs text-gray-600">{hint}</div>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="wc-rounds" className="mb-1 block text-sm font-medium text-gray-700">
              Rounds
            </label>
            <input
              id="wc-rounds"
              type="number"
              min={1}
              max={12}
              value={totalRounds}
              onChange={(e) => setTotalRounds(Math.max(1, Math.min(12, parseInt(e.target.value, 10) || 1)))}
              className="h-12 w-full rounded-xl border-2 border-gray-200 px-3 text-lg text-gray-900"
            />
          </div>
        </div>

        <div className="rounded-xl bg-gray-50 p-3 text-sm text-gray-800">
          <span className="font-semibold">
            {total} checked in
            {mode === 'mixed' ? ` (${counts.men} men, ${counts.women} women${counts.other ? `, ${counts.other} not set` : ''})` : ''}
          </span>
          {' → '}
          {total < 4 ? (
            'check in at least 4 to build.'
          ) : (
            <>
              {courtsUsed} of {event.num_courts} court{event.num_courts === 1 ? '' : 's'} each round
              {plan.openCourts > 0 && mode === 'mixed' ? ` (${plan.openCourts} open court${plan.openCourts === 1 ? '' : 's'} for the extra players)` : ''}
              {plan.sitOuts > 0 ? `, ${plan.sitOuts} sit out per round (rotated)` : ', nobody sits out'}.
            </>
          )}
        </div>

        {quality && roundCount > 0 && (
          <p className="text-sm text-gray-700">
            Current schedule: <span className="font-semibold">{quality.repeatPartners} repeat partners</span> ·{' '}
            {quality.repeatOpponents} repeat opponents
            {sitRange.length > 0 && ` · sit-outs ${Math.min(...sitRange)}–${Math.max(...sitRange)} per sitting player`}
            {quality.backToBackSitOuts > 0 && ` · ${quality.backToBackSitOuts} back-to-back sit-outs`}
            {seed ? <span className="text-gray-400"> · draw #{seed}</span> : null}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {roundCount === 0 ? (
            <Button size="lg" onClick={() => build(false)} disabled={busy || total < 4} className="bg-amber-500 hover:bg-amber-600 text-white">
              <Sparkles className="mr-2 h-5 w-5" />
              {busy ? 'Building…' : `Build ${totalRounds} rounds`}
            </Button>
          ) : (
            <Button size="lg" variant="outline" onClick={() => build(true)} disabled={busy || total < 4} className="bg-white" style={{ color: '#111827' }}>
              <Shuffle className="mr-2 h-5 w-5" />
              {busy ? 'Shuffling…' : 'Re-shuffle'}
            </Button>
          )}
          {code && roundCount > 0 && (
            <>
              <a href={`/event/${code}/print`} target="_blank" rel="noreferrer">
                <Button size="lg" variant="outline" className="bg-white" style={{ color: '#111827' }}>
                  <Printer className="mr-2 h-5 w-5" />
                  Print round sheets
                </Button>
              </a>
              <a href={`/event/${code}`} target="_blank" rel="noreferrer">
                <Button size="lg" variant="outline" className="bg-white" style={{ color: '#111827' }}>
                  <Smartphone className="mr-2 h-5 w-5" />
                  Players&apos; phone view
                </Button>
              </a>
            </>
          )}
        </div>
        {roundCount > 0 && (
          <p className="text-xs text-gray-500">
            Changed the number of rounds or who&apos;s here? Re-shuffle rebuilds every round that hasn&apos;t started to match.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

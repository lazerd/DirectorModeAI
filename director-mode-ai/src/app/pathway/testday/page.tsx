'use client';

/**
 * Test Day runner — the courtside tool.
 *
 * Pick a ball color. Every kid at that level shows their NEXT stripe with its
 * three tests as big tap targets. Tap = passed (persists immediately, so a kid
 * who clears 2 of 3 keeps them and retests one next month). Third tap awards
 * the stripe on the spot with a "hand out the band" moment, and the card
 * advances to the kid's next stripe.
 *
 * Built for a phone held in one hand on a tennis court.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Loader2, PartyPopper } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  LEVELS,
  LEVEL_BY_KEY,
  nextLevel,
  type LevelKey,
} from '@/lib/pathway/curriculum';

type Player = { id: string; name: string; level: LevelKey; enrolled: boolean };
type Award = { player_id: string; stripe_key: string };
type TestCheck = { player_id: string; stripe_key: string; test_index: number };

const todayPT = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());

export default function TestDayPage() {
  const router = useRouter();
  const [levelKey, setLevelKey] = useState<LevelKey>('red');
  const [players, setPlayers] = useState<Player[]>([]);
  const [awards, setAwards] = useState<Award[]>([]);
  const [checks, setChecks] = useState<TestCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [justEarned, setJustEarned] = useState<string | null>(null); // player id
  const [infoKey, setInfoKey] = useState<string | null>(null); // `${playerId}:${stripeKey}:${testIndex}`

  const load = useCallback(async () => {
    const [{ data: ps }, { data: aw }, { data: ch }] = await Promise.all([
      supabase.from('pathway_players').select('id, name, level, enrolled').eq('active', true).order('name'),
      supabase.from('pathway_awards').select('player_id, stripe_key'),
      supabase.from('pathway_test_checks').select('player_id, stripe_key, test_index'),
    ]);
    setPlayers((ps as Player[]) || []);
    setAwards((aw as Award[]) || []);
    setChecks((ch as TestCheck[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      await load();
    })();
  }, [router, load]);

  const level = LEVEL_BY_KEY[levelKey];
  const kids = useMemo(
    () => players.filter((p) => p.level === levelKey),
    [players, levelKey],
  );
  const awardSet = useMemo(() => new Set(awards.map((a) => `${a.player_id}:${a.stripe_key}`)), [awards]);
  const checkSet = useMemo(
    () => new Set(checks.map((c) => `${c.player_id}:${c.stripe_key}:${c.test_index}`)),
    [checks],
  );

  async function toggleTest(p: Player, stripeKey: string, testIndex: number, has: boolean) {
    // optimistic: flip locally first — courtside taps must feel instant
    if (has) {
      setChecks((cs) => cs.filter((c) => !(c.player_id === p.id && c.stripe_key === stripeKey && c.test_index === testIndex)));
      await supabase
        .from('pathway_test_checks')
        .delete()
        .eq('player_id', p.id)
        .eq('stripe_key', stripeKey)
        .eq('test_index', testIndex);
    } else {
      setChecks((cs) => [...cs, { player_id: p.id, stripe_key: stripeKey, test_index: testIndex }]);
      await supabase.from('pathway_test_checks').insert({
        player_id: p.id,
        stripe_key: stripeKey,
        test_index: testIndex,
        passed_on: todayPT(),
        passed_by: 'director',
      });
      // third test just passed? award the stripe.
      const nowDone = [0, 1, 2].every(
        (i) => i === testIndex || checkSet.has(`${p.id}:${stripeKey}:${i}`),
      );
      if (nowDone && !awardSet.has(`${p.id}:${stripeKey}`)) {
        await supabase.from('pathway_awards').insert({
          player_id: p.id,
          stripe_key: stripeKey,
          awarded_on: todayPT(),
          awarded_by: 'director',
        });
        setJustEarned(p.id);
        setTimeout(() => setJustEarned(null), 3500);
      }
    }
    await load();
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-yellow-400" size={32} />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-8 pb-24">
      <div className="max-w-2xl mx-auto">
        <Link href="/pathway" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white mb-3">
          <ArrowLeft size={14} /> Pathway board
        </Link>
        <h1 className="text-2xl font-bold mb-1">Test Day</h1>
        <p className="text-sm text-gray-400 mb-5">
          Tap each test a kid passes — the third tap awards the string. Partial passes are saved
          for next month. Eligibility: 3 of 4 classes attended + registered for next month.
        </p>

        {/* level picker */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
          {LEVELS.filter((l) => !l.invitational).map((l) => {
            const n = players.filter((p) => p.level === l.key).length;
            return (
              <button
                key={l.key}
                onClick={() => setLevelKey(l.key)}
                className={`flex-shrink-0 px-4 py-2.5 rounded-xl text-sm font-bold border transition-colors ${
                  levelKey === l.key ? 'border-white/60 bg-white/10' : 'border-white/10 bg-white/[.03]'
                }`}
              >
                <span className="inline-block w-2.5 h-2.5 rounded-full mr-2" style={{ background: l.color }} />
                {l.name} <span className="text-gray-500 font-normal">({n})</span>
              </button>
            );
          })}
        </div>

        {kids.length === 0 ? (
          <p className="text-gray-500">No players at {level.name}.</p>
        ) : (
          <div className="space-y-4">
            {kids.map((p) => {
              const earnedKeys = awards.filter((a) => a.player_id === p.id).map((a) => a.stripe_key);
              const next = level.stripes.find((st) => !earnedKeys.includes(st.key)) ?? null;
              const celebrating = justEarned === p.id;
              if (!next) {
                const nl = nextLevel(p.level);
                return (
                  <div key={p.id} className="rounded-2xl border border-yellow-400/50 bg-yellow-400/10 p-5">
                    <p className="font-bold text-lg">{p.name}</p>
                    <p className="text-sm text-yellow-300 mt-1">
                      All 5 strings earned — promote to {nl?.name} from the Pathway board. 🎉
                    </p>
                  </div>
                );
              }
              return (
                <div
                  key={p.id}
                  className={`rounded-2xl border p-5 transition-all ${
                    celebrating
                      ? 'border-yellow-400 bg-yellow-400/15 scale-[1.01]'
                      : 'border-white/10 bg-white/[.03]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <p className="font-bold text-lg">{p.name}</p>
                    {!p.enrolled && (
                      <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300">
                        not registered — ineligible
                      </span>
                    )}
                  </div>
                  {celebrating ? (
                    <div className="flex items-center gap-2 py-6 justify-center text-yellow-300">
                      <PartyPopper size={22} />
                      <span className="font-bold text-lg">
                        String earned — tie it on the racquet!
                      </span>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm mb-3">
                        <span className="font-semibold" style={{ color: level.color }}>
                          String {next.number} — {next.title}
                        </span>
                        {next.promotes && (
                          <span className="text-yellow-400 font-semibold"> · promotion string ★</span>
                        )}
                      </p>
                      <div className="space-y-2">
                        {next.tests.map((t, i) => {
                          const has = checkSet.has(`${p.id}:${next.key}:${i}`);
                          return (
                            <div key={i} className="space-y-1.5">
                            <button
                              onClick={() => toggleTest(p, next.key, i, has)}
                              className={`w-full flex items-center gap-3 rounded-xl px-4 py-3.5 text-left border transition-colors ${
                                has
                                  ? 'border-transparent'
                                  : 'border-white/10 bg-white/[.03] active:bg-white/10'
                              }`}
                              style={has ? { background: `${level.color}2e` } : undefined}
                            >
                              <span
                                className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center font-bold"
                                style={{
                                  background: has ? level.color : 'transparent',
                                  border: `2px solid ${has ? level.color : 'rgba(255,255,255,.3)'}`,
                                  color: has ? '#111' : 'rgba(255,255,255,.6)',
                                }}
                              >
                                {has ? <Check size={15} strokeWidth={3.5} /> : i + 1}
                              </span>
                              <span className={`flex-1 text-[15px] leading-snug ${has ? 'text-white' : 'text-gray-300'}`}>
                                {t.label}
                              </span>
                              <span
                                role="button"
                                tabIndex={0}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setInfoKey(infoKey === `${p.id}:${next.key}:${i}` ? null : `${p.id}:${next.key}:${i}`);
                                }}
                                className="flex-shrink-0 w-6 h-6 rounded-full bg-white/10 text-gray-400 text-[11px] font-bold flex items-center justify-center hover:bg-white/20"
                              >
                                ?
                              </span>
                            </button>
                              {infoKey === `${p.id}:${next.key}:${i}` && (
                                <div className="rounded-lg bg-white/[.06] border border-white/10 px-3.5 py-2.5 space-y-1.5 text-[12.5px] leading-snug">
                                  <p><span className="font-extrabold text-[9px] tracking-widest uppercase mr-1.5" style={{ color: level.color }}>How</span><span className="text-gray-300">{t.how}</span></p>
                                  <p><span className="font-extrabold text-[9px] tracking-widest uppercase mr-1.5" style={{ color: level.color }}>Pass</span><span className="text-gray-300">{t.pass}</span></p>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

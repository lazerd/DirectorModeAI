'use client';

/**
 * The coach packet — print-ready Test Day sheets.
 *
 * One page per ball color: the roster, each kid's NEXT stripe with its three
 * tests and empty checkboxes, the eligibility rules, and the coach's Test Day
 * script. Print it, clip it to the ball cart, hand it to the coach. The
 * director enters results into /pathway/testday afterwards (or live).
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Printer } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { LEVELS, HOUSE_RULES, type LevelKey } from '@/lib/pathway/curriculum';

type Player = { id: string; name: string; level: LevelKey; enrolled: boolean };
type Award = { player_id: string; stripe_key: string };
type TestCheck = { player_id: string; stripe_key: string; test_index: number };

const monthPT = () =>
  new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'long', year: 'numeric' });

export default function PathwayPrintPage() {
  const router = useRouter();
  const [players, setPlayers] = useState<Player[]>([]);
  const [awards, setAwards] = useState<Award[]>([]);
  const [checks, setChecks] = useState<TestCheck[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      const [{ data: ps }, { data: aw }, { data: ch }] = await Promise.all([
        supabase.from('pathway_players').select('id, name, level, enrolled').eq('active', true).eq('enrolled', true).order('name'),
        supabase.from('pathway_awards').select('player_id, stripe_key'),
        supabase.from('pathway_test_checks').select('player_id, stripe_key, test_index'),
      ]);
      setPlayers((ps as Player[]) || []);
      setAwards((aw as Award[]) || []);
      setChecks((ch as TestCheck[]) || []);
      setLoading(false);
    })();
  }, [router]);

  const checkSet = useMemo(
    () => new Set(checks.map((c) => `${c.player_id}:${c.stripe_key}:${c.test_index}`)),
    [checks],
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-yellow-400" size={32} />
      </div>
    );
  }

  return (
    <>
      {/* screen-only controls */}
      <div className="print:hidden p-6 max-w-3xl mx-auto">
        <Link href="/pathway" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white">
          <ArrowLeft size={14} /> Pathway board
        </Link>
        <div className="flex items-center justify-between mt-2 mb-4">
          <div>
            <h1 className="text-2xl font-bold">Coach packet — {monthPT()}</h1>
            <p className="text-sm text-gray-400">
              One sheet per ball color: each kid&apos;s next string with its three tests. Print it and
              clip it to the ball cart.
            </p>
          </div>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-yellow-400 text-gray-900 text-sm font-semibold hover:bg-yellow-300"
          >
            <Printer size={15} /> Print
          </button>
        </div>
      </div>

      {/* the packet — white on purpose, this is paper */}
      <div className="bg-white text-black print:bg-white" style={{ colorScheme: 'light' }}>
        {LEVELS.filter((l) => !l.invitational).map((lvl) => {
          const kids = players.filter((p) => p.level === lvl.key);
          if (kids.length === 0) return null;
          return (
            <section
              key={lvl.key}
              className="max-w-3xl mx-auto px-8 py-8 border-t border-gray-300"
              style={{ breakAfter: 'page' }}
            >
              <div className="flex items-baseline justify-between border-b-4 pb-2 mb-4" style={{ borderColor: lvl.color }}>
                <h2 className="text-2xl font-extrabold" style={{ fontFamily: '"Barlow Condensed", sans-serif' }}>
                  {lvl.name.toUpperCase()} — TEST DAY
                </h2>
                <span className="text-sm font-semibold text-gray-600">{monthPT()} · Sleepy Hollow Junior Pathway</span>
              </div>

              <p className="text-[13px] text-gray-700 mb-4">
                <strong>Coach:</strong> post this at the first class of the month, coach toward it
                all month, run the tests in the final 15 minutes of the LAST class with parents
                watching. Check what each kid passes; results go into the app the same day. A test
                already marked ✓ was passed at an earlier Test Day — do not retest it.
              </p>

              <table className="w-full text-[13px] border-collapse">
                <thead>
                  <tr className="border-b-2 border-gray-800 text-left">
                    <th className="py-1.5 pr-3 w-44">Player</th>
                    <th className="py-1.5 pr-3 w-40">Next string</th>
                    <th className="py-1.5">Tests (check what passes)</th>
                  </tr>
                </thead>
                <tbody>
                  {kids.map((p) => {
                    const earnedKeys = awards.filter((a) => a.player_id === p.id).map((a) => a.stripe_key);
                    const next = lvl.stripes.find((st) => !earnedKeys.includes(st.key)) ?? null;
                    return (
                      <tr key={p.id} className="border-b border-gray-300 align-top">
                        <td className="py-2.5 pr-3 font-bold">{p.name}</td>
                        {next ? (
                          <>
                            <td className="py-2.5 pr-3">
                              <span className="font-semibold">
                                {next.number}. {next.title}
                              </span>
                              {next.promotes && (
                                <span className="block text-[11px] font-bold" style={{ color: lvl.colorDark }}>
                                  ★ PROMOTION STRING
                                </span>
                              )}
                            </td>
                            <td className="py-2.5">
                              {next.tests.map((t, i) => {
                                const done = checkSet.has(`${p.id}:${next.key}:${i}`);
                                return (
                                  <div key={i} className="flex items-start gap-2 mb-1">
                                    <span
                                      className="mt-[1px] inline-flex w-4 h-4 border-2 border-gray-700 rounded-sm flex-shrink-0 items-center justify-center text-[10px] font-bold"
                                      style={done ? { background: lvl.color, borderColor: lvl.color, color: '#fff' } : undefined}
                                    >
                                      {done ? '✓' : ''}
                                    </span>
                                    <span className={done ? 'line-through text-gray-400' : ''}>{t}</span>
                                  </div>
                                );
                              })}
                            </td>
                          </>
                        ) : (
                          <td colSpan={2} className="py-2.5 font-semibold" style={{ color: lvl.colorDark }}>
                            All 5 strings earned — promotion ceremony. Announce it.
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="mt-4 text-[11px] text-gray-600 leading-relaxed">
                <strong>Eligibility:</strong> attended 3 of this month&apos;s 4 classes · registered for
                next month. <strong>House rules:</strong> {HOUSE_RULES[3]} <strong>Script for the
                band moment:</strong> &ldquo;[Name] earned [string title] — that&apos;s string [n] of 5 on
                the way to [next color]. Band goes on the racquet.&rdquo; Say it loud, in front of the
                parents.
              </div>
            </section>
          );
        })}
      </div>

      <style jsx global>{`
        @media print {
          body { background: #fff !important; padding-left: 0 !important; }
          nav, aside, header[class*='fixed'] { display: none !important; }
        }
      `}</style>
    </>
  );
}

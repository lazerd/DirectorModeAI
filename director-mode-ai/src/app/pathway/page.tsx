'use client';

/**
 * PathwayMode — director dashboard for the Junior Pathway.
 *
 * The board is the roster grouped by ball color. Click a kid to open the
 * award panel: tap a stripe to award it (today, PT), tap again to take it
 * back, promote when all five are earned, copy the family magic link.
 * Director-only: RLS scopes every row to auth.uid().
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Copy,
  Loader2,
  Mountain,
  Plus,
  Printer,
  Search,
  UserX,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  LEVELS,
  LEVEL_BY_KEY,
  nextLevel,
  stripesInLevel,
  type LevelKey,
} from '@/lib/pathway/curriculum';

type Player = {
  id: string;
  name: string;
  level: LevelKey;
  family_token: string;
  family_email: string | null;
  enrolled: boolean;
  active: boolean;
  notes: string | null;
};
type Award = { player_id: string; stripe_key: string; awarded_on: string };
type TestCheck = { player_id: string; stripe_key: string; test_index: number };

const todayPT = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());

export default function PathwayDashboard() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [awards, setAwards] = useState<Award[]>([]);
  const [checks, setChecks] = useState<TestCheck[]>([]);
  const [openTests, setOpenTests] = useState<string | null>(null); // `${playerId}:${stripeKey}`
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const [addLevel, setAddLevel] = useState<LevelKey>('red');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: rows } = await supabase
      .from('pathway_players')
      .select('*')
      .eq('active', true)
      .order('name');
    const ps = (rows as Player[]) || [];
    setPlayers(ps);
    if (ps.length) {
      const [{ data: aw }, { data: ch }] = await Promise.all([
        supabase.from('pathway_awards').select('player_id, stripe_key, awarded_on'),
        supabase.from('pathway_test_checks').select('player_id, stripe_key, test_index'),
      ]);
      setAwards((aw as Award[]) || []);
      setChecks((ch as TestCheck[]) || []);
    } else {
      setAwards([]);
      setChecks([]);
    }
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
      setUserId(user.id);
      await load();
    })();
  }, [router, load]);

  const awardsByPlayer = useMemo(() => {
    const m: Record<string, Award[]> = {};
    for (const a of awards) (m[a.player_id] ||= []).push(a);
    return m;
  }, [awards]);

  const checkSet = useMemo(
    () => new Set(checks.map((c) => `${c.player_id}:${c.stripe_key}:${c.test_index}`)),
    [checks],
  );

  const filtered = useMemo(
    () => players.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())),
    [players, q],
  );

  const stripesThisMonth = useMemo(() => {
    const ym = todayPT().slice(0, 7);
    return awards.filter((a) => a.awarded_on.startsWith(ym)).length;
  }, [awards]);

  async function toggleStripe(p: Player, stripeKey: string, has: boolean) {
    setBusy(true);
    if (has) {
      // taking a stripe back also clears its three test checks
      await Promise.all([
        supabase.from('pathway_awards').delete().eq('player_id', p.id).eq('stripe_key', stripeKey),
        supabase.from('pathway_test_checks').delete().eq('player_id', p.id).eq('stripe_key', stripeKey),
      ]);
    } else {
      // awarding a whole stripe marks all three tests passed
      await supabase.from('pathway_awards').insert({
        player_id: p.id,
        stripe_key: stripeKey,
        awarded_on: todayPT(),
        awarded_by: 'director',
      });
      await supabase.from('pathway_test_checks').upsert(
        [0, 1, 2].map((i) => ({
          player_id: p.id,
          stripe_key: stripeKey,
          test_index: i,
          passed_on: todayPT(),
          passed_by: 'director',
        })),
        { onConflict: 'player_id,stripe_key,test_index' },
      );
    }
    await load();
    setBusy(false);
  }

  async function toggleTest(p: Player, stripeKey: string, testIndex: number, has: boolean) {
    setBusy(true);
    if (has) {
      await supabase
        .from('pathway_test_checks')
        .delete()
        .eq('player_id', p.id)
        .eq('stripe_key', stripeKey)
        .eq('test_index', testIndex);
    } else {
      await supabase.from('pathway_test_checks').insert({
        player_id: p.id,
        stripe_key: stripeKey,
        test_index: testIndex,
        passed_on: todayPT(),
        passed_by: 'director',
      });
      const done = [0, 1, 2].every(
        (i) => i === testIndex || checkSet.has(`${p.id}:${stripeKey}:${i}`),
      );
      if (done) {
        await supabase.from('pathway_awards').upsert(
          { player_id: p.id, stripe_key: stripeKey, awarded_on: todayPT(), awarded_by: 'director' },
          { onConflict: 'player_id,stripe_key' },
        );
      }
    }
    await load();
    setBusy(false);
  }

  async function promote(p: Player) {
    const nl = nextLevel(p.level);
    if (!nl) return;
    setBusy(true);
    await supabase.from('pathway_players').update({ level: nl.key }).eq('id', p.id);
    await load();
    setBusy(false);
  }

  async function deactivate(p: Player) {
    if (!confirm(`Remove ${p.name} from the Pathway? Their history is kept.`)) return;
    setBusy(true);
    await supabase.from('pathway_players').update({ active: false }).eq('id', p.id);
    setOpenId(null);
    await load();
    setBusy(false);
  }

  async function addPlayer() {
    if (!addName.trim() || !userId) return;
    setBusy(true);
    await supabase.from('pathway_players').insert({
      director_id: userId,
      name: addName.trim(),
      level: addLevel,
    });
    setAddName('');
    setShowAdd(false);
    await load();
    setBusy(false);
  }

  function copyLink(p: Player) {
    const url = `${window.location.origin}/pathway/p/${p.family_token}`;
    navigator.clipboard.writeText(url);
    setCopied(p.id);
    setTimeout(() => setCopied(null), 1500);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-yellow-400" size={32} />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6 md:p-10">
      <div className="max-w-6xl mx-auto">
        {/* header */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white mb-2"
            >
              <ArrowLeft size={14} /> Home
            </Link>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Mountain className="text-yellow-400" size={30} />
              PathwayMode
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              The Junior Pathway · {players.length} players ·{' '}
              <span className="text-yellow-400">{stripesThisMonth} strings this month</span>
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Link
              href="/pathway/testday"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/10 text-sm font-semibold hover:bg-white/15"
            >
              <ClipboardCheck size={15} /> Run Test Day
            </Link>
            <Link
              href="/pathway/print"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/10 text-sm font-semibold hover:bg-white/15"
            >
              <Printer size={15} /> Coach packet
            </Link>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Find a player…"
                className="pl-9 pr-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm w-52"
                style={{ color: '#fff' }}
              />
            </div>
            <button
              onClick={() => setShowAdd(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-yellow-400 text-gray-900 text-sm font-semibold hover:bg-yellow-300"
            >
              <Plus size={16} /> Add player
            </button>
          </div>
        </div>

        {/* level boards */}
        <div className="space-y-8">
          {[...LEVELS].sort((a, b) => b.order - a.order).map((lvl) => {
            const kids = filtered.filter((p) => p.level === lvl.key);
            return (
              <section key={lvl.key}>
                <div className="flex items-center gap-2.5 mb-3">
                  <span className="w-3.5 h-3.5 rounded-full" style={{ background: lvl.color }} />
                  <h2 className="text-lg font-bold">{lvl.name}</h2>
                  <span className="text-sm text-gray-500">
                    {kids.length} player{kids.length === 1 ? '' : 's'}
                    {lvl.invitational && ' · by invitation'}
                  </span>
                </div>
                {kids.length === 0 ? (
                  <p className="text-sm text-gray-600 ml-6">Nobody here yet.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {kids.map((p) => {
                      const keys = (awardsByPlayer[p.id] || []).map((a) => a.stripe_key);
                      const earned = stripesInLevel(p.level, keys);
                      const isOpen = openId === p.id;
                      const canPromote = !lvl.invitational && earned >= 5;
                      return (
                        <div
                          key={p.id}
                          className={`rounded-xl border p-4 transition-colors ${
                            isOpen
                              ? 'border-yellow-400/60 bg-white/[.06]'
                              : 'border-white/10 bg-white/[.03] hover:bg-white/[.05]'
                          }`}
                        >
                          <button className="w-full text-left" onClick={() => setOpenId(isOpen ? null : p.id)}>
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold truncate">{p.name}</span>
                              {!p.enrolled && (
                                <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300 flex-shrink-0">
                                  win-back
                                </span>
                              )}
                            </div>
                            {!lvl.invitational && (
                              <div className="flex gap-1.5 mt-2">
                                {lvl.stripes.map((st) => {
                                  const has = keys.includes(st.key);
                                  return (
                                    <span
                                      key={st.key}
                                      className="w-3 h-3 rounded-full"
                                      style={{
                                        background: has ? lvl.color : 'transparent',
                                        border: `1.5px solid ${has ? lvl.color : 'rgba(255,255,255,.25)'}`,
                                      }}
                                    />
                                  );
                                })}
                                {canPromote && (
                                  <span className="text-[10px] font-bold text-yellow-400 ml-1">READY ↑</span>
                                )}
                              </div>
                            )}
                          </button>

                          {isOpen && (
                            <div className="mt-4 pt-4 border-t border-white/10 space-y-1.5">
                              {lvl.stripes.map((st) => {
                                const has = keys.includes(st.key);
                                const tKey = `${p.id}:${st.key}`;
                                const testsOpen = openTests === tKey;
                                const doneCount = [0, 1, 2].filter((i) =>
                                  checkSet.has(`${p.id}:${st.key}:${i}`),
                                ).length;
                                return (
                                  <div key={st.key}>
                                    <div className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm hover:bg-white/5">
                                      <button
                                        disabled={busy}
                                        onClick={() => toggleStripe(p, st.key, has)}
                                        title={has ? 'Take the string back' : 'Award the whole string'}
                                        className="disabled:opacity-50"
                                      >
                                        <span
                                          className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                                          style={{
                                            background: has ? lvl.color : 'transparent',
                                            border: `2px solid ${has ? lvl.color : 'rgba(255,255,255,.3)'}`,
                                            color: has ? '#111' : 'rgba(255,255,255,.5)',
                                          }}
                                        >
                                          {has ? <Check size={11} strokeWidth={3.5} /> : st.number}
                                        </span>
                                      </button>
                                      <button
                                        className="flex-1 flex items-center gap-1.5 text-left"
                                        onClick={() => setOpenTests(testsOpen ? null : tKey)}
                                      >
                                        <span className={has ? 'text-white' : 'text-gray-400'}>
                                          {st.title}
                                          {st.promotes && ' ★'}
                                        </span>
                                        {!has && doneCount > 0 && (
                                          <span className="text-[10px] font-bold" style={{ color: lvl.color }}>
                                            {doneCount}/3
                                          </span>
                                        )}
                                        <ChevronDown
                                          size={12}
                                          className={`text-gray-600 transition-transform ${testsOpen ? 'rotate-180' : ''}`}
                                        />
                                      </button>
                                    </div>
                                    {testsOpen && (
                                      <div className="ml-9 mr-1 mb-1.5 space-y-1">
                                        {st.tests.map((t, i) => {
                                          const passed = has || checkSet.has(`${p.id}:${st.key}:${i}`);
                                          return (
                                            <button
                                              key={i}
                                              disabled={busy || has}
                                              onClick={() => toggleTest(p, st.key, i, passed)}
                                              title={`WHAT: ${t.what}\n\nHOW: ${t.how}\n\nPASS: ${t.pass}`}
                                              className="w-full flex items-start gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] leading-snug hover:bg-white/5 disabled:opacity-70"
                                            >
                                              <span
                                                className="mt-[2px] w-3.5 h-3.5 rounded-full flex-shrink-0"
                                                style={{
                                                  background: passed ? lvl.color : 'transparent',
                                                  border: `1.5px solid ${passed ? lvl.color : 'rgba(255,255,255,.3)'}`,
                                                }}
                                              />
                                              <span className={passed ? 'text-gray-500 line-through' : 'text-gray-300'}>
                                                {t.label}
                                              </span>
                                            </button>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}

                              <div className="flex flex-wrap gap-2 pt-3">
                                {canPromote && (
                                  <button
                                    disabled={busy}
                                    onClick={() => promote(p)}
                                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-yellow-400 text-gray-900 text-xs font-bold hover:bg-yellow-300"
                                  >
                                    <ChevronUp size={13} /> Promote to {nextLevel(p.level)?.name}
                                  </button>
                                )}
                                <button
                                  onClick={() => copyLink(p)}
                                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/10 text-xs font-semibold hover:bg-white/15"
                                >
                                  <Copy size={12} /> {copied === p.id ? 'Copied!' : 'Family link'}
                                </button>
                                <button
                                  disabled={busy}
                                  onClick={() => deactivate(p)}
                                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/5 text-xs text-gray-400 hover:text-red-300 hover:bg-red-500/10"
                                >
                                  <UserX size={12} /> Remove
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>

      {/* add player modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-[#0b2530] border border-white/10 rounded-2xl p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg">Add a player</h3>
              <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <label className="block text-xs font-semibold text-gray-400 mb-1">Name</label>
            <input
              autoFocus
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addPlayer()}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm mb-4"
              style={{ color: '#fff' }}
              placeholder="First Last"
            />
            <label className="block text-xs font-semibold text-gray-400 mb-1">Ball color</label>
            <div className="flex gap-2 mb-5">
              {LEVELS.map((l) => (
                <button
                  key={l.key}
                  onClick={() => setAddLevel(l.key)}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-colors ${
                    addLevel === l.key ? 'border-white/60 bg-white/10' : 'border-white/10 hover:bg-white/5'
                  }`}
                >
                  <span className="block w-3 h-3 rounded-full mx-auto mb-1" style={{ background: l.color }} />
                  {l.key.toUpperCase()}
                </button>
              ))}
            </div>
            <button
              disabled={busy || !addName.trim()}
              onClick={addPlayer}
              className="w-full py-2.5 rounded-lg bg-yellow-400 text-gray-900 font-bold text-sm hover:bg-yellow-300 disabled:opacity-50"
            >
              {busy ? 'Adding…' : 'Add to the Pathway'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Dumbbell, Users, Sparkles, Loader2, User as UserIcon } from 'lucide-react';

type Client = { id: string; name: string };

export default function DrillsPage() {
  const [mode, setMode] = useState<'player' | 'clinic'>('player');
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState('');
  const [focus, setFocus] = useState('');
  const [level, setLevel] = useState('intermediate');
  const [playerCount, setPlayerCount] = useState(6);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState('');

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: coach } = await supabase.from('lesson_coaches').select('id').eq('profile_id', user.id).maybeSingle();
      if (!coach) return;
      const { data: links } = await supabase
        .from('lesson_client_coaches')
        .select('lesson_clients(id, name)')
        .eq('coach_id', coach.id);
      const cs = (links || []).map((l: any) => l.lesson_clients).filter(Boolean);
      setClients(cs);
    })();
  }, []);

  const run = async () => {
    setLoading(true);
    setResult('');
    try {
      const body = mode === 'player'
        ? { mode, clientId: clientId || undefined, focus: clientId ? undefined : focus, level }
        : { mode, playerCount, level, focus: focus || undefined };
      const res = await fetch('/api/coach/drills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || json.error || 'Could not generate');
      setResult(json.result);
    } catch (e: any) {
      toast.error(e?.message || 'Could not generate suggestions.');
    } finally {
      setLoading(false);
    }
  };

  const input = 'w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-yellow-300/40';

  return (
    <div className="min-h-screen bg-[#001820] text-white px-4 md:px-8 py-8 md:py-12">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-2">
          <Dumbbell className="text-yellow-300" size={24} />
          <h1 className="font-display text-3xl">Drill &amp; Clinic Planner</h1>
        </div>
        <p className="text-white/50 mb-6">AI picks the right drills from your library — for one player or a whole clinic.</p>

        <div className="inline-flex rounded-xl bg-white/5 p-1 mb-6">
          <button onClick={() => { setMode('player'); setResult(''); }} className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 ${mode === 'player' ? 'bg-yellow-300 text-[#001820]' : 'text-white/60'}`}>
            <UserIcon size={15} /> For a player
          </button>
          <button onClick={() => { setMode('clinic'); setResult(''); }} className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 ${mode === 'clinic' ? 'bg-yellow-300 text-[#001820]' : 'text-white/60'}`}>
            <Users size={15} /> Clinic
          </button>
        </div>

        <div className="space-y-4">
          {mode === 'player' ? (
            <>
              {clients.length > 0 && (
                <div>
                  <label className="text-sm text-white/60">Player (uses their tracked progress)</label>
                  <select className={`${input} mt-1`} value={clientId} onChange={(e) => setClientId(e.target.value)}>
                    <option value="" className="bg-[#002838]">— or just enter a focus below —</option>
                    {clients.map((c) => <option key={c.id} value={c.id} className="bg-[#002838]">{c.name}</option>)}
                  </select>
                </div>
              )}
              {!clientId && (
                <div>
                  <label className="text-sm text-white/60">What are they working on?</label>
                  <input className={`${input} mt-1`} value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="e.g. second serve, backhand consistency" />
                </div>
              )}
            </>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-white/60">Number of players</label>
                <input type="number" min={1} max={20} className={`${input} mt-1`} value={playerCount} onChange={(e) => setPlayerCount(Number(e.target.value))} />
              </div>
              <div>
                <label className="text-sm text-white/60">Emphasis (optional)</label>
                <input className={`${input} mt-1`} value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="e.g. net play" />
              </div>
            </div>
          )}

          <div>
            <label className="text-sm text-white/60">Level</label>
            <select className={`${input} mt-1`} value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="beginner" className="bg-[#002838]">Beginner</option>
              <option value="intermediate" className="bg-[#002838]">Intermediate</option>
              <option value="advanced" className="bg-[#002838]">Advanced</option>
              <option value="all" className="bg-[#002838]">Mixed / any</option>
            </select>
          </div>

          <button onClick={run} disabled={loading} className="w-full px-5 py-3 rounded-xl bg-yellow-300 text-[#001820] font-medium flex items-center justify-center gap-2 hover:bg-yellow-200 disabled:opacity-60">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <><Sparkles size={16} /> {mode === 'player' ? 'Suggest drills' : 'Build my session'}</>}
          </button>

          {result && (
            <div className="mt-4 rounded-2xl border border-yellow-300/30 bg-yellow-300/[0.06] p-5">
              <p className="text-white/90 text-sm whitespace-pre-wrap leading-relaxed">{result}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

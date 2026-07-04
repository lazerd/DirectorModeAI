'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Dumbbell, Search, Loader2, ChevronDown, Users, Clock, ArrowLeft, UserPlus } from 'lucide-react';

type Drill = {
  id: string; name: string; category: string; skills: string[]; level: string;
  min_players: number; max_players: number; duration_min: number | null; is_game: boolean;
  setup: string | null; instructions: string | null; coaching_points: string | null; progression: string | null;
};

const CATS = ['all', 'warmup', 'serve', 'groundstrokes', 'volley', 'overhead', 'movement', 'strategy', 'game', 'conditioning'];
const LEVELS = ['all', 'beginner', 'intermediate', 'advanced'];

export default function DrillLibraryPage() {
  const [drills, setDrills] = useState<Drill[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [level, setLevel] = useState('all');
  const [gamesOnly, setGamesOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [assignClient, setAssignClient] = useState('');
  const [assignNote, setAssignNote] = useState('');
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('drills')
        .select('id, name, category, skills, level, min_players, max_players, duration_min, is_game, setup, instructions, coaching_points, progression')
        .order('name');
      setDrills((data as Drill[]) || []);
      setLoading(false);
      try {
        const cr = await fetch('/api/coach/assign-drill');
        const cj = await cr.json();
        if (cj.isCoach) setClients(cj.clients || []);
      } catch { /* not a coach */ }
    })();
  }, []);

  const assign = async (drillId: string) => {
    if (!assignClient) { toast.error('Pick a player first.'); return; }
    setAssigning(true);
    try {
      const res = await fetch('/api/coach/assign-drill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: assignClient, drillId, note: assignNote }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Could not assign');
      toast.success('Assigned — it will show in their progress.');
      setAssignNote('');
    } catch (e: any) { toast.error(e?.message || 'Could not assign.'); } finally { setAssigning(false); }
  };

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return drills.filter((d) =>
      (cat === 'all' || d.category === cat) &&
      (level === 'all' || d.level === level || d.level === 'all') &&
      (!gamesOnly || d.is_game) &&
      (!term || d.name.toLowerCase().includes(term) || (d.skills || []).some((s) => s.includes(term)) || (d.instructions || '').toLowerCase().includes(term))
    );
  }, [drills, q, cat, level, gamesOnly]);

  const pill = 'px-3 py-1.5 rounded-full text-sm border transition-colors capitalize';

  return (
    <div className="min-h-screen bg-[#001820] text-white px-4 md:px-8 py-8 md:py-12">
      <div className="max-w-3xl mx-auto">
        <Link href="/lessons/drills" className="inline-flex items-center gap-2 text-white/50 hover:text-white text-sm mb-4"><ArrowLeft size={15} /> Drill Planner</Link>
        <div className="flex items-center gap-3 mb-2">
          <Dumbbell className="text-yellow-300" size={24} />
          <h1 className="font-display text-3xl">Drill Library</h1>
        </div>
        <p className="text-white/50 mb-6">{loading ? 'Loading…' : `${drills.length} coach-ready drills & games. Browse, or search by name or skill.`}</p>

        <div className="relative mb-4">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search drills, games, or skills…" style={{ color: '#fff' }}
            className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-white/5 border border-white/10 focus:outline-none focus:ring-2 focus:ring-yellow-300/40" />
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          {CATS.map((c) => (
            <button key={c} onClick={() => setCat(c)} className={`${pill} ${cat === c ? 'bg-yellow-300 text-[#001820] border-yellow-300' : 'border-white/15 text-white/60 hover:text-white'}`}>{c}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 mb-6">
          {LEVELS.map((l) => (
            <button key={l} onClick={() => setLevel(l)} className={`${pill} ${level === l ? 'bg-white/15 text-white border-white/25' : 'border-white/10 text-white/50 hover:text-white'}`}>{l}</button>
          ))}
          <button onClick={() => setGamesOnly((g) => !g)} className={`${pill} ${gamesOnly ? 'bg-emerald-400/20 text-emerald-300 border-emerald-400/30' : 'border-white/10 text-white/50 hover:text-white'}`}>Games only</button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-yellow-300" /></div>
        ) : (
          <>
            <div className="text-xs text-white/40 mb-3">{filtered.length} result{filtered.length === 1 ? '' : 's'}</div>
            <div className="space-y-2">
              {filtered.map((d) => (
                <div key={d.id} className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
                  <button onClick={() => setOpen(open === d.id ? null : d.id)} className="w-full flex items-center gap-3 p-4 text-left hover:bg-white/[0.03]">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium flex items-center gap-2">
                        {d.name}
                        {d.is_game && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-400/15 text-emerald-300 uppercase tracking-wide">Game</span>}
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-xs text-white/40">
                        <span className="capitalize">{d.category}</span>
                        <span className="capitalize">· {d.level}</span>
                        <span className="flex items-center gap-1"><Users size={11} /> {d.min_players}{d.max_players > d.min_players ? `–${d.max_players}` : ''}</span>
                        {d.duration_min && <span className="flex items-center gap-1"><Clock size={11} /> {d.duration_min}m</span>}
                      </div>
                    </div>
                    <ChevronDown size={18} className={`text-white/40 transition-transform ${open === d.id ? 'rotate-180' : ''}`} />
                  </button>
                  {open === d.id && (
                    <div className="px-4 pb-4 pt-1 space-y-2 text-sm border-t border-white/[0.06]">
                      {d.skills?.length > 0 && <div className="flex flex-wrap gap-1.5 pt-2">{d.skills.map((s) => <span key={s} className="text-[11px] px-2 py-0.5 rounded-full bg-white/10 text-white/60 capitalize">{s}</span>)}</div>}
                      {d.setup && <p className="text-white/70"><span className="text-white/40">Setup:</span> {d.setup}</p>}
                      {d.instructions && <p className="text-white/80"><span className="text-white/40">Run it:</span> {d.instructions}</p>}
                      {d.coaching_points && <p className="text-yellow-300/90"><span className="text-white/40">Coach:</span> {d.coaching_points}</p>}
                      {d.progression && <p className="text-white/60"><span className="text-white/40">Progress:</span> {d.progression}</p>}
                      {clients.length > 0 && (
                        <div className="pt-3 mt-1 border-t border-white/[0.06] flex flex-col sm:flex-row gap-2">
                          <select value={assignClient} onChange={(e) => setAssignClient(e.target.value)} style={{ color: '#fff' }} className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm focus:outline-none">
                            <option value="" className="bg-[#002838]">Assign to a player…</option>
                            {clients.map((c) => <option key={c.id} value={c.id} className="bg-[#002838]">{c.name}</option>)}
                          </select>
                          <input value={assignNote} onChange={(e) => setAssignNote(e.target.value)} placeholder="Note (optional)" style={{ color: '#fff' }} className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm focus:outline-none" />
                          <button onClick={() => assign(d.id)} disabled={assigning} className="px-4 py-2 rounded-lg bg-yellow-300 text-[#001820] font-medium text-sm flex items-center justify-center gap-1.5 hover:bg-yellow-200 disabled:opacity-60">
                            {assigning ? <Loader2 size={14} className="animate-spin" /> : <><UserPlus size={14} /> Assign</>}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {filtered.length === 0 && <div className="text-center py-12 text-white/40">No drills match those filters.</div>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

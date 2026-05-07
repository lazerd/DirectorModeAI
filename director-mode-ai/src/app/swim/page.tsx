'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Loader2, Waves, ChevronRight, Archive } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Season = {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  default_points_required: number;
  status: 'active' | 'archived';
  family_count: number;
  job_count: number;
};

export default function SwimHomePage() {
  const router = useRouter();
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    start_date: '',
    end_date: '',
    default_points_required: 20,
  });

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      const { data: rows } = await supabase
        .from('swim_seasons')
        .select('*')
        .order('created_at', { ascending: false });

      const seasonRows = (rows as any[]) || [];
      const ids = seasonRows.map((s) => s.id);

      // Pull counts in parallel
      const [familyCounts, jobCounts] = await Promise.all([
        ids.length === 0
          ? Promise.resolve({} as Record<string, number>)
          : supabase
              .from('swim_families')
              .select('season_id', { count: 'exact' })
              .in('season_id', ids)
              .then((r) => {
                const out: Record<string, number> = {};
                for (const x of (r.data as any[]) || []) {
                  out[x.season_id] = (out[x.season_id] ?? 0) + 1;
                }
                return out;
              }),
        ids.length === 0
          ? Promise.resolve({} as Record<string, number>)
          : supabase
              .from('swim_jobs')
              .select('season_id')
              .in('season_id', ids)
              .then((r) => {
                const out: Record<string, number> = {};
                for (const x of (r.data as any[]) || []) {
                  out[x.season_id] = (out[x.season_id] ?? 0) + 1;
                }
                return out;
              }),
      ]);

      setSeasons(
        seasonRows.map((s) => ({
          ...s,
          family_count: familyCounts[s.id] ?? 0,
          job_count: jobCounts[s.id] ?? 0,
        }))
      );
      setLoading(false);
    })();
  }, [router]);

  const createSeason = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      const { data, error: insErr } = await supabase
        .from('swim_seasons')
        .insert({
          director_id: user.id,
          name: form.name.trim(),
          start_date: form.start_date || null,
          end_date: form.end_date || null,
          default_points_required: form.default_points_required,
        })
        .select('id')
        .single();
      if (insErr || !data) {
        setError(insErr?.message || 'Could not create season');
        setCreating(false);
        return;
      }
      router.push(`/swim/${(data as any).id}`);
    } catch (err: any) {
      setError(err?.message || 'Network error');
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-cyan-50 to-blue-50 relative overflow-hidden">
      <div className="absolute -top-32 -right-32 w-96 h-96 bg-cyan-300/25 rounded-full blur-3xl pointer-events-none" />
      <header className="border-b bg-white/70 backdrop-blur-md sticky top-0 z-10 relative">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 text-sm font-medium">
            <ArrowLeft size={18} />
            Back to ClubMode
          </Link>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white flex items-center justify-center shadow-md">
              <Waves size={18} />
            </div>
            <div>
              <h1 className="font-display font-bold text-lg leading-tight">SwimMode</h1>
              <p className="text-xs text-gray-500">Volunteer points tracking</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-10 space-y-6 relative">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-display text-3xl font-bold text-gray-900">Seasons</h2>
            <p className="text-sm text-gray-600 mt-1">
              Create a season, add jobs and families, track who's earned what.
            </p>
          </div>
          <button
            onClick={() => setShowCreate((s) => !s)}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white rounded-xl font-semibold text-sm shadow-md hover:shadow-lg transition-all"
          >
            <Plus size={16} />
            {showCreate ? 'Cancel' : 'New season'}
          </button>
        </div>

        {showCreate && (
          <form
            onSubmit={createSeason}
            className="bg-white rounded-xl border border-gray-200 p-5 space-y-4"
          >
            <div>
              <label className="block text-sm font-medium mb-1">Season name *</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Summer 2026"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Start date</label>
                <input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">End date</label>
                <input
                  type="date"
                  value={form.end_date}
                  onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Default points required per family
              </label>
              <input
                type="number"
                min={0}
                max={1000}
                value={form.default_points_required}
                onChange={(e) =>
                  setForm({
                    ...form,
                    default_points_required: parseInt(e.target.value || '0', 10),
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
              />
              <p className="text-xs text-gray-500 mt-1">
                You can override per family later.
              </p>
            </div>
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={creating || !form.name.trim()}
              className="w-full py-2.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {creating && <Loader2 size={16} className="animate-spin" />}
              {creating ? 'Creating…' : 'Create season'}
            </button>
          </form>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="animate-spin text-cyan-500" size={24} />
          </div>
        ) : seasons.length === 0 ? (
          <div className="bg-white rounded-xl border-2 border-dashed border-gray-300 p-10 text-center">
            <Waves size={36} className="mx-auto text-cyan-400 mb-3" />
            <p className="text-gray-600 mb-4">No seasons yet — create one to get started.</p>
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg font-semibold text-sm"
            >
              <Plus size={16} /> New season
            </button>
          </div>
        ) : (
          <ul className="grid sm:grid-cols-2 gap-3">
            {seasons.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/swim/${s.id}`}
                  className={`group block p-5 bg-white rounded-2xl shadow-sm transition-all hover:shadow-lg hover:-translate-y-0.5 ${
                    s.status === 'archived'
                      ? 'ring-1 ring-gray-200 opacity-60'
                      : 'ring-1 ring-gray-200 hover:ring-cyan-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-100 to-blue-100 text-cyan-700 flex items-center justify-center flex-shrink-0">
                        <Waves size={16} />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-bold text-gray-900 truncate">{s.name}</h3>
                        {s.start_date && s.end_date ? (
                          <p className="text-[11px] text-gray-500">
                            {s.start_date} → {s.end_date}
                          </p>
                        ) : (
                          <p className="text-[11px] text-gray-400">No dates set</p>
                        )}
                      </div>
                    </div>
                    {s.status === 'archived' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-700">
                        <Archive size={10} /> Archived
                      </span>
                    ) : (
                      <ChevronRight className="text-gray-300 group-hover:text-cyan-500 group-hover:translate-x-0.5 transition-all" size={20} />
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-cyan-50 rounded-lg px-2 py-1.5">
                      <div className="text-base font-extrabold text-cyan-900 leading-tight">
                        {s.family_count}
                      </div>
                      <div className="text-[9px] uppercase tracking-wider font-bold text-cyan-700">
                        {s.family_count === 1 ? 'family' : 'families'}
                      </div>
                    </div>
                    <div className="bg-blue-50 rounded-lg px-2 py-1.5">
                      <div className="text-base font-extrabold text-blue-900 leading-tight">
                        {s.job_count}
                      </div>
                      <div className="text-[9px] uppercase tracking-wider font-bold text-blue-700">
                        {s.job_count === 1 ? 'job' : 'jobs'}
                      </div>
                    </div>
                    <div className="bg-emerald-50 rounded-lg px-2 py-1.5">
                      <div className="text-base font-extrabold text-emerald-900 leading-tight">
                        {s.default_points_required}
                      </div>
                      <div className="text-[9px] uppercase tracking-wider font-bold text-emerald-700">
                        target
                      </div>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

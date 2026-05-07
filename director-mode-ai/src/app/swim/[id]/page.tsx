'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Loader2,
  Waves,
  Briefcase,
  Users,
  Activity,
  Settings as SettingsIcon,
  AlertCircle,
  CalendarDays,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import SwimJobsTab from '@/components/swim/SwimJobsTab';
import SwimFamiliesTab from '@/components/swim/SwimFamiliesTab';
import SwimTrackerTab from '@/components/swim/SwimTrackerTab';
import SwimSettingsTab from '@/components/swim/SwimSettingsTab';
import SwimMeetsTab from '@/components/swim/SwimMeetsTab';

export type SwimSeason = {
  id: string;
  director_id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  default_points_required: number;
  status: 'active' | 'archived';
};

export type SwimMeet = {
  id: string;
  season_id: string;
  name: string;
  meet_date: string | null;
  location: string | null;
  opponent: string | null;
  notes: string | null;
};

export type SwimJob = {
  id: string;
  season_id: string;
  meet_id: string | null;
  name: string;
  description: string | null;
  points: number;
  job_date: string | null;
  slots: number | null;
  auto_award_on_signup: boolean;
  notes: string | null;
};

export type SwimFamily = {
  id: string;
  season_id: string;
  family_name: string;
  family_token: string;
  primary_email: string | null;
  primary_phone: string | null;
  num_swimmers: number | null;
  points_required: number | null;
  notes: string | null;
};

export type SwimAssignment = {
  id: string;
  family_id: string;
  job_id: string;
  points_awarded: number;
  status: 'signed_up' | 'completed' | 'no_show' | 'cancelled';
  completed_at: string | null;
  auto_awarded: boolean;
  notes: string | null;
};

export type FamilyProgress = {
  earned: number;
  pending: number;
  required: number;
  percent: number;
  pendingPercent: number;
};

type Tab = 'tracker' | 'meets' | 'jobs' | 'families' | 'settings';

export default function SwimSeasonDashboard() {
  const params = useParams();
  const router = useRouter();
  const id = Array.isArray(params.id) ? params.id[0] : (params.id as string);

  const [season, setSeason] = useState<SwimSeason | null>(null);
  const [meets, setMeets] = useState<SwimMeet[]>([]);
  const [jobs, setJobs] = useState<SwimJob[]>([]);
  const [families, setFamilies] = useState<SwimFamily[]>([]);
  const [assignments, setAssignments] = useState<SwimAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('tracker');

  const fetchAll = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const { data: s, error: sErr } = await supabase
      .from('swim_seasons')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (sErr) {
      setError(sErr.message);
      setLoading(false);
      return;
    }
    if (!s) {
      router.push('/swim');
      return;
    }
    setSeason(s as SwimSeason);

    const familyIdsThen = async (fams: SwimFamily[]) => {
      if (fams.length === 0) return [] as SwimAssignment[];
      const { data } = await supabase
        .from('swim_assignments')
        .select('*')
        .in(
          'family_id',
          fams.map((f) => f.id)
        );
      return (data as SwimAssignment[]) || [];
    };

    const [mRes, jRes, fRes] = await Promise.all([
      supabase.from('swim_meets').select('*').eq('season_id', id),
      supabase.from('swim_jobs').select('*').eq('season_id', id).order('job_date', { nullsFirst: false }),
      supabase.from('swim_families').select('*').eq('season_id', id).order('family_name'),
    ]);
    const fams = (fRes.data as SwimFamily[]) || [];
    setMeets((mRes.data as SwimMeet[]) || []);
    setJobs((jRes.data as SwimJob[]) || []);
    setFamilies(fams);
    setAssignments(await familyIdsThen(fams));
    setLoading(false);
  }, [id, router]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const familyProgress = useMemo(() => {
    const map = new Map<string, FamilyProgress>();
    if (!season) return map;
    for (const f of families) {
      const required = f.points_required ?? season.default_points_required;
      const earned = assignments
        .filter((a) => a.family_id === f.id && a.status === 'completed')
        .reduce((sum, a) => sum + a.points_awarded, 0);
      const pending = assignments
        .filter((a) => a.family_id === f.id && a.status === 'signed_up')
        .reduce((sum, a) => sum + a.points_awarded, 0);
      const percent = required > 0 ? Math.round((earned / required) * 100) : 0;
      const pendingPercent = required > 0 ? Math.round((pending / required) * 100) : 0;
      map.set(f.id, { earned, pending, required, percent, pendingPercent });
    }
    return map;
  }, [families, assignments, season]);

  if (loading) {
    return (
      <div className="min-h-screen bg-cyan-50 flex items-center justify-center">
        <Loader2 className="animate-spin text-cyan-500" size={28} />
      </div>
    );
  }

  if (error || !season) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5" />
          <div>
            <p className="font-medium">Could not load season.</p>
            {error && <p className="text-sm">{error}</p>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-cyan-50 to-blue-50 relative overflow-hidden">
      <div className="absolute -top-32 -right-32 w-96 h-96 bg-cyan-300/25 rounded-full blur-3xl pointer-events-none" />
      <header className="border-b bg-white/70 backdrop-blur-md sticky top-0 z-10 relative">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link href="/swim" className="p-2 hover:bg-gray-100 rounded-lg transition">
            <ArrowLeft size={20} />
          </Link>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white flex items-center justify-center shadow-md">
            <Waves size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-display font-bold text-xl text-gray-900 truncate">{season.name}</h1>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-wider text-cyan-800 bg-cyan-100 px-1.5 py-0.5 rounded-full">
                {families.length} {families.length === 1 ? 'family' : 'families'}
              </span>
              <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-wider text-blue-800 bg-blue-100 px-1.5 py-0.5 rounded-full">
                {meets.length} {meets.length === 1 ? 'meet' : 'meets'}
              </span>
              <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-wider text-indigo-800 bg-indigo-100 px-1.5 py-0.5 rounded-full">
                {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'}
              </span>
              <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-wider text-emerald-800 bg-emerald-100 px-1.5 py-0.5 rounded-full">
                {season.default_points_required} pt target
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {(() => {
          const pendingCount = assignments.filter((a) => a.status === 'signed_up').length;
          return (
            <div className="border-b border-gray-200 mb-6 flex gap-1 overflow-x-auto">
              {[
                { id: 'tracker' as const, label: 'Tracker', icon: Activity, badge: pendingCount },
                { id: 'meets' as const, label: 'Meets', icon: CalendarDays, badge: 0 },
                { id: 'jobs' as const, label: 'Jobs', icon: Briefcase, badge: 0 },
                { id: 'families' as const, label: 'Families', icon: Users, badge: 0 },
                { id: 'settings' as const, label: 'Settings', icon: SettingsIcon, badge: 0 },
              ].map((t) => {
                const Icon = t.icon;
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`flex items-center gap-2 px-4 py-2 border-b-2 font-medium text-sm whitespace-nowrap ${
                      active
                        ? 'border-cyan-500 text-cyan-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <Icon size={16} />
                    {t.label}
                    {t.badge > 0 && (
                      <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-amber-500 text-white text-[10px] font-bold rounded-full">
                        {t.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })()}

        {tab === 'tracker' && (
          <SwimTrackerTab
            season={season}
            jobs={jobs}
            families={families}
            assignments={assignments}
            familyProgress={familyProgress}
            onRefresh={fetchAll}
          />
        )}
        {tab === 'meets' && (
          <SwimMeetsTab seasonId={season.id} meets={meets} jobs={jobs} onRefresh={fetchAll} />
        )}
        {tab === 'jobs' && (
          <SwimJobsTab seasonId={season.id} jobs={jobs} meets={meets} onRefresh={fetchAll} />
        )}
        {tab === 'families' && (
          <SwimFamiliesTab
            seasonId={season.id}
            defaultPointsRequired={season.default_points_required}
            families={families}
            familyProgress={familyProgress}
            onRefresh={fetchAll}
          />
        )}
        {tab === 'settings' && <SwimSettingsTab season={season} onRefresh={fetchAll} />}
      </main>
    </div>
  );
}

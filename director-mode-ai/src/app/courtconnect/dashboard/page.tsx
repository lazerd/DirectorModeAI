'use client';

import { useState, useEffect } from 'react';
import { Users, Calendar, Wrench, Clock, TrendingUp, Database, BarChart3 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type Stats = {
  totalMembers: number;
  activeMembers: number;
  totalEvents: number;
  openEvents: number;
  completedEvents: number;
  totalLessons: number;
  claimedLessons: number;
  totalStringJobs: number;
  completedStringJobs: number;
  pendingStringJobs: number;
  recentMembers: { full_name: string; primary_sport: string; created_at: string }[];
  upcomingEvents: { title: string; event_date: string; sport: string; accepted_count: number; max_players: number }[];
};

export default function DirectorDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchStats(); }, []);

  const fetchStats = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    // Vault stats
    const { count: totalMembers } = await supabase
      .from('cc_vault_players').select('*', { count: 'exact', head: true }).eq('director_id', user.id);
    const { count: activeMembers } = await supabase
      .from('cc_vault_players').select('*', { count: 'exact', head: true }).eq('director_id', user.id).eq('membership_status', 'active');

    // Event stats
    const { count: totalEvents } = await supabase
      .from('cc_events').select('*', { count: 'exact', head: true }).eq('created_by', user.id);
    const { count: openEvents } = await supabase
      .from('cc_events').select('*', { count: 'exact', head: true }).eq('created_by', user.id).eq('status', 'open');
    const { count: completedEvents } = await supabase
      .from('cc_events').select('*', { count: 'exact', head: true }).eq('created_by', user.id).eq('status', 'completed');

    // Lesson stats (if coach)
    const { data: coach } = await supabase
      .from('lesson_coaches').select('id').eq('profile_id', user.id).single();

    let totalLessons = 0;
    let claimedLessons = 0;

    if (coach) {
      const { count: tl } = await supabase
        .from('lesson_slots').select('*', { count: 'exact', head: true }).eq('coach_id', coach.id);
      const { count: cl } = await supabase
        .from('lesson_slots').select('*', { count: 'exact', head: true }).eq('coach_id', coach.id).eq('status', 'claimed');
      totalLessons = tl || 0;
      claimedLessons = cl || 0;
    }

    // Stringing stats
    const { count: totalStringJobs } = await supabase
      .from('stringing_jobs').select('*', { count: 'exact', head: true });
    const { count: completedStringJobs } = await supabase
      .from('stringing_jobs').select('*', { count: 'exact', head: true }).in('status', ['done', 'picked_up']);
    const { count: pendingStringJobs } = await supabase
      .from('stringing_jobs').select('*', { count: 'exact', head: true }).in('status', ['pending', 'in_progress']);

    // Recent members
    const { data: recentMembers } = await supabase
      .from('cc_vault_players')
      .select('full_name, primary_sport, created_at')
      .eq('director_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5);

    // Upcoming events
    const { data: upcomingEventsRaw } = await supabase
      .from('cc_events')
      .select('id, title, event_date, sport, max_players')
      .eq('created_by', user.id)
      .eq('status', 'open')
      .gte('event_date', new Date().toISOString().split('T')[0])
      .order('event_date', { ascending: true })
      .limit(5);

    let upcomingEvents: Stats['upcomingEvents'] = [];
    if (upcomingEventsRaw) {
      upcomingEvents = await Promise.all(
        upcomingEventsRaw.map(async (e) => {
          const { count } = await supabase
            .from('cc_event_players').select('*', { count: 'exact', head: true }).eq('event_id', e.id).eq('status', 'accepted');
          return { ...e, accepted_count: count || 0 };
        })
      );
    }

    setStats({
      totalMembers: totalMembers || 0,
      activeMembers: activeMembers || 0,
      totalEvents: totalEvents || 0,
      openEvents: openEvents || 0,
      completedEvents: completedEvents || 0,
      totalLessons,
      claimedLessons,
      totalStringJobs: totalStringJobs || 0,
      completedStringJobs: completedStringJobs || 0,
      pendingStringJobs: pendingStringJobs || 0,
      recentMembers: recentMembers || [],
      upcomingEvents,
    });

    setLoading(false);
  };

  const sportLabel = (sport: string) =>
    sport.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen"><div className="spinner" /></div>;
  }

  if (!stats) {
    return <div className="p-6 text-white/50">Unable to load dashboard.</div>;
  }

  return (
    <div className="p-6 max-w-6xl mx-auto page-enter">
      <div className="mb-8">
        <h1 className="text-2xl font-display text-white">Director Dashboard</h1>
        <p className="text-white/50 mt-1">Overview of your club activity across all tools.</p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard icon={Database} label="Total Members" value={stats.totalMembers} sub={`${stats.activeMembers} active`} color="text-[#D3FB52]" bg="bg-[#D3FB52]/10" />
        <StatCard icon={Calendar} label="Events" value={stats.totalEvents} sub={`${stats.openEvents} open`} color="text-emerald-400" bg="bg-emerald-400/10" />
        <StatCard icon={Clock} label="Lessons" value={stats.totalLessons} sub={`${stats.claimedLessons} booked`} color="text-blue-400" bg="bg-blue-400/10" />
        <StatCard icon={Wrench} label="String Jobs" value={stats.totalStringJobs} sub={`${stats.pendingStringJobs} pending`} color="text-pink-400" bg="bg-pink-400/10" />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Upcoming Events */}
        <div className="card p-5">
          <h2 className="font-semibold text-white mb-4 flex items-center gap-2">
            <Calendar size={18} className="text-emerald-400" />
            Upcoming Events
          </h2>
          {stats.upcomingEvents.length === 0 ? (
            <p className="text-white/30 text-sm">No upcoming events.</p>
          ) : (
            <div className="space-y-3">
              {stats.upcomingEvents.map((event, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-white/[0.03] rounded-lg">
                  <div>
                    <p className="text-white font-medium text-sm">{event.title}</p>
                    <p className="text-white/40 text-xs">
                      {new Date(event.event_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      {' · '}{sportLabel(event.sport)}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className={`text-sm font-semibold ${event.accepted_count >= event.max_players ? 'text-red-400' : 'text-emerald-400'}`}>
                      {event.accepted_count}/{event.max_players}
                    </span>
                    <p className="text-white/30 text-xs">players</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Members */}
        <div className="card p-5">
          <h2 className="font-semibold text-white mb-4 flex items-center gap-2">
            <Users size={18} className="text-[#D3FB52]" />
            Recent Members
          </h2>
          {stats.recentMembers.length === 0 ? (
            <p className="text-white/30 text-sm">No members in vault yet.</p>
          ) : (
            <div className="space-y-3">
              {stats.recentMembers.map((member, i) => (
                <div key={i} className="flex items-center gap-3 p-3 bg-white/[0.03] rounded-lg">
                  <div className="w-8 h-8 rounded-lg bg-[#D3FB52]/10 flex items-center justify-center">
                    <span className="text-[#D3FB52] font-semibold text-xs">
                      {member.full_name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium text-sm truncate">{member.full_name}</p>
                    <p className="text-white/40 text-xs">{sportLabel(member.primary_sport)}</p>
                  </div>
                  <span className="text-white/30 text-xs">
                    {new Date(member.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Activity Summary */}
        <div className="card p-5 md:col-span-2">
          <h2 className="font-semibold text-white mb-4 flex items-center gap-2">
            <BarChart3 size={18} className="text-[#D3FB52]" />
            Activity Summary
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MiniStat label="Events Completed" value={stats.completedEvents} />
            <MiniStat label="Lessons Booked" value={stats.claimedLessons} />
            <MiniStat label="Jobs Completed" value={stats.completedStringJobs} />
            <MiniStat label="Active Members" value={stats.activeMembers} />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, color, bg }: {
  icon: React.ElementType; label: string; value: number; sub: string; color: string; bg: string;
}) {
  return (
    <div className="card p-5">
      <div className={`w-10 h-10 ${bg} rounded-xl flex items-center justify-center mb-3`}>
        <Icon size={20} className={color} />
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-white/70 text-sm font-medium">{label}</p>
      <p className="text-white/30 text-xs mt-1">{sub}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="p-4 bg-white/[0.03] rounded-lg text-center">
      <p className="text-xl font-bold text-[#D3FB52]">{value}</p>
      <p className="text-white/40 text-xs mt-1">{label}</p>
    </div>
  );
}

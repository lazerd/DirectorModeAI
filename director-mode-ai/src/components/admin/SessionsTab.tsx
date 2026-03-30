'use client';

import { useEffect, useState } from 'react';
import { Monitor, Clock, Zap } from 'lucide-react';
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import StatCard from './StatCard';

interface SessionsData {
  totalSessions: number;
  sessionsToday: number;
  avgDurationMs: number;
  sessionsOverTime: { date: string; sessions: number }[];
  uniqueVisitorsOverTime: { date: string; visitors: number }[];
}

const ADMIN_KEY = 'masterdirector!';

function formatDuration(ms: number): string {
  if (ms === 0) return '—';
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export default function SessionsTab() {
  const [data, setData] = useState<SessionsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/sessions', { headers: { 'X-Admin-Key': ADMIN_KEY } })
      .then((r) => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-[#D3FB52] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) return <p className="text-white/50 text-center py-10">Failed to load data.</p>;

  return (
    <div className="space-y-8">
      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title="Total Sessions" value={data.totalSessions} icon={Monitor} />
        <StatCard title="Avg Duration" value={formatDuration(data.avgDurationMs)} icon={Clock} color="#60a5fa" />
        <StatCard title="Sessions Today" value={data.sessionsToday} icon={Zap} color="#34d399" />
      </div>

      {/* Sessions Per Day */}
      <div className="rounded-xl border border-white/10 bg-[#002838] p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Sessions Per Day (30 Days)</h3>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.sessionsOverTime}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis
                dataKey="date"
                stroke="rgba(255,255,255,0.3)"
                tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }}
                tickFormatter={(v) => new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              />
              <YAxis stroke="rgba(255,255,255,0.3)" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ backgroundColor: '#001820', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff' }}
                labelFormatter={(v) => new Date(v).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              />
              <Bar dataKey="sessions" fill="#D3FB52" radius={[4, 4, 0, 0]} name="Sessions" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Unique Visitors Per Day */}
      <div className="rounded-xl border border-white/10 bg-[#002838] p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Unique Visitors Per Day (30 Days)</h3>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.uniqueVisitorsOverTime}>
              <defs>
                <linearGradient id="visitorGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis
                dataKey="date"
                stroke="rgba(255,255,255,0.3)"
                tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }}
                tickFormatter={(v) => new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              />
              <YAxis stroke="rgba(255,255,255,0.3)" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ backgroundColor: '#001820', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff' }}
                labelFormatter={(v) => new Date(v).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              />
              <Area type="monotone" dataKey="visitors" stroke="#60a5fa" fill="url(#visitorGradient)" strokeWidth={2} name="Unique Visitors" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

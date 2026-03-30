'use client';

import { useEffect, useState } from 'react';
import { Users, UserPlus, Activity, UserX } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import StatCard from './StatCard';

interface OverviewData {
  totalUsers: number;
  newThisWeek: number;
  activeUsers: number;
  dormantUsers: number;
  signupsOverTime: { date: string; count: number }[];
  roleBreakdown: Record<string, number>;
}

const ADMIN_KEY = 'masterdirector!';

export default function OverviewTab() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/overview', { headers: { 'X-Admin-Key': ADMIN_KEY } })
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

  const pieData = [
    { name: 'Active', value: data.activeUsers, color: '#34d399' },
    { name: 'Dormant', value: data.dormantUsers, color: '#6b7280' },
  ];

  const roleData = Object.entries(data.roleBreakdown).map(([role, count]) => ({
    name: role,
    value: count,
    color: role === 'admin' ? '#fb923c' : role === 'director' ? '#D3FB52' : role === 'coach' ? '#60a5fa' : role === 'stringer' ? '#c084fc' : '#94a3b8',
  }));

  return (
    <div className="space-y-8">
      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Users" value={data.totalUsers} icon={Users} />
        <StatCard title="New This Week" value={data.newThisWeek} icon={UserPlus} color="#60a5fa" />
        <StatCard title="Active (7d)" value={data.activeUsers} icon={Activity} color="#34d399" />
        <StatCard title="Dormant" value={data.dormantUsers} icon={UserX} color="#6b7280" />
      </div>

      {/* Signups Over Time */}
      <div className="rounded-xl border border-white/10 bg-[#002838] p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Signups Over Time (30 Days)</h3>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.signupsOverTime}>
              <defs>
                <linearGradient id="signupGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#D3FB52" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#D3FB52" stopOpacity={0} />
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
              <Area type="monotone" dataKey="count" stroke="#D3FB52" fill="url(#signupGradient)" strokeWidth={2} name="Signups" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bottom Row: Active vs Dormant + Roles */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-white/10 bg-[#002838] p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Active vs Dormant Users</h3>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                  {pieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Legend formatter={(value) => <span style={{ color: 'rgba(255,255,255,0.7)' }}>{value}</span>} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#002838] p-6">
          <h3 className="text-lg font-semibold text-white mb-4">User Roles</h3>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={roleData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                  {roleData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Legend formatter={(value) => <span style={{ color: 'rgba(255,255,255,0.7)' }}>{value}</span>} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

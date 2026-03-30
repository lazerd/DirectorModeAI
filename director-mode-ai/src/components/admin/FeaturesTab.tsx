'use client';

import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from 'recharts';

interface FeaturesData {
  topFeatures: { name: string; count: number; product: string | null; lastUsed: string }[];
  featureUsageOverTime: Record<string, unknown>[];
  top5Names: string[];
  topPages: { path: string; views: number }[];
}

const ADMIN_KEY = 'masterdirector!';

const PRODUCT_COLORS: Record<string, string> = {
  mixer: '#fb923c',
  lessons: '#60a5fa',
  stringing: '#c084fc',
  courtconnect: '#34d399',
  vault: '#2dd4bf',
};

const LINE_COLORS = ['#D3FB52', '#fb923c', '#60a5fa', '#c084fc', '#34d399'];

export default function FeaturesTab() {
  const [data, setData] = useState<FeaturesData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/features', { headers: { 'X-Admin-Key': ADMIN_KEY } })
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

  const hasFeatures = data.topFeatures.length > 0;
  const hasPages = data.topPages.length > 0;

  return (
    <div className="space-y-8">
      {/* Top Features Table */}
      <div className="rounded-xl border border-white/10 bg-[#002838] p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Top Features by Usage</h3>
        {hasFeatures ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-sm text-white/50 font-medium py-3 px-2">Feature</th>
                  <th className="text-left text-sm text-white/50 font-medium py-3 px-2">Product</th>
                  <th className="text-right text-sm text-white/50 font-medium py-3 px-2">Count</th>
                  <th className="text-right text-sm text-white/50 font-medium py-3 px-2">Last Used</th>
                </tr>
              </thead>
              <tbody>
                {data.topFeatures.map((feature, i) => (
                  <tr key={i} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="py-3 px-2 text-white font-medium">{feature.name.replace(/_/g, ' ')}</td>
                    <td className="py-3 px-2">
                      {feature.product && (
                        <span
                          className="text-xs font-medium px-2 py-1 rounded-full"
                          style={{
                            backgroundColor: `${PRODUCT_COLORS[feature.product] || '#6b7280'}20`,
                            color: PRODUCT_COLORS[feature.product] || '#6b7280',
                          }}
                        >
                          {feature.product}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-2 text-right text-white font-mono">{feature.count}</td>
                    <td className="py-3 px-2 text-right text-white/40 text-sm">
                      {new Date(feature.lastUsed).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-white/40 text-center py-6">No feature usage data yet. Features will appear here as users interact with the platform.</p>
        )}
      </div>

      {/* Feature Usage Over Time */}
      {hasFeatures && data.top5Names.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-[#002838] p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Feature Trends (14 Days)</h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.featureUsageOverTime}>
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
                <Legend formatter={(value) => <span style={{ color: 'rgba(255,255,255,0.7)' }}>{value.replace(/_/g, ' ')}</span>} />
                {data.top5Names.map((name, i) => (
                  <Line key={name} type="monotone" dataKey={name} stroke={LINE_COLORS[i]} strokeWidth={2} dot={false} name={name} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Page Views Ranking */}
      <div className="rounded-xl border border-white/10 bg-[#002838] p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Most Visited Pages</h3>
        {hasPages ? (
          <div className="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.topPages} layout="vertical" margin={{ left: 100 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis type="number" stroke="rgba(255,255,255,0.3)" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="path"
                  stroke="rgba(255,255,255,0.3)"
                  tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }}
                  width={100}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#001820', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff' }}
                />
                <Bar dataKey="views" fill="#D3FB52" radius={[0, 6, 6, 0]} name="Views" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-white/40 text-center py-6">No page view data yet. Page visits will appear here as users browse the site.</p>
        )}
      </div>
    </div>
  );
}

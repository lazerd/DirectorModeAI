'use client';

import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Trophy, GraduationCap, Wrench, Users, Database } from 'lucide-react';

interface ProductData {
  name: string;
  color: string;
  icon: string;
  userCount: number;
  totalRecords: number;
  details: Record<string, unknown>;
}

const ADMIN_KEY = 'masterdirector!';

const ICON_MAP: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  Trophy,
  GraduationCap,
  Wrench,
  Users,
  Database,
};

export default function ProductsTab() {
  const [products, setProducts] = useState<ProductData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/products', { headers: { 'X-Admin-Key': ADMIN_KEY } })
      .then((r) => r.json())
      .then((data) => setProducts(data.products || []))
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

  const chartData = products.map((p) => ({
    name: p.name,
    users: p.userCount,
    color: p.color,
  }));

  return (
    <div className="space-y-8">
      {/* Users per product bar chart */}
      <div className="rounded-xl border border-white/10 bg-[#002838] p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Users Per Product</h3>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="name" stroke="rgba(255,255,255,0.3)" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} />
              <YAxis stroke="rgba(255,255,255,0.3)" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ backgroundColor: '#001820', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff' }}
              />
              <Bar dataKey="users" radius={[6, 6, 0, 0]} name="Users">
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Product detail cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {products.map((product) => {
          const IconComponent = ICON_MAP[product.icon] || Users;
          return (
            <div
              key={product.name}
              className="rounded-xl border border-white/10 bg-[#002838] p-6 hover:border-white/20 transition-colors"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${product.color}20` }}>
                  <IconComponent className="w-5 h-5" style={{ color: product.color }} />
                </div>
                <div>
                  <h4 className="font-semibold text-white">{product.name}</h4>
                  <span className="text-sm text-white/40">{product.userCount} users</span>
                </div>
              </div>
              <div className="space-y-2">
                {Object.entries(product.details).map(([key, value]) => {
                  if (typeof value === 'object' && value !== null) {
                    return Object.entries(value as Record<string, number>).map(([subKey, subVal]) => (
                      <div key={subKey} className="flex justify-between text-sm">
                        <span className="text-white/50 capitalize">{subKey.replace(/_/g, ' ')}</span>
                        <span className="text-white font-medium">{subVal}</span>
                      </div>
                    ));
                  }
                  return (
                    <div key={key} className="flex justify-between text-sm">
                      <span className="text-white/50 capitalize">{key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim()}</span>
                      <span className="text-white font-medium">{String(value)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

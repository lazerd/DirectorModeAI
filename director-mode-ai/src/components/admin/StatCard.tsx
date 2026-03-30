'use client';

import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  color?: string;
}

export default function StatCard({ title, value, subtitle, icon: Icon, color = '#D3FB52' }: StatCardProps) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#002838] p-6">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-white/50 uppercase tracking-wide">{title}</span>
        <Icon className="w-5 h-5" style={{ color }} />
      </div>
      <div className="text-3xl font-bold text-white">{value}</div>
      {subtitle && <p className="text-sm text-white/40 mt-1">{subtitle}</p>}
    </div>
  );
}

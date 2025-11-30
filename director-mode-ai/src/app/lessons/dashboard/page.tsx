'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, Calendar, Users, Mail, Clock } from 'lucide-react';

export default function LessonsDashboardPage() {
  return (
    <div className="p-6 lg:p-8">
      <div className="page-enter">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="font-display text-2xl sm:text-3xl mb-1">My Calendar</h1>
            <p className="text-gray-500">Click any time slot to create an open lesson</p>
          </div>
          <Link href="/lessons/blast" className="btn btn-lessons">
            <Mail size={18} />
            Send Blast
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard icon={Users} label="Clients" value={0} color="primary" />
          <StatCard icon={Calendar} label="Open Slots" value={0} color="warning" />
          <StatCard icon={Clock} label="Claimed" value={0} color="success" />
          <StatCard icon={Mail} label="Pending Notify" value={0} color="purple" />
        </div>

        {/* Calendar Placeholder */}
        <div className="card p-8 text-center">
          <Calendar size={48} className="mx-auto text-gray-300 mb-4" />
          <h3 className="font-display text-lg mb-2">Calendar Coming Soon</h3>
          <p className="text-gray-500 mb-4">
            The full calendar interface is being built. Check back soon!
          </p>
          <Link href="/lessons/clients" className="btn btn-lessons">
            <Users size={18} />
            Manage Clients First
          </Link>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  color: 'primary' | 'success' | 'warning' | 'purple';
}) {
  const colors = {
    primary: 'bg-primary-light text-primary',
    success: 'bg-success-light text-success',
    warning: 'bg-warning-light text-warning',
    purple: 'bg-purple-100 text-purple-600',
  };

  return (
    <div className="card p-4 flex items-center gap-4">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${colors[color]}`}>
        <Icon size={22} />
      </div>
      <div>
        <div className="text-sm text-gray-500">{label}</div>
        <div className="text-2xl font-display">{value}</div>
      </div>
    </div>
  );
}

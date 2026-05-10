'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Trophy, Calendar, Users, AlertCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { format } from 'date-fns';

type League = {
  id: string;
  name: string;
  slug: string;
  start_date: string;
  end_date: string;
  status: string;
  created_at: string;
};

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  open: 'bg-green-100 text-green-700',
  closed: 'bg-yellow-100 text-yellow-700',
  running: 'bg-blue-100 text-blue-700',
  completed: 'bg-purple-100 text-purple-700',
  cancelled: 'bg-red-100 text-red-700',
};

export default function LeaguesListPage() {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      const { data, error: err } = await supabase
        .from('leagues')
        .select('id, name, slug, start_date, end_date, status, created_at')
        .eq('director_id', user.id)
        .order('created_at', { ascending: false });
      if (err) setError(err.message);
      else setLeagues((data as League[]) || []);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="font-semibold text-2xl sm:text-3xl mb-1">Leagues</h1>
          <p className="text-gray-500">Run summer compass-draw leagues with public signup pages</p>
        </div>
        <Link
          href="/mixer/leagues/new"
          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg font-medium hover:bg-orange-600"
        >
          <Plus size={18} />
          Create League
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 border border-red-200 rounded-lg p-3 mb-4 flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5" />
          <span className="text-sm">
            {error}
            {error.includes('schema cache') || error.includes('relation') ? (
              <div className="mt-1 text-xs text-red-600">
                The <code>leagues</code> table may not exist yet. Run{' '}
                <code>supabase/migrations/leagues.sql</code> in your Supabase SQL Editor.
              </div>
            ) : null}
          </span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : leagues.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Trophy size={48} className="mx-auto text-gray-300 mb-4" />
          <h3 className="font-semibold text-lg mb-2 text-gray-900">No leagues yet</h3>
          <p className="text-gray-500 mb-4">
            Create your first league to start accepting entries for a summer compass-draw event.
          </p>
          <Link
            href="/mixer/leagues/new"
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg font-medium hover:bg-orange-600"
          >
            <Plus size={18} />
            Create League
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {leagues.map((league) => (
            <Link
              key={league.id}
              href={`/mixer/leagues/${league.id}`}
              className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md transition-all"
            >
              <div className="flex items-start justify-between mb-3">
                <h3 className="font-semibold text-lg truncate text-gray-900">{league.name}</h3>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[league.status] || STATUS_STYLES.draft}`}
                >
                  {league.status}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
                <Calendar size={14} />
                <span>
                  {format(new Date(league.start_date), 'MM/dd/yyyy')} –{' '}
                  {format(new Date(league.end_date), 'MM/dd/yyyy')}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <Users size={12} />
                <code>/leagues/{league.slug}</code>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

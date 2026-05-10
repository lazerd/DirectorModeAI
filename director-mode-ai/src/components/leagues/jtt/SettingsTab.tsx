'use client';

import { useState } from 'react';
import { Save } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { JTTClub } from '@/app/mixer/leagues/[id]/jtt/page';

type League = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  start_date: string;
  end_date: string;
  status: string;
};

type Props = {
  league: League;
  clubs: JTTClub[];
  onRefresh: () => void;
};

export default function SettingsTab({ league, clubs, onRefresh }: Props) {
  const [draft, setDraft] = useState<Record<string, number>>(() => {
    const o: Record<string, number> = {};
    for (const c of clubs) o[c.id] = c.courts_available;
    return o;
  });
  const [saving, setSaving] = useState<string | null>(null);

  const saveClub = async (clubId: string) => {
    setSaving(clubId);
    const supabase = createClient();
    await supabase
      .from('league_clubs')
      .update({ courts_available: draft[clubId] ?? 0 })
      .eq('id', clubId);
    setSaving(null);
    onRefresh();
  };

  return (
    <div className="space-y-6">
      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-lg mb-3 text-gray-900">League</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-gray-500">Public URL</div>
            <div className="font-mono text-gray-900">/leagues/{league.slug}</div>
          </div>
          <div>
            <div className="text-gray-500">Dates</div>
            <div className="text-gray-900">
              {league.start_date} → {league.end_date}
            </div>
          </div>
          <div>
            <div className="text-gray-500">Status</div>
            <div className="text-gray-900">{league.status}</div>
          </div>
        </div>
        {league.description && (
          <p className="mt-4 text-sm text-gray-600 whitespace-pre-wrap">
            {league.description}
          </p>
        )}
      </section>

      <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <header className="px-4 py-3 border-b border-gray-200 bg-gray-50">
          <h2 className="font-semibold text-gray-900">Courts per club</h2>
          <p className="text-xs text-gray-500">
            Default number of courts available when the club hosts a match. You
            can override per matchup on its page if a specific day has fewer.
          </p>
        </header>
        <div className="divide-y divide-gray-100">
          {clubs
            .sort((a, b) => a.sort_order - b.sort_order)
            .map(club => {
              const changed = draft[club.id] !== club.courts_available;
              return (
                <div
                  key={club.id}
                  className="flex items-center justify-between px-4 py-3 text-sm"
                >
                  <div className="flex-1 text-gray-900 font-medium">{club.name}</div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={50}
                      value={draft[club.id] ?? 0}
                      onChange={e =>
                        setDraft(prev => ({
                          ...prev,
                          [club.id]: parseInt(e.target.value || '0', 10),
                        }))
                      }
                      className="w-16 px-2 py-1 border border-gray-300 rounded text-gray-900 text-right"
                    />
                    <span className="text-xs text-gray-500 w-12">courts</span>
                    <button
                      onClick={() => saveClub(club.id)}
                      disabled={!changed || saving === club.id}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-orange-500 text-white rounded text-xs font-medium hover:bg-orange-600 disabled:opacity-40"
                    >
                      <Save size={12} />
                      {saving === club.id ? 'Saving' : 'Save'}
                    </button>
                  </div>
                </div>
              );
            })}
        </div>
      </section>
    </div>
  );
}

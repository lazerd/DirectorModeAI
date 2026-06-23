'use client';

import { useState, useEffect } from 'react';
import { Save, Copy, Check } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { JTTClub } from '@/app/mixer/leagues/[id]/jtt/page';

type DivClub = { division_id: string; club_id: string; signup_token: string; division_name: string; division_short: string };

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
  const [copied, setCopied] = useState<string | null>(null);

  // RSVP settings + per-division signup links (loaded client-side)
  const [leadHours, setLeadHours] = useState<string>('');
  const [savingLead, setSavingLead] = useState(false);
  const [divClubs, setDivClubs] = useState<DivClub[]>([]);
  const clubName = (id: string) => clubs.find(c => c.id === id)?.name || '';

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data: lg } = await supabase.from('leagues').select('rsvp_confirmation_lead_hours').eq('id', league.id).maybeSingle();
      if (lg && (lg as { rsvp_confirmation_lead_hours: number | null }).rsvp_confirmation_lead_hours != null)
        setLeadHours(String((lg as { rsvp_confirmation_lead_hours: number }).rsvp_confirmation_lead_hours));
      const { data: divs } = await supabase.from('league_divisions').select('id, name, short_code').eq('league_id', league.id);
      const dl = (divs as Array<{ id: string; name: string; short_code: string }>) || [];
      if (dl.length) {
        const { data: dc } = await supabase.from('league_division_clubs').select('division_id, club_id, signup_token').in('division_id', dl.map(d => d.id));
        const rows = ((dc as Array<{ division_id: string; club_id: string; signup_token: string }>) || []).map(r => {
          const d = dl.find(x => x.id === r.division_id)!;
          return { ...r, division_name: d.name, division_short: d.short_code };
        });
        setDivClubs(rows);
      }
    })();
  }, [league.id]);

  const copyLink = (token: string, clubId: string) => {
    const url = `${window.location.origin}/leagues/roster/${token}`;
    navigator.clipboard.writeText(url);
    setCopied(clubId);
    setTimeout(() => setCopied(null), 2000);
  };
  const copyJoin = (token: string, key: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/leagues/join/${token}`);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const saveLead = async () => {
    setSavingLead(true);
    const supabase = createClient();
    const v = leadHours.trim() === '' ? null : Math.max(0, parseInt(leadHours, 10) || 0);
    await supabase.from('leagues').update({ rsvp_confirmation_lead_hours: v }).eq('id', league.id);
    setSavingLead(false);
  };

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

      {/* Coach Roster Links */}
      {clubs.some(c => c.roster_token) && (
        <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <header className="px-4 py-3 border-b border-gray-200 bg-gray-50">
            <h2 className="font-semibold text-gray-900">Coach roster links</h2>
            <p className="text-xs text-gray-500">
              Send each coach their unique link so they can add players to their own roster. No login required.
            </p>
          </header>
          <div className="divide-y divide-gray-100">
            {clubs
              .sort((a, b) => a.sort_order - b.sort_order)
              .filter(c => c.roster_token)
              .map(club => (
                <div
                  key={club.id}
                  className="flex items-center justify-between px-4 py-3 text-sm"
                >
                  <div>
                    <div className="font-medium text-gray-900">{club.name}</div>
                    <div className="text-xs text-gray-400 font-mono truncate max-w-md">
                      /leagues/roster/{club.roster_token}
                    </div>
                  </div>
                  <button
                    onClick={() => copyLink(club.roster_token!, club.id)}
                    className="inline-flex items-center gap-1 px-3 py-1 bg-orange-500 text-white rounded text-xs font-medium hover:bg-orange-600"
                  >
                    {copied === club.id ? (
                      <><Check size={12} /> Copied</>
                    ) : (
                      <><Copy size={12} /> Copy link</>
                    )}
                  </button>
                </div>
              ))}
          </div>
        </section>
      )}

      {/* Player signup links (one per division team) */}
      {divClubs.length > 0 && (
        <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <header className="px-4 py-3 border-b border-gray-200 bg-gray-50">
            <h2 className="font-semibold text-gray-900">Player signup links</h2>
            <p className="text-xs text-gray-500">
              Share each team&apos;s link with parents. They register their player and set match availability — no login, no Google Form.
            </p>
          </header>
          <div className="divide-y divide-gray-100">
            {divClubs
              .slice()
              .sort((a, b) => a.division_short.localeCompare(b.division_short) || clubName(a.club_id).localeCompare(clubName(b.club_id)))
              .map(dc => {
                const key = `${dc.division_id}-${dc.club_id}`;
                return (
                  <div key={key} className="flex items-center justify-between px-4 py-3 text-sm">
                    <div>
                      <div className="font-medium text-gray-900">{clubName(dc.club_id)} · {dc.division_name}</div>
                      <div className="text-xs text-gray-400 font-mono truncate max-w-md">/leagues/join/{dc.signup_token}</div>
                    </div>
                    <button
                      onClick={() => copyJoin(dc.signup_token, key)}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700"
                    >
                      {copied === key ? (<><Check size={12} /> Copied</>) : (<><Copy size={12} /> Copy link</>)}
                    </button>
                  </div>
                );
              })}
          </div>
        </section>
      )}

      {/* Automated RSVP confirmation emails */}
      <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <header className="px-4 py-3 border-b border-gray-200 bg-gray-50">
          <h2 className="font-semibold text-gray-900">Match confirmation emails</h2>
          <p className="text-xs text-gray-500">
            Automatically email each team a Yes/No availability summary before every match. Leave blank to turn off. (Sends once daily, so it goes out the morning it enters the window.)
          </p>
        </header>
        <div className="flex items-center gap-2 px-4 py-3 text-sm">
          <span className="text-gray-900 font-medium">Send</span>
          <input
            type="number" min={0} max={336} value={leadHours}
            onChange={e => setLeadHours(e.target.value)} placeholder="36"
            className="w-20 px-2 py-1 border border-gray-300 rounded text-gray-900 text-right"
          />
          <span className="text-gray-600">hours before each match</span>
          <button
            onClick={saveLead} disabled={savingLead}
            className="ml-auto inline-flex items-center gap-1 px-3 py-1 bg-orange-500 text-white rounded text-xs font-medium hover:bg-orange-600 disabled:opacity-40"
          >
            <Save size={12} /> {savingLead ? 'Saving' : 'Save'}
          </button>
        </div>
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

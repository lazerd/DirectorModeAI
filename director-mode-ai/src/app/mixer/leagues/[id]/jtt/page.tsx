'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Users,
  Calendar,
  Trophy,
  ListChecks,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import RostersTab from '@/components/leagues/jtt/RostersTab';
import MatchupsTab from '@/components/leagues/jtt/MatchupsTab';
import StandingsTab from '@/components/leagues/jtt/StandingsTab';

type League = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  start_date: string;
  end_date: string;
  status: string;
  format: 'individual' | 'team';
};

export type JTTClub = {
  id: string;
  league_id: string;
  name: string;
  short_code: string;
  color: string | null;
  sort_order: number;
};

export type JTTDivision = {
  id: string;
  league_id: string;
  name: string;
  short_code: string;
  day_of_week: number | null;
  start_time: string | null;
  end_time: string | null;
  line_format: 'singles_and_doubles' | 'singles_only' | 'doubles_only' | 'custom';
  sort_order: number;
};

export type JTTDivisionClub = {
  id: string;
  division_id: string;
  club_id: string;
};

export type JTTRoster = {
  id: string;
  division_id: string;
  club_id: string;
  player_name: string;
  player_email: string | null;
  player_phone: string | null;
  parent_name: string | null;
  parent_email: string | null;
  parent_phone: string | null;
  ntrp: number | null;
  utr: number | null;
  ladder_position: number | null;
  status: string;
};

export type JTTMatchup = {
  id: string;
  division_id: string;
  match_date: string;
  start_time: string | null;
  home_club_id: string;
  away_club_id: string;
  home_lines_won: number;
  away_lines_won: number;
  winner: 'home' | 'away' | 'tie' | null;
  status: string;
  notes: string | null;
};

export type JTTLine = {
  id: string;
  matchup_id: string;
  line_type: 'singles' | 'doubles';
  line_number: number;
  home_player1_id: string | null;
  home_player2_id: string | null;
  away_player1_id: string | null;
  away_player2_id: string | null;
  score: string | null;
  winner: 'home' | 'away' | null;
  status: string;
};

type Tab = 'matchups' | 'rosters' | 'standings' | 'settings';

export default function JTTLeaguePage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : (params.id as string);

  const [league, setLeague] = useState<League | null>(null);
  const [clubs, setClubs] = useState<JTTClub[]>([]);
  const [divisions, setDivisions] = useState<JTTDivision[]>([]);
  const [divisionClubs, setDivisionClubs] = useState<JTTDivisionClub[]>([]);
  const [rosters, setRosters] = useState<JTTRoster[]>([]);
  const [matchups, setMatchups] = useState<JTTMatchup[]>([]);
  const [lines, setLines] = useState<JTTLine[]>([]);
  const [tab, setTab] = useState<Tab>('matchups');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const supabase = createClient();
    const { data: leagueRow, error: lErr } = await supabase
      .from('leagues')
      .select('*')
      .eq('id', id)
      .single();
    if (lErr) {
      setError(lErr.message);
      setLoading(false);
      return;
    }
    setLeague(leagueRow as League);

    const [cRes, dRes, dcRes, rRes, mRes] = await Promise.all([
      supabase.from('league_clubs').select('*').eq('league_id', id).order('sort_order'),
      supabase.from('league_divisions').select('*').eq('league_id', id).order('sort_order'),
      supabase.from('league_division_clubs').select('*'),
      supabase.from('league_team_rosters').select('*'),
      supabase
        .from('league_team_matchups')
        .select('*')
        .order('match_date')
        .order('start_time', { nullsFirst: true }),
    ]);

    const clubsList = (cRes.data as JTTClub[]) || [];
    const divisionsList = (dRes.data as JTTDivision[]) || [];
    const matchupsList = (mRes.data as JTTMatchup[]) || [];
    const rostersList = (rRes.data as JTTRoster[]) || [];
    const dcList = (dcRes.data as JTTDivisionClub[]) || [];

    // Filter join-table rows to this league's divisions only (RLS should
    // handle this, but filtering in JS keeps things predictable)
    const leagueDivisionIds = new Set(divisionsList.map(d => d.id));
    setClubs(clubsList);
    setDivisions(divisionsList);
    setDivisionClubs(dcList.filter(dc => leagueDivisionIds.has(dc.division_id)));
    setRosters(rostersList.filter(r => leagueDivisionIds.has(r.division_id)));

    const leagueMatchups = matchupsList.filter(m => leagueDivisionIds.has(m.division_id));
    setMatchups(leagueMatchups);

    if (leagueMatchups.length > 0) {
      const { data: lRes } = await supabase
        .from('league_matchup_lines')
        .select('*')
        .in('matchup_id', leagueMatchups.map(m => m.id));
      setLines((lRes as JTTLine[]) || []);
    } else {
      setLines([]);
    }

    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-orange-500" size={24} />
      </div>
    );
  }

  if (error || !league) {
    return (
      <div className="p-4 sm:p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5" />
          <div>
            <p className="font-medium">Failed to load league.</p>
            {error && <p className="text-sm">{error}</p>}
          </div>
        </div>
      </div>
    );
  }

  if (league.format !== 'team') {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <p className="text-gray-600">
          This is an individual-format league.{' '}
          <Link href={`/mixer/leagues/${id}`} className="text-orange-600 underline">
            Open individual view →
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/mixer/leagues" className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft size={20} />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="font-semibold text-2xl text-gray-900 truncate">{league.name}</h1>
            <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full text-xs font-medium">
              JTT
            </span>
          </div>
          <p className="text-gray-500 text-sm">
            {clubs.length} clubs · {divisions.length} divisions · {matchups.length} matchups
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6 flex gap-1 overflow-x-auto">
        {[
          { id: 'matchups' as const, label: 'Matchups', icon: Calendar },
          { id: 'rosters' as const, label: 'Rosters', icon: Users },
          { id: 'standings' as const, label: 'Standings', icon: Trophy },
          { id: 'settings' as const, label: 'Settings', icon: ListChecks },
        ].map(t => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 border-b-2 font-medium text-sm whitespace-nowrap transition-colors ${
                active
                  ? 'border-orange-500 text-orange-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon size={16} />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'matchups' && (
        <MatchupsTab
          leagueId={id}
          clubs={clubs}
          divisions={divisions}
          matchups={matchups}
          lines={lines}
          onRefresh={fetchAll}
        />
      )}

      {tab === 'rosters' && (
        <RostersTab
          leagueId={id}
          clubs={clubs}
          divisions={divisions}
          divisionClubs={divisionClubs}
          rosters={rosters}
          onRefresh={fetchAll}
        />
      )}

      {tab === 'standings' && (
        <StandingsTab
          leagueSlug={league.slug}
          clubs={clubs}
          divisions={divisions}
          divisionClubs={divisionClubs}
          matchups={matchups}
          lines={lines}
          rosters={rosters}
        />
      )}

      {tab === 'settings' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold text-lg mb-3">Settings</h2>
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
        </div>
      )}
    </div>
  );
}

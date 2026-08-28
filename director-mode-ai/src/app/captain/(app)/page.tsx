import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { getCaptainAccess, listCaptainTeams, MAX_TEAMS_PER_CAPTAIN } from '@/lib/captain/access';
import NewTeamForm from '@/components/captain/NewTeamForm';
import { CLUB_TZ } from '@/lib/captain/clubTime';

export const dynamic = 'force-dynamic';

type Team = {
  id: string;
  name: string;
  level: string | null;
  league_type: string;
  captain_user_id: string;
};

const LEAGUE_LABEL: Record<string, string> = {
  usta_adult: 'USTA Adult',
  usta_combo: 'USTA Combo',
  usta_mixed: 'USTA Mixed',
  usta_trilevel: 'Tri-Level',
  flex: 'Flex / local',
};

export default async function CaptainHome() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/captain');

  const access = await getCaptainAccess(user.id);
  const teams = (await listCaptainTeams(user.id)) as unknown as Team[];
  // Co-captains pay nothing (spec §2) — they ride on the owner's subscription,
  // so only send someone to the paywall when they have no team at all.
  if (!access.active && teams.length === 0) redirect('/captain/subscribe');
  const owned = teams.filter((t) => t.captain_user_id === user.id).length;

  // Next match per team, so the list is useful at a glance.
  const db = await createServiceClient();
  const nextByTeam = new Map<string, { match_at: string; opponent: string | null }>();
  if (teams.length) {
    const { data: upcoming } = await db
      .from('captain_matches')
      .select('team_id, match_at, opponent')
      .in(
        'team_id',
        teams.map((t) => t.id),
      )
      .eq('status', 'scheduled')
      .gte('match_at', new Date().toISOString())
      .order('match_at');
    for (const m of (upcoming as { team_id: string; match_at: string; opponent: string | null }[]) ||
      []) {
      if (!nextByTeam.has(m.team_id)) nextByTeam.set(m.team_id, m);
    }
  }

  return (
    <div className="p-6 md:p-10 max-w-4xl">
      <h1 className="text-3xl font-display text-white">My Teams</h1>
      <p className="text-white/50 mt-1">
        {access.active ? (
          <>
            {access.rateType === 'club_linked'
              ? 'Club plan — $10/month'
              : 'Standalone — $20/month'}{' '}
            · {owned} of {MAX_TEAMS_PER_CAPTAIN} teams used
          </>
        ) : (
          'Co-captain — free'
        )}
      </p>

      <div className="mt-8 space-y-3">
        {teams.length === 0 && (
          <p className="text-white/50">
            No teams yet. Create one below and add your roster to get started.
          </p>
        )}

        {teams.map((t) => {
          const next = nextByTeam.get(t.id);
          return (
            <Link
              key={t.id}
              href={`/captain/${t.id}`}
              className="block rounded-2xl border border-white/[0.08] bg-[#002838] p-5 hover:border-[#D3FB52]/40 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-white font-semibold text-lg">{t.name}</div>
                  <div className="text-white/40 text-sm mt-0.5">
                    {LEAGUE_LABEL[t.league_type] || t.league_type}
                    {t.level ? ` · ${t.level}` : ''}
                    {t.captain_user_id !== user.id ? ' · co-captain' : ''}
                  </div>
                </div>
                <div className="text-right text-sm shrink-0">
                  {next ? (
                    <>
                      <div className="text-[#D3FB52] font-medium">
                        {/* Vercel runs UTC. Without an explicit zone a 9:30am
                            match renders as 4:30 PM. */}
                        {new Intl.DateTimeFormat('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          timeZone: CLUB_TZ,
                        }).format(new Date(next.match_at))}
                      </div>
                      <div className="text-white/40">{next.opponent || 'next match'}</div>
                    </>
                  ) : (
                    <div className="text-white/30">no matches scheduled</div>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {!access.active ? null : owned < MAX_TEAMS_PER_CAPTAIN ? (
        <NewTeamForm />
      ) : (
        <p className="mt-8 text-white/40 text-sm">
          Your subscription covers {MAX_TEAMS_PER_CAPTAIN} teams. Archive one to add another.
        </p>
      )}
    </div>
  );
}

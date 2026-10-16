/**
 * POST { league, slot, ntrp } -> turn one head-count group into a CaptainMode
 * team: the director owns it (they hand it to the volunteer captain later), and
 * everyone in the group becomes a player, with captain volunteers noted.
 * Idempotent on the team name: a second click returns the same team and only
 * adds people who weren't on it yet.
 */
import { NextResponse } from 'next/server';
import { buildGroups, staffCampaign, type ResponseRow } from '@/lib/seasonBuilder/staff';
import { NTRP_UNRATED, SLOT_SHORT, groupKey } from '@/lib/seasonBuilder/shared';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await staffCampaign(params.id);
  if ('error' in ctx) return ctx.error;
  const { db, campaign, user, club } = ctx;
  const b = await req.json().catch(() => ({}));
  const league = campaign.leagues.find((l) => l.key === b.league);
  if (!league || (b.slot !== 'day' && b.slot !== 'nights_weekends') || typeof b.ntrp !== 'string') {
    return NextResponse.json({ error: 'Pick a group.' }, { status: 400 });
  }
  const { data: rows } = await db.from('sb_responses').select('*').eq('campaign_id', campaign.id);
  const responses = (rows || []) as ResponseRow[];
  const group = buildGroups(campaign, responses).find((g) => g.key === groupKey(league.key, b.slot, b.ntrp));
  if (!group?.players.length) return NextResponse.json({ error: 'Nobody in that group yet.' }, { status: 400 });

  const level = b.ntrp === NTRP_UNRATED ? null : b.ntrp;
  const name = `${league.label} ${level ?? 'Unrated'}${league.slots.length > 1 ? ` ${SLOT_SHORT[b.slot as 'day']}` : ''} — ${campaign.title}`.slice(0, 120);

  let { data: team } = await db
    .from('captain_teams')
    .select('id, name')
    .eq('club_id', club.id)
    .eq('name', name)
    .eq('archived', false)
    .maybeSingle();
  if (!team) {
    const { data, error } = await db
      .from('captain_teams')
      .insert({
        captain_user_id: user.id,
        created_by: user.id,
        club_id: club.id,
        name,
        league_type: 'usta_adult',
        level: level ? `${league.label} ${level}` : league.label,
        season_start: campaign.season_start,
        season_end: campaign.season_end,
      })
      .select('id, name')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    team = data;
  }

  const { data: onTeam } = await db.from('captain_players').select('name, email').eq('team_id', team!.id);
  const have = new Set(((onTeam || []) as { name: string }[]).map((p) => p.name.trim().toLowerCase()));
  const byId = new Map(responses.map((r) => [r.id, r]));
  const toAdd = group.players
    .map((p) => byId.get(p.id)!)
    .filter((r) => r && !have.has(r.name.trim().toLowerCase()))
    .map((r, i) => ({
      team_id: team!.id,
      name: r.name,
      email: r.email,
      gender: r.gender === 'female' ? 'F' : r.gender === 'male' ? 'M' : null,
      rating: level ? Number(level) : null,
      rating_type: 'self',
      notes: [
        r.role === 'captain' ? 'Volunteered to captain.' : null,
        r.needs_renewal ? 'Needs to renew USTA before the season.' : null,
        r.notes,
      ].filter(Boolean).join(' ') || null,
      sort_order: (onTeam?.length || 0) + i,
    }));
  if (toAdd.length) {
    const { error } = await db.from('captain_players').insert(toAdd);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ team, added: toAdd.length, url: `/captain/${team!.id}` });
}

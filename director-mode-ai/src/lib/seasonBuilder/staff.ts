/**
 * Season Builder — staff-side helpers: auth + loading a campaign that belongs
 * to the director's active club, and the dashboard aggregation.
 */
import { NextResponse } from 'next/server';
import { requireStaffForClub } from '@/lib/courtsheet/routeAuth';
import { CAMPAIGN_COLS } from './server';
import { type Campaign, type Slot, NTRP_LEVELS, NTRP_UNRATED, groupKey } from './shared';

export async function staffCampaign(id: string, opts: { requireWrite?: boolean } = {}) {
  const ctx = await requireStaffForClub({ requireWrite: opts.requireWrite ?? true });
  if ('error' in ctx) return { error: ctx.error };
  const { data } = await ctx.db.from('sb_campaigns').select(CAMPAIGN_COLS).eq('id', id).maybeSingle();
  const campaign = data as Campaign | null;
  // Another club's campaign reads as "not found", never as "forbidden".
  if (!campaign || campaign.club_id !== ctx.club.id) {
    return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  }
  return { ...ctx, campaign };
}

export type ResponseRow = {
  id: string;
  invite_id: string | null;
  vault_player_id: string | null;
  name: string;
  email: string | null;
  interested: boolean;
  gender: 'female' | 'male' | null;
  ntrp: string | null;
  choices: { league: string; slot: Slot }[];
  role: 'captain' | 'play' | null;
  age_ok: boolean | null;
  usta_expires: string | null;
  usta_unknown: boolean;
  needs_renewal: boolean;
  notes: string | null;
  source: 'invite' | 'public';
  created_at: string;
  updated_at: string;
};

export type Group = {
  key: string;
  league: string;
  slot: Slot;
  ntrp: string;
  players: { id: string; name: string; role: 'captain' | 'play' | null; needs_renewal: boolean }[];
  captains: number;
};

const LEVEL_ORDER = [...NTRP_LEVELS, NTRP_UNRATED];

/** league × slot × level buckets, in campaign league order then level order. */
export function buildGroups(c: Campaign, rows: ResponseRow[]): Group[] {
  const map = new Map<string, Group>();
  for (const r of rows) {
    if (!r.interested) continue;
    for (const ch of r.choices || []) {
      const ntrp = r.ntrp || NTRP_UNRATED;
      const key = groupKey(ch.league, ch.slot, ntrp);
      if (!map.has(key)) map.set(key, { key, league: ch.league, slot: ch.slot, ntrp, players: [], captains: 0 });
      const g = map.get(key)!;
      g.players.push({ id: r.id, name: r.name, role: r.role, needs_renewal: r.needs_renewal });
      if (r.role === 'captain') g.captains++;
    }
  }
  const lIdx = (k: string) => c.leagues.findIndex((l) => l.key === k);
  const sIdx = (s: Slot) => (s === 'day' ? 0 : 1);
  return [...map.values()]
    .map((g) => ({ ...g, players: g.players.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => lIdx(a.league) - lIdx(b.league) || sIdx(a.slot) - sIdx(b.slot) || LEVEL_ORDER.indexOf(a.ntrp) - LEVEL_ORDER.indexOf(b.ntrp));
}

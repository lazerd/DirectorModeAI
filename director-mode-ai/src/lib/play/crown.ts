import 'server-only';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import type { GuestMixer } from '@/lib/mixer/guestMixer';

/**
 * King of the Court: every place has a reigning King (and Queen, when players
 * marked W). The crown = most match wins at that place over the last 30 days,
 * counted from finished CourtConnect events. No accounts yet, so a player is
 * their name as typed (case-insensitive).
 */
export const CROWN_DAYS = 30;

export const placeSlug = (loc: string | null | undefined) =>
  (loc ?? '').toLowerCase().replace(/\b(the|tennis|pickleball|courts?|club|park|center|centre)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

export interface CrownRow { key: string; name: string; wins: number; losses: number; gamesFor: number; gamesAgainst: number; events: number; gender?: 'male' | 'female' }
export interface Crown { slug: string; place: string; king: CrownRow | null; queen: CrownRow | null; ladder: CrownRow[]; events: number; since: string }

// A short in-memory cache: every poll of a game page asks for its place's crown.
const crownCache = new Map<string, { at: number; v: Crown | null }>();
export async function crownFor(location: string | null | undefined, opts: { excludeCode?: string } = {}): Promise<Crown | null> {
  const slug = placeSlug(location);
  if (!slug) return null;
  const ck = slug + '|' + (opts.excludeCode ?? '');
  const hit = crownCache.get(ck);
  if (hit && Date.now() - hit.at < 120000) return hit.v;
  const v = await crownForRaw(slug, opts, location ?? '');
  if (crownCache.size > 500) crownCache.clear();
  crownCache.set(ck, { at: Date.now(), v });
  return v;
}
async function crownForRaw(slug: string, opts: { excludeCode?: string }, location: string): Promise<Crown | null> {
  const since = new Date(Date.now() - CROWN_DAYS * 864e5).toISOString();
  const { data } = await getSupabaseAdmin().from('play_events')
    .select('code, location, state, updated_at').eq('status', 'done').gte('updated_at', since).not('location', 'is', null).limit(500);
  const evs = (data ?? []).filter((e) => placeSlug(e.location) === slug && e.code !== opts.excludeCode);
  const rows = new Map<string, CrownRow>();
  let place = location;
  for (const ev of evs) {
    place = ev.location || place;
    const m = (ev.state as { mixer?: GuestMixer })?.mixer;
    if (!m) continue;
    const seen = new Set<string>();
    const row = (id: string) => {
      const p = m.players.find((x) => x.id === id); if (!p) return null;
      const key = p.name.trim().toLowerCase();
      let r = rows.get(key);
      if (!r) { r = { key, name: p.name.trim(), wins: 0, losses: 0, gamesFor: 0, gamesAgainst: 0, events: 0 }; rows.set(key, r); }
      if (p.gender) r.gender = p.gender;
      if (!seen.has(key)) { seen.add(key); r.events++; }
      return r;
    };
    for (const rd of m.rounds) for (const x of rd.matches) {
      if (x.scoreA == null || x.scoreB == null) continue;
      for (const [ids, f, a] of [[x.teamA, x.scoreA, x.scoreB], [x.teamB, x.scoreB, x.scoreA]] as const) {
        for (const id of ids) { const r = row(id); if (!r) continue; r.gamesFor += f; r.gamesAgainst += a; if (f > a) r.wins++; else if (f < a) r.losses++; }
      }
    }
  }
  const ladder = [...rows.values()].filter((r) => r.wins + r.losses > 0)
    .sort((a, b) => b.wins - a.wins || (b.gamesFor - b.gamesAgainst) - (a.gamesFor - a.gamesAgainst) || a.name.localeCompare(b.name));
  return {
    slug, place, ladder, events: evs.length, since,
    king: ladder.find((r) => r.gender !== 'female') ?? null,
    queen: ladder.find((r) => r.gender === 'female') ?? null,
  };
}

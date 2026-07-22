// Per-surface recipient sources for the campaign engine. Each source verifies
// the caller OWNS the target (per-director scoping), then normalizes the
// surface into a CampaignData. Tournaments and leagues both reduce to the same
// "entries + matches" shape, so a single assembler serves both. Adding a new
// surface (quads, swim, lessons…) = one small function that produces the same
// normalized entries/matches and calls assemble().

import { getSupabaseAdmin } from '@/lib/supabase/admin';
import type { CampaignData, NudgePerson, Person, Outstanding } from './core';

export type SessionUser = { id: string; email?: string | null };
export type SourceResult = { ok: true; data: CampaignData } | { ok: false; status: number; error: string };

const APP = process.env.NEXT_PUBLIC_APP_URL || 'https://club.coachmode.ai';
const firstNameOf = (s: string) => (s || '').trim().split(/\s+/)[0] || 'there';
const contactBits = (email?: string | null, phone?: string | null) => [email, phone].filter(Boolean).join(' · ');

// Normalized shapes both surfaces map onto
type NEntry = {
  id: string;
  label: string;
  playerName: string;
  playerEmail: string | null;
  playerPhone: string | null;
  partnerName: string | null;
  partnerEmail: string | null;
  partnerPhone: string | null;
  completed: number;
};
type NMatch = { a: string | null; b: string | null; status: string }; // status: 'completed' | 'pending' | other

async function branding(user: SessionUser) {
  const admin = getSupabaseAdmin();
  const { data: p } = await admin
    .from('profiles')
    .select('organization_name, full_name, email')
    .eq('id', user.id)
    .maybeSingle();
  const row = (p as { organization_name?: string; full_name?: string; email?: string } | null) || null;
  const clubName = row?.organization_name?.trim() || 'Your Club';
  const senderName = row?.full_name?.trim() || clubName;
  const replyTo = user.email || row?.email || 'noreply@mail.coachmode.ai';
  return { clubName, senderName, replyTo };
}

const entryContact = (e: NEntry) =>
  [contactBits(e.playerEmail, e.playerPhone), e.partnerName ? contactBits(e.partnerEmail, e.partnerPhone) : '']
    .filter(Boolean)
    .join('  |  ');

/** Shared reduction: entries + matches → broadcast list + personalized nudge list + totals. */
function assemble(entries: NEntry[], matches: NMatch[]) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  for (const m of matches) {
    if (m.status !== 'completed') continue;
    if (m.a && byId.has(m.a)) byId.get(m.a)!.completed++;
    if (m.b && byId.has(m.b)) byId.get(m.b)!.completed++;
  }
  const playable = matches.filter((m) => m.status === 'pending' && m.a && m.b);

  // outstanding items per entry (opponent = the other entry)
  const outByEntry = new Map<string, Outstanding[]>();
  for (const m of playable) {
    const A = byId.get(m.a!);
    const B = byId.get(m.b!);
    if (!A || !B) continue;
    (outByEntry.get(A.id) || outByEntry.set(A.id, []).get(A.id)!).push({ label: `vs ${B.label}`, contact: entryContact(B) });
    (outByEntry.get(B.id) || outByEntry.set(B.id, []).get(B.id)!).push({ label: `vs ${A.label}`, contact: entryContact(A) });
  }

  // broadcast recipients (dedup by email)
  const everyoneMap = new Map<string, Person>();
  const addPerson = (email: string | null, name: string) => {
    if (!email) return;
    const k = email.toLowerCase();
    if (!everyoneMap.has(k)) everyoneMap.set(k, { email, firstName: firstNameOf(name) });
  };
  for (const e of entries) {
    addPerson(e.playerEmail, e.playerName);
    if (e.partnerEmail) addPerson(e.partnerEmail, e.partnerName || '');
  }

  // nudge recipients (dedup by email; accumulate outstanding across their entries)
  const nudgeMap = new Map<string, NudgePerson>();
  const addNudge = (email: string | null, name: string, played: number, items: Outstanding[]) => {
    if (!email || items.length === 0) return;
    const k = email.toLowerCase();
    let rec = nudgeMap.get(k);
    if (!rec) {
      rec = { email, firstName: firstNameOf(name), played, target: null, outstanding: [] };
      nudgeMap.set(k, rec);
    }
    rec.played = Math.max(rec.played ?? 0, played);
    rec.outstanding.push(...items);
  };
  for (const e of entries) {
    const items = outByEntry.get(e.id) || [];
    if (items.length === 0) continue;
    addNudge(e.playerEmail, e.playerName, e.completed, items);
    if (e.partnerEmail) addNudge(e.partnerEmail, e.partnerName || '', e.completed, items);
  }

  return {
    everyone: [...everyoneMap.values()],
    nudge: [...nudgeMap.values()].sort((a, b) => b.outstanding.length - a.outstanding.length),
    matchesTotal: matches.length,
    matchesCompleted: matches.filter((m) => m.status === 'completed').length,
    playable: playable.length,
  };
}

// ---------------- Tournament ----------------
export async function tournamentCampaign(eventId: string, user: SessionUser): Promise<SourceResult> {
  const admin = getSupabaseAdmin();
  const { data: ev } = await admin.from('events').select('id, name, slug, user_id').eq('id', eventId).maybeSingle();
  if (!ev) return { ok: false, status: 404, error: 'Event not found' };
  if ((ev as { user_id: string }).user_id !== user.id) return { ok: false, status: 403, error: 'Not authorized' };
  const e = ev as { name: string; slug: string };

  const { data: entryRows } = await admin
    .from('tournament_entries')
    .select('id, player_name, player_email, parent_email, player_phone, partner_name, partner_email, partner_phone')
    .eq('event_id', eventId);
  const { data: matchRows } = await admin
    .from('tournament_matches')
    .select('status, player1_id, player3_id')
    .eq('event_id', eventId);

  const entries: NEntry[] = ((entryRows as Array<Record<string, unknown>>) || []).map((r) => {
    const playerName = (r.player_name as string) || 'TBD';
    const partnerName = (r.partner_name as string) || null;
    return {
      id: r.id as string,
      label: partnerName ? `${playerName} / ${partnerName}` : playerName,
      playerName,
      playerEmail: (r.player_email as string) || (r.parent_email as string) || null,
      playerPhone: (r.player_phone as string) || null,
      partnerName,
      partnerEmail: (r.partner_email as string) || null,
      partnerPhone: (r.partner_phone as string) || null,
      completed: 0,
    };
  });
  const matches: NMatch[] = ((matchRows as Array<Record<string, unknown>>) || []).map((m) => ({
    a: (m.player1_id as string) || null,
    b: (m.player3_id as string) || null,
    status: m.status as string,
  }));

  const a = assemble(entries, matches);
  const b = await branding(user);
  const liveUrl = `${APP}/tournaments/${e.slug}`;
  return {
    ok: true,
    data: {
      ownerId: user.id,
      clubName: b.clubName,
      senderName: b.senderName,
      replyTo: b.replyTo,
      title: e.name,
      activityNoun: 'tournament',
      liveUrl,
      liveUrlLabel: '🎾 View standings & enter scores',
      deadlineNote: null,
      stats: [
        { label: 'Matches played', value: `${a.matchesCompleted} of ${a.matchesTotal}` },
        { label: 'Ready to play now', value: `${a.playable}` },
        { label: 'Players', value: `${a.everyone.length}` },
      ],
      everyone: a.everyone,
      nudge: a.nudge,
    },
  };
}

// ---------------- League (individual: RR / compass / single-elim) ----------------
export async function leagueCampaign(leagueId: string, user: SessionUser): Promise<SourceResult> {
  const admin = getSupabaseAdmin();
  const { data: lg } = await admin.from('leagues').select('id, name, slug, director_id, format').eq('id', leagueId).maybeSingle();
  if (!lg) return { ok: false, status: 404, error: 'League not found' };
  if ((lg as { director_id: string }).director_id !== user.id) return { ok: false, status: 403, error: 'Not authorized' };
  const l = lg as { name: string; slug: string };

  const { data: entryRows } = await admin
    .from('league_entries')
    .select('id, captain_name, captain_email, captain_phone, partner_name, partner_email, partner_phone')
    .eq('league_id', leagueId);
  const entries: NEntry[] = ((entryRows as Array<Record<string, unknown>>) || []).map((r) => {
    const playerName = (r.captain_name as string) || 'TBD';
    const partnerName = (r.partner_name as string) || null;
    return {
      id: r.id as string,
      label: partnerName ? `${playerName} / ${partnerName}` : playerName,
      playerName,
      playerEmail: (r.captain_email as string) || null,
      playerPhone: (r.captain_phone as string) || null,
      partnerName,
      partnerEmail: (r.partner_email as string) || null,
      partnerPhone: (r.partner_phone as string) || null,
      completed: 0,
    };
  });

  // league_matches has no league_id — scope via the league's own entry ids
  const entryIds = entries.map((e) => e.id);
  let matches: NMatch[] = [];
  if (entryIds.length) {
    const { data: matchRows } = await admin
      .from('league_matches')
      .select('entry_a_id, entry_b_id, status, winner_entry_id')
      .in('entry_a_id', entryIds);
    matches = ((matchRows as Array<Record<string, unknown>>) || []).map((m) => ({
      a: (m.entry_a_id as string) || null,
      b: (m.entry_b_id as string) || null,
      status: m.winner_entry_id || m.status === 'completed' ? 'completed' : (m.status as string),
    }));
  }

  const a = assemble(entries, matches);
  const b = await branding(user);
  return {
    ok: true,
    data: {
      ownerId: user.id,
      clubName: b.clubName,
      senderName: b.senderName,
      replyTo: b.replyTo,
      title: l.name,
      activityNoun: 'league',
      liveUrl: `${APP}/leagues/${l.slug}`,
      liveUrlLabel: '🎾 View standings & report scores',
      deadlineNote: null,
      stats: [
        { label: 'Matches played', value: `${a.matchesCompleted} of ${a.matchesTotal}` },
        { label: 'Ready to play now', value: `${a.playable}` },
        { label: 'Players / teams', value: `${entries.length}` },
      ],
      everyone: a.everyone,
      nudge: a.nudge,
    },
  };
}

export async function resolveCampaign(surface: string, targetId: string, user: SessionUser): Promise<SourceResult> {
  if (surface === 'tournament') return tournamentCampaign(targetId, user);
  if (surface === 'league') return leagueCampaign(targetId, user);
  return { ok: false, status: 400, error: `Unknown surface: ${surface}` };
}

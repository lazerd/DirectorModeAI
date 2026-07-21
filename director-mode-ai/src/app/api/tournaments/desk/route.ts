/**
 * Tournament Desk Hub API.
 *
 * GET  /api/tournaments/desk[?events=id,id]
 *   Aggregates a director's running tournament events onto ONE view: every
 *   event's matches with player names, court, and status. Default (no ?events)
 *   = all of the director's running tournament events, so Gold + Silver + 12U +
 *   13U + Open all load together. Courts are shared across events.
 *
 * POST /api/tournaments/desk   { action, ... }
 *   'assign'     { matchId, court }        → put a match on a court (or court=null to clear)
 *   'autofill'   { eventIds, courtCount }  → fill open courts with the next ready matches
 *   'set_courts' { eventIds, num }         → set court count on the given events
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { syncPlacementPlayoffs } from '@/lib/tournamentPlayoffs';

const TOURNAMENT_FORMATS = [
  'rr-singles', 'rr-doubles', 'single-elim-singles', 'single-elim-doubles',
  'fmlc-singles', 'fmlc-doubles', 'ffic-singles', 'ffic-doubles',
  'compass-singles', 'compass-doubles',
];

type Admin = ReturnType<typeof getSupabaseAdmin>;

// Short division tag from an event name. Prefer the DRAW name (Gold/Silver) when
// present — it's what distinguishes two draws of the same age group — otherwise
// fall back to the age/category. e.g. "JTT 10U Season-End — Gold …" → "Gold",
// "JTT 12U …" → "12U".
function divisionTag(name: string): string {
  const draw = name.match(/\b(Gold|Silver|Bronze)\b/i);
  if (draw) return draw[0];
  const cat = name.match(/\b(10U|12U|13&O|13U|14U|16U|18U|Open|Boys|Girls)\b/i);
  if (cat) return cat[0];
  return name.split(/[—·|-]/)[0].trim().slice(0, 12) || name.slice(0, 12);
}

async function ownedRunningEventIds(admin: Admin, userId: string, requested: string[] | null): Promise<string[]> {
  let q = admin
    .from('events')
    .select('id, user_id, public_status, match_format')
    .eq('user_id', userId)
    .in('match_format', TOURNAMENT_FORMATS);
  if (requested && requested.length) q = q.in('id', requested);
  else q = q.eq('public_status', 'running');
  const { data } = await q;
  return (data || []).map((e: any) => e.id as string);
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const requested = searchParams.get('events')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null;

  const admin = getSupabaseAdmin();
  const ids = await ownedRunningEventIds(admin, user.id, requested);
  if (ids.length === 0) return NextResponse.json({ events: [], matches: [], courtCount: 8 });

  // Make sure every 2-pool RR event has its placement bracket built out (TBD
  // until each pool finishes) BEFORE we read matches, so the desk shows the full
  // count including playoffs. Idempotent + best-effort — never blocks the board.
  await Promise.all(ids.map((id) => syncPlacementPlayoffs(admin, id).catch(() => null)));

  const [{ data: evs }, { data: entries }, { data: matches }] = await Promise.all([
    admin.from('events').select('id, name, num_courts, match_format, public_status, event_date').in('id', ids),
    admin.from('tournament_entries').select('id, event_id, player_name, partner_name, checked_in_at, position').in('event_id', ids),
    admin.from('tournament_matches')
      .select('id, event_id, bracket, round, slot, court, status, score, score_token, match_type, player1_id, player2_id, player3_id, player4_id')
      .in('event_id', ids),
  ]);

  const nameById = new Map<string, { player_name: string; partner_name: string | null }>();
  for (const e of entries || []) nameById.set((e as any).id, e as any);
  const checkedInIds = new Set<string>();
  // Check-in is OPT-IN per event: it only gates court assignment once the
  // director has checked in at least one player for that event. Until then
  // every match flows as before (nothing is held back) — so turning this on
  // never disrupts an event already in progress.
  const eventUsesCheckin = new Set<string>();
  for (const e of entries || []) {
    if ((e as any).checked_in_at) {
      checkedInIds.add((e as any).id);
      eventUsesCheckin.add((e as any).event_id);
    }
  }
  const matchCheckedIn = (m: any): boolean => {
    if (!eventUsesCheckin.has(m.event_id)) return true; // check-in not in use yet
    const slots = [m.player1_id, m.player2_id, m.player3_id, m.player4_id].filter(Boolean) as string[];
    if (slots.length === 0) return false;
    return slots.every((id) => checkedInIds.has(id));
  };
  const side = (p1: string | null, p2: string | null): string => {
    const a = p1 ? nameById.get(p1) : null;
    const b = p2 ? nameById.get(p2) : null;
    if (!a && !b) return 'TBD';
    const one = a ? (a.partner_name && !b ? `${a.player_name} + ${a.partner_name}` : a.player_name) : '';
    const two = b ? b.player_name : '';
    return [one, two].filter(Boolean).join(' + ') || 'TBD';
  };

  const eventList = (evs || []).map((e: any) => ({
    id: e.id, name: e.name, division: divisionTag(e.name),
    num_courts: e.num_courts ?? 8, match_format: e.match_format, public_status: e.public_status,
    event_date: e.event_date ?? null,
  }));
  const divByEvent = new Map(eventList.map((e) => [e.id, e.division]));

  // Per event, the highest round among "within-pool" (non-cross-pool) matches is
  // the RR ceiling; anything above it for an rr event is a placement playoff.
  const maxMainRound = new Map<string, number>();
  for (const m of matches || []) {
    if ((m as any).bracket === 'main') {
      const cur = maxMainRound.get((m as any).event_id) ?? 0;
      maxMainRound.set((m as any).event_id, Math.max(cur, (m as any).round));
    }
  }

  const matchList = (matches || []).map((m: any) => ({
    id: m.id,
    event_id: m.event_id,
    division: divByEvent.get(m.event_id) ?? '',
    round: m.round,
    slot: m.slot,
    court: m.court,
    status: m.status,
    score: m.score,
    score_token: m.score_token,
    sideA: side(m.player1_id, m.player2_id),
    sideB: side(m.player3_id, m.player4_id),
    ready: m.status !== 'completed' && !!m.player1_id && !!m.player3_id,
    checkedIn: matchCheckedIn(m),
  }));

  // Check-in roster for the desk — every entry that's actually in the draw, so
  // the director can mark players present as they arrive.
  const checkins = (entries || [])
    .filter((e: any) => e.position === 'in_draw' || e.position == null)
    .map((e: any) => ({
      id: e.id,
      event_id: e.event_id,
      division: divByEvent.get(e.event_id) ?? '',
      name: e.partner_name ? `${e.player_name} / ${e.partner_name}` : e.player_name,
      checked_in: !!e.checked_in_at,
    }))
    .sort((a, b) => a.division.localeCompare(b.division) || a.name.localeCompare(b.name));

  const courtCount = Math.max(8, ...eventList.map((e) => e.num_courts || 0));
  return NextResponse.json({ events: eventList, matches: matchList, checkins, courtCount });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const action = body?.action;
  const admin = getSupabaseAdmin();

  const ownsEvent = async (eventId: string): Promise<boolean> => {
    const { data } = await admin.from('events').select('user_id').eq('id', eventId).maybeSingle();
    return !!data && (data as any).user_id === user.id;
  };

  if (action === 'assign') {
    const matchId = String(body.matchId ?? '');
    const court = body.court === null ? null : String(body.court);
    const { data: m } = await admin.from('tournament_matches').select('id, event_id, status').eq('id', matchId).maybeSingle();
    if (!m) return NextResponse.json({ error: 'Match not found' }, { status: 404 });
    if (!(await ownsEvent((m as any).event_id))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    const status = court === null ? 'pending' : ((m as any).status === 'completed' ? 'completed' : 'in_progress');
    const { error } = await admin.from('tournament_matches').update({ court, status }).eq('id', matchId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === 'check_in') {
    const entryId = String(body.entryId ?? '');
    const value = body.value !== false; // default → check in
    const { data: en } = await admin
      .from('tournament_entries')
      .select('id, event_id')
      .eq('id', entryId)
      .maybeSingle();
    if (!en) return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    if (!(await ownsEvent((en as any).event_id))) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }
    const { error } = await admin
      .from('tournament_entries')
      .update({ checked_in_at: value ? new Date().toISOString() : null })
      .eq('id', entryId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === 'set_status') {
    const eventId = String(body.eventId ?? '');
    const status = String(body.status ?? '');
    if (status !== 'completed' && status !== 'cancelled') {
      return NextResponse.json({ error: 'status must be completed or cancelled' }, { status: 400 });
    }
    if (!(await ownsEvent(eventId))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    const { error } = await admin.from('events').update({ public_status: status }).eq('id', eventId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === 'set_courts') {
    const eventIds: string[] = Array.isArray(body.eventIds) ? body.eventIds.map(String) : [];
    const num = Number(body.num);
    if (!Number.isInteger(num) || num < 1 || num > 40) return NextResponse.json({ error: 'num must be 1–40' }, { status: 400 });
    const owned: string[] = [];
    for (const id of eventIds) if (await ownsEvent(id)) owned.push(id);
    if (owned.length) await admin.from('events').update({ num_courts: num, court_names: null }).in('id', owned);
    return NextResponse.json({ ok: true, updated: owned.length });
  }

  if (action === 'autofill') {
    const eventIds: string[] = Array.isArray(body.eventIds) ? body.eventIds.map(String) : [];
    // The actual courts in use (labels/numbers), e.g. ["5".."15"], not just a count.
    const courts: string[] = Array.isArray(body.courts) ? body.courts.map(String) : [];
    const owned: string[] = [];
    for (const id of eventIds) if (await ownsEvent(id)) owned.push(id);
    if (!owned.length || !courts.length) return NextResponse.json({ ok: true, assigned: 0 });

    const [{ data: matches }, { data: ents }] = await Promise.all([
      admin.from('tournament_matches')
        .select('id, event_id, round, slot, court, status, player1_id, player2_id, player3_id, player4_id')
        .in('event_id', owned),
      admin.from('tournament_entries').select('id, event_id, checked_in_at').in('event_id', owned),
    ]);
    const list = (matches || []) as any[];
    const checkedIn = new Set<string>();
    const usesCheckin = new Set<string>();
    for (const e of (ents || []) as any[]) if (e.checked_in_at) { checkedIn.add(e.id); usesCheckin.add(e.event_id); }
    // Opt-in per event: only gate once someone's been checked in for that event.
    const allPresent = (m: any): boolean => {
      if (!usesCheckin.has(m.event_id)) return true;
      const slots = [m.player1_id, m.player2_id, m.player3_id, m.player4_id].filter(Boolean) as string[];
      return slots.length > 0 && slots.every((id) => checkedIn.has(id));
    };

    // Courts currently taken by any non-completed assigned match.
    const taken = new Set<string>();
    for (const m of list) if (m.status !== 'completed' && m.court) taken.add(String(m.court));
    const openCourts: string[] = courts.filter((c) => !taken.has(String(c)));

    // Ready = pending, both players known AND checked in, no court yet. Order by round then slot.
    const ready = list
      .filter((m) => m.status === 'pending' && !m.court && m.player1_id && m.player3_id && allPresent(m))
      .sort((a, b) => a.round - b.round || a.slot - b.slot);

    let assigned = 0;
    for (const court of openCourts) {
      const next = ready[assigned];
      if (!next) break;
      await admin.from('tournament_matches').update({ court, status: 'in_progress' }).eq('id', next.id);
      assigned++;
    }
    return NextResponse.json({ ok: true, assigned });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

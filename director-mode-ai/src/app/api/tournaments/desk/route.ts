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

  const [{ data: evs }, { data: entries }, { data: matches }] = await Promise.all([
    admin.from('events').select('id, name, num_courts, match_format, public_status, event_date').in('id', ids),
    admin.from('tournament_entries').select('id, event_id, player_name, partner_name').in('event_id', ids),
    admin.from('tournament_matches')
      .select('id, event_id, bracket, round, slot, court, status, score, score_token, match_type, player1_id, player2_id, player3_id, player4_id')
      .in('event_id', ids),
  ]);

  const nameById = new Map<string, { player_name: string; partner_name: string | null }>();
  for (const e of entries || []) nameById.set((e as any).id, e as any);
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
  }));

  const courtCount = Math.max(8, ...eventList.map((e) => e.num_courts || 0));
  return NextResponse.json({ events: eventList, matches: matchList, courtCount });
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
    const courtCount = Math.max(1, Math.min(40, Number(body.courtCount) || 8));
    const owned: string[] = [];
    for (const id of eventIds) if (await ownsEvent(id)) owned.push(id);
    if (!owned.length) return NextResponse.json({ ok: true, assigned: 0 });

    const { data: matches } = await admin.from('tournament_matches')
      .select('id, event_id, round, slot, court, status, player1_id, player3_id')
      .in('event_id', owned);
    const list = (matches || []) as any[];

    // Courts currently taken by any non-completed assigned match.
    const taken = new Set<string>();
    for (const m of list) if (m.status !== 'completed' && m.court) taken.add(String(m.court));
    const openCourts: string[] = [];
    for (let c = 1; c <= courtCount; c++) if (!taken.has(String(c))) openCourts.push(String(c));

    // Ready = pending, both players known, no court yet. Order by round then slot.
    const ready = list
      .filter((m) => m.status === 'pending' && !m.court && m.player1_id && m.player3_id)
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

/**
 * Pre-season intake — the login-free player surface.
 *
 *   GET  /api/captain/intake/[token]  — this player's current answers + the
 *                                       teammate list they can rank
 *   POST /api/captain/intake/[token]  — { return_side, court_limit,
 *                                         unavailable_days[], partner_ids[], notes }
 *
 * No auth: the token IS the credential, same contract as the availability
 * surface. Every write re-derives team_id from the token, so a player can only
 * ever rank their own teammates and can never touch another team's rows.
 *
 * partner_ids is an ordered array — position 0 is their first choice. It maps
 * onto captain_partner_prefs.rank (1-based), which the lineup generator already
 * reads, so nothing downstream needs to change.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SIDES = ['deuce', 'ad', 'either'];
const MAX_PARTNERS = 5;

type PlayerRow = {
  id: string;
  team_id: string;
  name: string;
  active: boolean;
  return_side: string | null;
  court_limit: string | null;
  unavailable_days: string[] | null;
  notes: string | null;
  intake_completed_at: string | null;
};

async function loadPlayer(token: string) {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from('captain_players')
    .select(
      'id, team_id, name, active, return_side, court_limit, unavailable_days, notes, intake_completed_at',
    )
    .eq('player_token', token)
    .maybeSingle();
  return { admin, player: (data as PlayerRow | null) ?? null };
}

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const { admin, player } = await loadPlayer(params.token);
  if (!player || !player.active) {
    return NextResponse.json({ error: 'That link is no longer active.' }, { status: 404 });
  }

  const [{ data: team }, { data: mates }, { data: prefs }] = await Promise.all([
    admin.from('captain_teams').select('name').eq('id', player.team_id).maybeSingle(),
    admin
      .from('captain_players')
      .select('id, name')
      .eq('team_id', player.team_id)
      .eq('active', true)
      .neq('id', player.id)
      .order('name'),
    admin
      .from('captain_partner_prefs')
      .select('preferred_player_id, rank')
      .eq('player_id', player.id)
      .order('rank'),
  ]);

  return NextResponse.json({
    playerName: player.name,
    teamName: (team as { name: string } | null)?.name ?? 'your team',
    teammates: mates || [],
    days: DAYS,
    current: {
      return_side: player.return_side,
      court_limit: player.court_limit,
      unavailable_days: player.unavailable_days || [],
      notes: player.notes,
      partner_ids: ((prefs as { preferred_player_id: string }[]) || []).map(
        (p) => p.preferred_player_id,
      ),
      completed_at: player.intake_completed_at,
    },
  });
}

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const { admin, player } = await loadPlayer(params.token);
  if (!player || !player.active) {
    return NextResponse.json({ error: 'That link is no longer active.' }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    return_side?: string;
    court_limit?: string;
    unavailable_days?: unknown;
    partner_ids?: unknown;
    notes?: string;
  };

  const side =
    typeof body.return_side === 'string' && SIDES.includes(body.return_side)
      ? body.return_side === 'either'
        ? null
        : body.return_side
      : null;

  const days = Array.isArray(body.unavailable_days)
    ? (body.unavailable_days as unknown[]).filter(
        (d): d is string => typeof d === 'string' && DAYS.includes(d),
      )
    : [];

  const courtLimit =
    typeof body.court_limit === 'string' && body.court_limit.trim()
      ? body.court_limit.trim().slice(0, 60)
      : null;

  const notes =
    typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim().slice(0, 500) : null;

  // Only teammates on THIS team are rankable — the token decides the team, not
  // anything the caller sent.
  const { data: mates } = await admin
    .from('captain_players')
    .select('id')
    .eq('team_id', player.team_id)
    .eq('active', true)
    .neq('id', player.id);
  const valid = new Set(((mates as { id: string }[]) || []).map((m) => m.id));

  const wanted = Array.isArray(body.partner_ids) ? (body.partner_ids as unknown[]) : [];
  const partnerIds: string[] = [];
  for (const id of wanted) {
    if (typeof id !== 'string' || !valid.has(id) || partnerIds.includes(id)) continue;
    partnerIds.push(id);
    if (partnerIds.length >= MAX_PARTNERS) break;
  }

  const { error: upErr } = await admin
    .from('captain_players')
    .update({
      return_side: side,
      court_limit: courtLimit,
      unavailable_days: days,
      notes,
      intake_completed_at: new Date().toISOString(),
    })
    .eq('id', player.id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // Replace this player's ranking wholesale — re-submitting is an edit, not an append.
  await admin.from('captain_partner_prefs').delete().eq('player_id', player.id);
  if (partnerIds.length) {
    const rows = partnerIds.map((pid, i) => ({
      team_id: player.team_id,
      player_id: player.id,
      preferred_player_id: pid,
      rank: i + 1,
    }));
    const { error: prefErr } = await admin.from('captain_partner_prefs').insert(rows);
    if (prefErr) return NextResponse.json({ error: prefErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ranked: partnerIds.length });
}

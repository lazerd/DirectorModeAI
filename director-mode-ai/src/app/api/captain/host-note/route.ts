/**
 * Notes from the club hosting a match.
 *   GET   ?team_id=…[&match_id=…]   — pending notes (for one match, or the whole
 *          team including ones not matched yet) + the team's forwarding address.
 *   POST  { team_id, match_id, text } — read a pasted email into a pending note.
 *   PATCH { team_id, note_id, action: 'apply', match_id, fields } — write the
 *          (captain-edited) fields onto the match.
 *   PATCH { team_id, note_id, action: 'assign', match_id } — file an unmatched note.
 *   PATCH { team_id, note_id, action: 'dismiss' }
 *
 * Nothing is sent from here. Applying fills the fields the lineup email,
 * calendar invite and day-before reminder already print.
 */
import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireTeam, isError } from '@/lib/captain/server';
import { CLUB_TZ, resolveClubTimeZone } from '@/lib/captain/clubTime';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { inboundAddress, newInboundToken, type HostNoteFields, type MatchLite } from '@/lib/captain/hostNote';
import {
  fileHostNote,
  HostNoteError,
  MATCH_FIELDS,
  withSuggestion,
  type FiledNote,
} from '@/lib/captain/hostNoteServer';

export const dynamic = 'force-dynamic';

const FIELD_KEYS: (keyof HostNoteFields)[] = [
  'location',
  'arrival_note',
  'opposing_captain_name',
  'opposing_captain_email',
  'opposing_captain_phone',
];

/** The team's forwarding address, minting its token the first time it is asked for. */
async function teamAddress(
  db: SupabaseClient,
  team: { id: string; name: string; inbound_token?: string | null },
): Promise<string> {
  if (team.inbound_token) return inboundAddress(team.inbound_token);
  for (let i = 0; i < 3; i++) {
    const token = newInboundToken(team.name, randomBytes(8).toString('hex'));
    const { error } = await db
      .from('captain_teams')
      .update({ inbound_token: token })
      .eq('id', team.id)
      .is('inbound_token', null);
    if (!error) {
      const { data } = await db.from('captain_teams').select('inbound_token').eq('id', team.id).single();
      return inboundAddress((data as { inbound_token: string }).inbound_token);
    }
  }
  throw new Error('Could not create the forwarding address.');
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const ctx = await requireTeam(q.get('team_id') || '');
  if (isError(ctx)) return ctx.error;
  const { team, teamId } = ctx;
  // requireTeam() has authorised the caller for this team; every query below
  // is scoped to teamId. ctx.db carries the caller's RLS, and host notes have
  // no user policies, so they are read and written with the admin client.
  const db = getSupabaseAdmin();
  const matchId = q.get('match_id');

  let notesQ = db
    .from('captain_host_notes')
    .select('id, match_id, source, from_email, subject, created_at, extracted')
    .eq('team_id', teamId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (matchId) notesQ = notesQ.eq('match_id', matchId);

  const [{ data: notes }, { data: matches }, timeZone] = await Promise.all([
    notesQ,
    db.from('captain_matches').select(MATCH_FIELDS).eq('team_id', teamId).order('match_at'),
    resolveClubTimeZone(getSupabaseAdmin(), team.club_id).catch(() => CLUB_TZ),
  ]);
  const ms = (matches as MatchLite[] | null) ?? [];

  return NextResponse.json({
    address: await teamAddress(db, team as { id: string; name: string; inbound_token?: string | null }),
    notes: ((notes as FiledNote[] | null) ?? []).map((n) => withSuggestion(n, ms, timeZone)),
    matches: ms.map((m) => ({ id: m.id, match_at: m.match_at, opponent: m.opponent, is_home: m.is_home })),
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { team_id?: string; match_id?: string; text?: string };
  const ctx = await requireTeam(body.team_id || '');
  if (isError(ctx)) return ctx.error;
  const text = (body.text || '').trim();
  if (text.length < 20) {
    return NextResponse.json({ error: 'Paste the whole email from the host club.' }, { status: 400 });
  }
  try {
    const note = await fileHostNote(getSupabaseAdmin(), ctx.team, {
      source: 'paste',
      body: text,
      matchId: body.match_id,
    });
    return NextResponse.json({ note });
  } catch (e) {
    const err = e as HostNoteError;
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}

export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    team_id?: string;
    note_id?: string;
    action?: 'apply' | 'assign' | 'dismiss';
    match_id?: string;
    fields?: Partial<HostNoteFields>;
  };
  const ctx = await requireTeam(body.team_id || '');
  if (isError(ctx)) return ctx.error;
  const { teamId } = ctx;
  const db = getSupabaseAdmin(); // see GET: authorised above, scoped by teamId below

  const { data: note } = await db
    .from('captain_host_notes')
    .select('id, match_id, status')
    .eq('id', body.note_id || '')
    .eq('team_id', teamId)
    .maybeSingle();
  if (!note) return NextResponse.json({ error: 'Note not found.' }, { status: 404 });

  if (body.action === 'dismiss') {
    await db
      .from('captain_host_notes')
      .update({ status: 'dismissed', resolved_at: new Date().toISOString() })
      .eq('id', note.id);
    return NextResponse.json({ ok: true });
  }

  // Both remaining actions name a match, which must be this team's.
  const { data: match } = await db
    .from('captain_matches')
    .select('id, lineup_email_sent_at, host_update_sent_at')
    .eq('id', body.match_id || '')
    .eq('team_id', teamId)
    .maybeSingle();
  if (!match) return NextResponse.json({ error: 'Match not found.' }, { status: 404 });

  if (body.action === 'assign') {
    await db.from('captain_host_notes').update({ match_id: match.id }).eq('id', note.id);
    return NextResponse.json({ ok: true });
  }

  if (body.action !== 'apply') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });

  const patch: Record<string, string | null> = {};
  for (const k of FIELD_KEYS) {
    if (body.fields && k in body.fields) {
      const v = body.fields[k];
      patch[k] = typeof v === 'string' && v.trim() ? v.trim() : null;
    }
  }
  const { error } = await db
    .from('captain_matches')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', match.id)
    .eq('team_id', teamId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await db
    .from('captain_host_notes')
    .update({ status: 'applied', match_id: match.id, resolved_at: new Date().toISOString() })
    .eq('id', note.id);

  return NextResponse.json({
    ok: true,
    // The lineup email already went out, so players only get these details if
    // the captain sends an update.
    lineup_already_sent: !!match.lineup_email_sent_at,
  });
}

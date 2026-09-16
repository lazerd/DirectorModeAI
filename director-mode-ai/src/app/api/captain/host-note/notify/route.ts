/**
 * Send the host club's details to the players in this match's lineup.
 *   POST { team_id, match_id, preview? }
 *
 * For when the lineup email already went out before the host's note arrived.
 * Only the players on this match's courts get it — the rest of the roster
 * isn't going. `preview: true` renders exactly what sending would, and the UI
 * always previews first.
 */
import { NextResponse } from 'next/server';
import { requireTeam, isError } from '@/lib/captain/server';
import { CLUB_TZ, resolveClubTimeZone } from '@/lib/captain/clubTime';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { hostUpdateEmail, sendAll, type MatchInfo, type Recipient } from '@/lib/captain/emails';
import { recipientRows, withSecondContact } from '@/lib/captain/teamContacts';
import { CreditLimitError, creditLimitResponse } from '@/lib/email';

export const dynamic = 'force-dynamic';

type Player = {
  id: string;
  name: string;
  email: string | null;
  player_token: string;
  contact2_name: string | null;
  contact2_email: string | null;
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { team_id?: string; match_id?: string; preview?: boolean };
  const ctx = await requireTeam(body.team_id || '');
  if (isError(ctx)) return ctx.error;
  const { db, team, teamId } = ctx;

  const { data: m } = await db
    .from('captain_matches')
    .select('*')
    .eq('id', body.match_id || '')
    .eq('team_id', teamId)
    .maybeSingle();
  if (!m) return NextResponse.json({ error: 'Match not found.' }, { status: 404 });

  const [{ data: courts }, { data: players }, timeZone] = await Promise.all([
    db
      .from('captain_lineups')
      .select('court_number, court_type, player1_id, player2_id')
      .eq('match_id', m.id)
      .order('court_number'),
    db
      .from('captain_players')
      .select('id, name, email, player_token, contact2_name, contact2_email')
      .eq('team_id', teamId)
      .eq('active', true),
    resolveClubTimeZone(getSupabaseAdmin(), team.club_id).catch(() => CLUB_TZ),
  ]);

  const courtOf = new Map<string, string>();
  for (const c of (courts as { court_number: number; court_type: string; player1_id: string | null; player2_id: string | null }[]) ?? []) {
    const label = `${c.court_type === 'singles' ? 'Singles' : 'Doubles'} ${c.court_number}`;
    for (const pid of [c.player1_id, c.player2_id]) if (pid && !courtOf.has(pid)) courtOf.set(pid, label);
  }
  const playing = ((players as Player[] | null) ?? []).filter((p) => courtOf.has(p.id) && p.email);
  if (!playing.length) {
    return NextResponse.json({ error: 'Nobody in this lineup has an email address yet.' }, { status: 400 });
  }

  const info: MatchInfo = {
    id: m.id,
    matchAt: m.match_at,
    isHome: m.is_home,
    opponent: m.opponent || null,
    location: m.location || null,
    arrivalNote: m.arrival_note || null,
    opposingCaptainName: m.opposing_captain_name || null,
    opposingCaptainPhone: m.opposing_captain_phone || null,
  };
  const recipientOf = (p: Player): Recipient => ({ playerId: p.id, name: p.name, email: p.email as string, token: p.player_token });
  const payloads = playing.flatMap((p) =>
    withSecondContact(hostUpdateEmail(team.name, info, recipientOf(p), courtOf.get(p.id) ?? null, timeZone), p.contact2_email),
  );

  if (body.preview) {
    const sample = payloads[0];
    return NextResponse.json({
      subject: sample.subject,
      html: sample.html,
      count: payloads.length,
      sample_for: playing[0].name,
      recipients: playing.flatMap(recipientRows),
    });
  }

  try {
    const results = await sendAll(team.captain_user_id, payloads);
    const sent = results.filter((r) => r?.sent).length;
    await db
      .from('captain_matches')
      .update({ host_update_sent_at: new Date().toISOString() })
      .eq('id', m.id)
      .eq('team_id', teamId);
    return NextResponse.json({ ok: true, sent, total: payloads.length });
  } catch (e) {
    if (e instanceof CreditLimitError) return creditLimitResponse(e);
    throw e;
  }
}

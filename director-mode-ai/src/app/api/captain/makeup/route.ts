/**
 * Rain-out makeup poll — the captain's side.
 *   GET  ?team_id&match_id — the poll (if any) + every rostered player's answers
 *   POST { team_id, match_id, options: iso[], note?, audience: 'lineup'|'rest',
 *          player_ids?, preview? }
 *     Saves the options, then emails `audience`: 'lineup' = the players who were
 *     in this match's lineup (first call), 'rest' = everyone else on the roster.
 *     `player_ids` narrows either send to specific people. `preview:true`
 *     returns the exact payload without sending.
 *
 * Options can't be changed once anyone has voted — votes point at an option by
 * index, so editing the list would silently move answers to a different date.
 */
import { NextResponse } from 'next/server';
import { requireTeam, isError } from '@/lib/captain/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { makeupPollEmail, sendAll, type MatchInfo } from '@/lib/captain/emails';
import { withSecondContact, recipientRows } from '@/lib/captain/teamContacts';
import { CreditLimitError } from '@/lib/billing';
import { creditLimitResponse } from '@/lib/email';

type Player = {
  id: string;
  name: string;
  email: string | null;
  player_token: string;
  contact2_name: string | null;
  contact2_email: string | null;
};
type Poll = {
  id: string;
  options: { at: string }[];
  note: string | null;
  lineup_sent_at: string | null;
  rest_sent_at: string | null;
};

async function lineupIds(matchId: string): Promise<Set<string>> {
  const { data } = await getSupabaseAdmin()
    .from('captain_lineups')
    .select('player1_id, player2_id')
    .eq('match_id', matchId);
  const ids = new Set<string>();
  for (const r of (data as { player1_id: string | null; player2_id: string | null }[]) || []) {
    if (r.player1_id) ids.add(r.player1_id);
    if (r.player2_id) ids.add(r.player2_id);
  }
  return ids;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const teamId = url.searchParams.get('team_id') || '';
  const matchId = url.searchParams.get('match_id') || '';
  const ctx = await requireTeam(teamId);
  if (isError(ctx)) return ctx.error;
  const admin = getSupabaseAdmin();

  const { data: poll } = await admin
    .from('captain_makeup_polls')
    .select('id, options, note, lineup_sent_at, rest_sent_at')
    .eq('match_id', matchId)
    .eq('team_id', teamId)
    .maybeSingle();

  const [{ data: players }, inLineup] = await Promise.all([
    admin
      .from('captain_players')
      .select('id, name, email')
      .eq('team_id', teamId)
      .eq('active', true)
      .eq('is_sub', false)
      .order('name'),
    lineupIds(matchId),
  ]);

  let votes: { player_id: string; option_index: number; answer: string }[] = [];
  if (poll) {
    const { data } = await admin
      .from('captain_makeup_votes')
      .select('player_id, option_index, answer')
      .eq('poll_id', (poll as Poll).id);
    votes = (data as typeof votes) || [];
  }

  return NextResponse.json({
    poll: poll || null,
    players: ((players as { id: string; name: string; email: string | null }[]) || []).map((p) => ({
      ...p,
      in_lineup: inLineup.has(p.id),
      votes: Object.fromEntries(
        votes.filter((v) => v.player_id === p.id).map((v) => [v.option_index, v.answer]),
      ),
    })),
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    team_id?: string;
    match_id?: string;
    options?: string[];
    note?: string;
    audience?: 'lineup' | 'rest';
    player_ids?: string[];
    preview?: boolean;
  };
  if (!body.team_id || !body.match_id) {
    return NextResponse.json({ error: 'team_id and match_id are required.' }, { status: 400 });
  }
  if (body.audience !== 'lineup' && body.audience !== 'rest') {
    return NextResponse.json({ error: "audience must be 'lineup' or 'rest'." }, { status: 400 });
  }
  const options = (body.options || []).filter((o) => !Number.isNaN(Date.parse(o)));
  if (options.length < 1 || options.length > 4) {
    return NextResponse.json({ error: 'Give 1–4 makeup dates.' }, { status: 400 });
  }

  const ctx = await requireTeam(body.team_id);
  if (isError(ctx)) return ctx.error;
  const { team, teamId } = ctx;
  const admin = getSupabaseAdmin();

  const { data: matchRow } = await admin
    .from('captain_matches')
    .select('*')
    .eq('id', body.match_id)
    .eq('team_id', teamId)
    .maybeSingle();
  if (!matchRow) return NextResponse.json({ error: 'Match not found.' }, { status: 404 });
  const match = matchRow as Record<string, unknown>;

  // Save (or re-use) the poll. Options are frozen once anyone has voted.
  const normalized = options.map((o) => new Date(o).toISOString());
  const { data: existing } = await admin
    .from('captain_makeup_polls')
    .select('id, options, note, lineup_sent_at, rest_sent_at')
    .eq('match_id', body.match_id)
    .maybeSingle();
  let poll = existing as Poll | null;
  const sameOptions =
    !!poll &&
    poll.options.length === normalized.length &&
    poll.options.every((o, i) => new Date(o.at).toISOString() === normalized[i]);

  if (poll && !sameOptions) {
    const { count } = await admin
      .from('captain_makeup_votes')
      .select('id', { count: 'exact', head: true })
      .eq('poll_id', poll.id);
    if (count) {
      return NextResponse.json(
        { error: 'Players have already answered these dates — the options can no longer be changed.' },
        { status: 409 },
      );
    }
  }
  if (!poll || !sameOptions || (body.note ?? null) !== poll.note) {
    const { data: saved, error } = await admin
      .from('captain_makeup_polls')
      .upsert(
        {
          team_id: teamId,
          match_id: body.match_id,
          options: normalized.map((at) => ({ at })),
          note: (body.note || '').trim() || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'match_id' },
      )
      .select('id, options, note, lineup_sent_at, rest_sent_at')
      .single();
    if (error || !saved) return NextResponse.json({ error: error?.message || 'Could not save.' }, { status: 500 });
    poll = saved as Poll;
  }

  // Who gets it.
  const inLineup = await lineupIds(body.match_id);
  if (body.audience === 'lineup' && !inLineup.size) {
    return NextResponse.json({ error: 'This match has no saved lineup to send to.' }, { status: 400 });
  }
  const { data: players } = await admin
    .from('captain_players')
    .select('id, name, email, player_token, contact2_name, contact2_email')
    .eq('team_id', teamId)
    .eq('active', true)
    .eq('is_sub', false);
  let roster = ((players as Player[]) || []).filter((p) =>
    body.audience === 'lineup' ? inLineup.has(p.id) : !inLineup.has(p.id),
  );
  if (body.player_ids?.length) {
    const want = new Set(body.player_ids);
    roster = roster.filter((p) => want.has(p.id));
  }
  roster = roster.filter((p) => !!p.email);
  if (!roster.length) return NextResponse.json({ ok: true, sent: 0, count: 0 });

  const info: MatchInfo = {
    id: match.id as string,
    matchAt: match.match_at as string,
    isHome: match.is_home as boolean,
    opponent: (match.opponent as string) || null,
    location: (match.location as string) || null,
  };
  const payloads = roster.flatMap((p) =>
    withSecondContact(
      makeupPollEmail(
        team.name,
        info,
        poll!.id,
        normalized,
        { playerId: p.id, name: p.name, email: p.email as string, token: p.player_token },
        { note: poll!.note, firstCall: body.audience === 'lineup' },
      ),
      p.contact2_email,
    ),
  );

  if (body.preview) {
    return NextResponse.json({
      preview: true,
      subject: payloads[0].subject,
      html: payloads[0].html,
      sample_for: roster[0].name,
      count: payloads.length,
      recipients: roster.flatMap(recipientRows),
    });
  }

  try {
    const results = await sendAll(ctx.userId, payloads);
    await admin
      .from('captain_makeup_polls')
      .update(
        body.audience === 'lineup'
          ? { lineup_sent_at: new Date().toISOString() }
          : { rest_sent_at: new Date().toISOString() },
      )
      .eq('id', poll.id);
    return NextResponse.json({ ok: true, sent: results.filter((r) => r.sent).length });
  } catch (err) {
    if (err instanceof CreditLimitError) return creditLimitResponse(err);
    return NextResponse.json({ error: 'Could not send the poll.' }, { status: 502 });
  }
}

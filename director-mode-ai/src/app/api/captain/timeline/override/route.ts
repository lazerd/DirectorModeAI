/**
 * One match's exception to the team rule.
 *   PATCH { team_id, match_id, kind, skip?, send_at?, subject_override?, intro_override? }
 *
 * Pass `reset: true` to drop the exception and fall back to the team default.
 */
import { NextResponse } from 'next/server';
import { requireTeam, isError } from '@/lib/captain/server';
import { EMAIL_KINDS, type EmailKind } from '@/lib/captain/timeline';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    team_id?: string;
    match_id?: string;
    kind?: EmailKind;
    skip?: boolean;
    send_at?: string | null;
    subject_override?: string | null;
    intro_override?: string | null;
    reset?: boolean;
  };

  if (!body.team_id || !body.match_id || !body.kind || !EMAIL_KINDS.includes(body.kind)) {
    return NextResponse.json(
      { error: 'team_id, match_id and a valid kind are required.' },
      { status: 400 },
    );
  }

  const ctx = await requireTeam(body.team_id);
  if (isError(ctx)) return ctx.error;
  const { db, teamId } = ctx;

  // The match must belong to this team — never trust a match_id from the client.
  const { data: match } = await db
    .from('captain_matches')
    .select('id, match_at')
    .eq('id', body.match_id)
    .eq('team_id', teamId)
    .maybeSingle();
  if (!match) return NextResponse.json({ error: 'Match not found.' }, { status: 404 });

  if (body.reset) {
    await db
      .from('captain_email_overrides')
      .delete()
      .eq('match_id', body.match_id)
      .eq('kind', body.kind);
    return NextResponse.json({ ok: true, reset: true });
  }

  if (body.send_at) {
    const when = new Date(body.send_at);
    if (Number.isNaN(when.getTime())) {
      return NextResponse.json({ error: 'That send time is not a valid date.' }, { status: 400 });
    }
    if (when.getTime() > new Date((match as { match_at: string }).match_at).getTime()) {
      return NextResponse.json(
        { error: 'That would send the email after the match has started.' },
        { status: 400 },
      );
    }
  }

  const { data: existing } = await db
    .from('captain_email_overrides')
    .select('skip, send_at, subject_override, intro_override')
    .eq('match_id', body.match_id)
    .eq('kind', body.kind)
    .maybeSingle();

  const current = (existing as {
    skip: boolean;
    send_at: string | null;
    subject_override: string | null;
    intro_override: string | null;
  } | null) || { skip: false, send_at: null, subject_override: null, intro_override: null };

  const row = {
    team_id: teamId,
    match_id: body.match_id,
    kind: body.kind,
    skip: body.skip ?? current.skip,
    send_at: body.send_at === undefined ? current.send_at : body.send_at,
    subject_override:
      body.subject_override === undefined ? current.subject_override : trimOrNull(body.subject_override),
    intro_override:
      body.intro_override === undefined ? current.intro_override : trimOrNull(body.intro_override),
    updated_at: new Date().toISOString(),
  };

  const { error } = await db
    .from('captain_email_overrides')
    .upsert(row, { onConflict: 'match_id,kind' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, override: row });
}

function trimOrNull(v: string | null): string | null {
  const t = (v || '').trim();
  return t ? t : null;
}

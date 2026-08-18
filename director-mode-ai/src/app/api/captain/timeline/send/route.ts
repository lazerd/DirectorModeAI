/**
 * Preview or send one scheduled email ahead of its slot.
 *   POST { team_id, match_id, kind, preview? }
 *
 * `preview:true` returns the exact payload the cron would build — same
 * function, same overrides, same recipient list — without sending. Sending
 * stamps the match so the cron will not send it again.
 */
import { NextResponse } from 'next/server';
import { requireTeam, isError } from '@/lib/captain/server';
import { sendAll } from '@/lib/captain/emails';
import { EMAIL_KINDS, KIND_META, type EmailKind } from '@/lib/captain/timeline';
import {
  loadTeamEmailContext,
  payloadsFor,
  recipientsFor,
  MATCH_COLUMNS,
} from '@/lib/captain/timelineSend';
import { CreditLimitError } from '@/lib/billing';
import { creditLimitResponse } from '@/lib/email';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    team_id?: string;
    match_id?: string;
    kind?: EmailKind;
    preview?: boolean;
  };

  if (!body.team_id || !body.match_id || !body.kind || !EMAIL_KINDS.includes(body.kind)) {
    return NextResponse.json(
      { error: 'team_id, match_id and a valid kind are required.' },
      { status: 400 },
    );
  }

  const ctx = await requireTeam(body.team_id);
  if (isError(ctx)) return ctx.error;
  const { db, team, teamId } = ctx;

  const { data: matchRow } = await db
    .from('captain_matches')
    .select(MATCH_COLUMNS)
    .eq('id', body.match_id)
    .eq('team_id', teamId)
    .maybeSingle();
  if (!matchRow) return NextResponse.json({ error: 'Match not found.' }, { status: 404 });

  const emailCtx = await loadTeamEmailContext(
    db,
    { id: team.id, name: team.name, captain_user_id: team.captain_user_id },
    [matchRow as unknown as Record<string, unknown>],
  );

  const payloads = payloadsFor(body.kind, emailCtx, body.match_id);
  if (!payloads.length) {
    return NextResponse.json(
      {
        error: KIND_META[body.kind].needsLineup
          ? 'Build the lineup first — this email lists the court assignments.'
          : 'There is nobody to send this to right now.',
      },
      { status: 400 },
    );
  }

  const recipients = recipientsFor(body.kind, emailCtx, body.match_id);

  if (body.preview) {
    return NextResponse.json({
      preview: true,
      subject: payloads[0].subject,
      html: payloads[0].html,
      sample_for: recipients[0]?.name,
      count: payloads.length,
      recipients,
    });
  }

  try {
    const results = await sendAll(team.captain_user_id, payloads);
    await db
      .from('captain_matches')
      .update({ [KIND_META[body.kind].sentColumn]: new Date().toISOString() })
      .eq('id', body.match_id);

    const sent = results.filter((r) => r.sent).length;
    return NextResponse.json({
      ok: true,
      sent,
      failed: results.length - sent,
      // Name who missed out — a bare count gives a captain nothing to act on.
      failedNames: results
        .map((r, i) => (r.sent ? null : recipients[i]?.name))
        .filter(Boolean) as string[],
    });
  } catch (err) {
    if (err instanceof CreditLimitError) return creditLimitResponse(err);
    return NextResponse.json({ error: 'Could not send that email.' }, { status: 502 });
  }
}

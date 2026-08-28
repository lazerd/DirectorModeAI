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
    /**
     * Send to these players only. Used when one substitution happened and the
     * other 22 people don't need another email about it.
     */
    player_ids?: string[];
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

  const only = Array.isArray(body.player_ids)
    ? body.player_ids.filter((id): id is string => typeof id === 'string' && !!id)
    : null;
  const targeted = !!only?.length;

  const payloads = payloadsFor(body.kind, emailCtx, body.match_id, only);
  if (!payloads.length) {
    return NextResponse.json(
      {
        error: targeted
          ? 'Nobody to send to — those players may have no email address on the roster.'
          : KIND_META[body.kind].needsLineup
            ? 'Build the lineup first — this email lists the court assignments.'
            : 'There is nobody to send this to right now.',
      },
      { status: 400 },
    );
  }

  const recipients = recipientsFor(body.kind, emailCtx, body.match_id, only);

  if (body.preview) {
    return NextResponse.json({
      preview: true,
      subject: payloads[0].subject,
      html: payloads[0].html,
      sample_for: recipients[0]?.name,
      count: payloads.length,
      recipients,
      targeted,
    });
  }

  /**
   * A targeted send deliberately leaves the match's sent-stamp alone.
   *
   * That stamp answers "has the TEAM seen this lineup", and it is what stops
   * the cron mailing it again. Telling one late addition about her court has
   * not answered that question either way, so writing it would silently cancel
   * the scheduled send to everyone else — the exact failure that looks like the
   * app quietly losing an email.
   */
  if (targeted) {
    try {
      const results = await sendAll(team.captain_user_id, payloads);
      const sent = results.filter((r) => r.sent).length;
      return NextResponse.json({
        ok: true,
        sent,
        targeted: true,
        failed: results.length - sent,
        failedNames: results
          .map((r, i) => (r.sent ? null : recipients[i]?.name))
          .filter(Boolean) as string[],
      });
    } catch (err) {
      if (err instanceof CreditLimitError) return creditLimitResponse(err);
      return NextResponse.json({ error: 'Could not send that email.' }, { status: 502 });
    }
  }

  /**
   * Claim the send BEFORE putting mail in flight, not after.
   *
   * Sending 24 players takes ~25s (Resend is paced at 2/sec), and the stamp
   * used to land only once that finished. A captain who clicked Send three
   * times while nothing visibly happened got three passes of the guard and the
   * whole roster got three copies of the same lineup — which is exactly what
   * happened on 2026-08-21. Stamping first makes the second click a no-op.
   *
   * Scoped to a two-minute window so a deliberate re-send later still works;
   * this is a double-click guard, not a one-send-ever lock.
   */
  const sentColumn = KIND_META[body.kind].sentColumn as string;
  const previousStamp = (matchRow as unknown as Record<string, unknown>)[sentColumn] as string | null;
  const claimCutoff = new Date(Date.now() - 2 * 60_000).toISOString();

  if (previousStamp && previousStamp > claimCutoff) {
    return NextResponse.json(
      {
        error: 'That email just went out. Give it a minute before sending it again.',
        code: 'recently_sent',
        sentAt: previousStamp,
      },
      { status: 409 },
    );
  }

  const { data: claimed } = await db
    .from('captain_matches')
    .update({ [sentColumn]: new Date().toISOString() })
    .eq('id', body.match_id)
    .or(`${sentColumn}.is.null,${sentColumn}.lt.${claimCutoff}`)
    .select('id')
    .maybeSingle();

  // Someone else claimed it between our read and our write.
  if (!claimed) {
    return NextResponse.json(
      {
        error: 'That email just went out. Give it a minute before sending it again.',
        code: 'recently_sent',
      },
      { status: 409 },
    );
  }

  try {
    const results = await sendAll(team.captain_user_id, payloads);

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
    // Nothing went out, so give the claim back or the captain can never retry.
    await db
      .from('captain_matches')
      .update({ [sentColumn]: previousStamp })
      .eq('id', body.match_id);
    if (err instanceof CreditLimitError) return creditLimitResponse(err);
    return NextResponse.json({ error: 'Could not send that email.' }, { status: 502 });
  }
}

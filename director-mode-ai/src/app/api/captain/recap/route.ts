/**
 * The post-match recap to the TEAM.
 *   POST  { match_id, preview?, subject?, body?, save_template? }
 *   PATCH { team_id, outcome, subject, body }   — save one template
 *
 * `preview: true` renders the exact email a send would produce, for a real
 * recipient, and sends nothing. Everything the captain can edit is a TEMPLATE
 * ({team}, {opponent}, {score}, …) so the same words can be saved once and
 * reused for the rest of the season; the preview shows it filled in.
 *
 * Which template is used is decided by the scores already saved for the match:
 * a win pulls the win template, a loss the loss one. That is the whole feature
 * — nobody writes a cheerful recap after losing, and nobody should have to pick
 * a tone from a dropdown twenty minutes after a match.
 *
 * The match context (scoreboard, season record, next fixture) is assembled by
 * loadRecapContext, shared with the AI drafting route so what the model writes
 * about and what the email prints can never disagree.
 */
import { NextResponse } from 'next/server';
import { requireTeam, isError } from '@/lib/captain/server';
import { createServiceClient } from '@/lib/supabase/server';
import { matchRecapEmail, sendAll } from '@/lib/captain/emails';
import { CLUB_TZ } from '@/lib/captain/clubTime';
import {
  loadRecapContext,
  recapVars,
  RECAP_MATCH_COLUMNS,
  type RecapPlayer,
} from '@/lib/captain/recapData';
import {
  DEFAULT_RECAP,
  RECAP_OUTCOMES,
  renderRecap,
  templateFor,
  type RecapOutcome,
} from '@/lib/captain/recap';
import { CreditLimitError } from '@/lib/billing';
import { creditLimitResponse } from '@/lib/email';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    match_id?: string;
    preview?: boolean;
    subject?: string;
    body?: string;
    save_template?: boolean;
  };
  if (!body.match_id) return NextResponse.json({ error: 'match_id is required.' }, { status: 400 });

  const db = await createServiceClient();
  const { data: matchRow } = await db
    .from('captain_matches')
    .select(RECAP_MATCH_COLUMNS)
    .eq('id', body.match_id)
    .maybeSingle();
  if (!matchRow) return NextResponse.json({ error: 'Match not found.' }, { status: 404 });

  const auth = await requireTeam((matchRow as Record<string, unknown>).team_id as string);
  if (isError(auth)) return auth.error;
  const { team, teamId } = auth;

  const ctx = await loadRecapContext(db, matchRow as unknown as Record<string, unknown>, teamId);
  if (!ctx.hasResults) {
    return NextResponse.json(
      { error: 'Save the court scores first — the recap is built from them.' },
      { status: 400 },
    );
  }

  const outcome: RecapOutcome = ctx.tally.outcome;
  const saved = templateFor(outcome, ctx.templates);
  const subjectTpl = body.subject !== undefined ? body.subject : saved.subject;
  const bodyTpl = body.body !== undefined ? body.body : saved.body;

  const buildFor = (p: RecapPlayer) => {
    const vars = recapVars(ctx, team.name, p.name);
    return matchRecapEmail(
      team.name,
      ctx.match,
      { playerId: p.id, name: p.name, email: p.email as string, token: p.player_token },
      {
        subject: renderRecap(subjectTpl, vars),
        bodyText: renderRecap(bodyTpl, vars),
        outcome,
        scoreline: ctx.tally.scoreline,
        courts: ctx.courts,
        record: ctx.record.label,
        nextMatch: ctx.nextMatch,
      },
      CLUB_TZ,
    );
  };

  if (body.preview !== false) {
    /**
     * Preview against a real player when there is one — the highlighted "(you)"
     * row and the personalised greeting are half of what the captain is judging.
     */
    const sample =
      ctx.roster[0] ??
      ({ id: 'sample', name: 'your player', email: 'sample@example.com', player_token: 'sample' } as RecapPlayer);
    const email = buildFor(sample);
    return NextResponse.json({
      preview: true,
      outcome,
      scoreline: ctx.tally.scoreline,
      courts_won: ctx.tally.won,
      courts_lost: ctx.tally.lost,
      record: ctx.record.label,
      subject: email.subject,
      html: email.html,
      sample_for: ctx.roster.length ? sample.name : null,
      count: ctx.roster.length,
      recipients: ctx.roster.map((p) => ({ name: p.name, email: p.email })),
      already_sent_at: ((matchRow as Record<string, unknown>).recap_sent_at as string) ?? null,
      template: {
        subject: subjectTpl,
        body: bodyTpl,
        is_default: saved.isDefault && body.subject === undefined && body.body === undefined,
        default_subject: DEFAULT_RECAP[outcome].subject,
        default_body: DEFAULT_RECAP[outcome].body,
      },
    });
  }

  if (!ctx.roster.length) {
    return NextResponse.json(
      { error: 'Nobody on the roster has an email address.' },
      { status: 400 },
    );
  }

  /**
   * Claim the send before the mail is in flight, exactly as the scheduled
   * sends do. A whole-roster blast takes ~25s at Resend's pacing, and a
   * captain who clicks twice while nothing visibly happens must not send the
   * team two recaps. Two-minute window, so a deliberate re-send later works.
   */
  const previousStamp = ((matchRow as Record<string, unknown>).recap_sent_at as string) ?? null;
  const claimCutoff = new Date(Date.now() - 2 * 60_000).toISOString();
  if (previousStamp && previousStamp > claimCutoff) {
    return NextResponse.json(
      { error: 'That recap just went out. Give it a minute before sending it again.', code: 'recently_sent' },
      { status: 409 },
    );
  }

  const { data: claimed } = await db
    .from('captain_matches')
    .update({ recap_sent_at: new Date().toISOString() })
    .eq('id', body.match_id)
    .or(`recap_sent_at.is.null,recap_sent_at.lt.${claimCutoff}`)
    .select('id')
    .maybeSingle();
  if (!claimed) {
    return NextResponse.json(
      { error: 'That recap just went out. Give it a minute before sending it again.', code: 'recently_sent' },
      { status: 409 },
    );
  }

  try {
    const sendResults = await sendAll(team.captain_user_id, ctx.roster.map(buildFor));
    const sent = sendResults.filter((r) => r.sent).length;

    if (body.save_template) {
      await db.from('captain_recap_templates').upsert(
        {
          team_id: teamId,
          outcome,
          subject: subjectTpl.trim() || null,
          body: bodyTpl.trim() || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'team_id,outcome' },
      );
    }

    return NextResponse.json({
      ok: true,
      sent,
      outcome,
      failed: sendResults.length - sent,
      failedNames: sendResults
        .map((r, i) => (r.sent ? null : ctx.roster[i]?.name))
        .filter(Boolean) as string[],
    });
  } catch (err) {
    // Nothing went out — hand the claim back or the captain can never retry.
    await db.from('captain_matches').update({ recap_sent_at: previousStamp }).eq('id', body.match_id);
    if (err instanceof CreditLimitError) return creditLimitResponse(err);
    return NextResponse.json({ error: 'Could not send the recap.' }, { status: 502 });
  }
}

/** Save (or clear) one outcome's template for the team. */
export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    team_id?: string;
    outcome?: RecapOutcome;
    subject?: string | null;
    body?: string | null;
  };
  if (!body.team_id || !body.outcome || !RECAP_OUTCOMES.includes(body.outcome)) {
    return NextResponse.json({ error: 'team_id and a valid outcome are required.' }, { status: 400 });
  }

  const ctx = await requireTeam(body.team_id);
  if (isError(ctx)) return ctx.error;

  const trimOrNull = (v: string | null | undefined) => {
    const t = (v || '').trim();
    return t ? t : null;
  };

  const row = {
    team_id: ctx.teamId,
    outcome: body.outcome,
    subject: trimOrNull(body.subject),
    body: trimOrNull(body.body),
    updated_at: new Date().toISOString(),
  };

  const { error } = await ctx.db
    .from('captain_recap_templates')
    .upsert(row, { onConflict: 'team_id,outcome' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Blank fields fall back to the built-in wording, so say what will now send.
  return NextResponse.json({
    ok: true,
    template: templateFor(body.outcome, [
      { outcome: body.outcome, subject: row.subject, body: row.body },
    ]),
  });
}

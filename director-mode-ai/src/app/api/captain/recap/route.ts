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
 */
import { NextResponse } from 'next/server';
import { requireTeam, isError } from '@/lib/captain/server';
import { createServiceClient } from '@/lib/supabase/server';
import {
  formatMatchWhen,
  matchRecapEmail,
  sendAll,
  type MatchInfo,
  type RecapCourtRow,
} from '@/lib/captain/emails';
import { CLUB_TZ } from '@/lib/captain/clubTime';
import {
  DEFAULT_RECAP,
  RECAP_OUTCOMES,
  renderRecap,
  seasonRecord,
  tallyCourts,
  templateFor,
  type RecapOutcome,
  type RecapVars,
  type TemplateRow,
} from '@/lib/captain/recap';
import { CreditLimitError } from '@/lib/billing';
import { creditLimitResponse } from '@/lib/email';

export const dynamic = 'force-dynamic';

type PlayerRow = { id: string; name: string; email: string | null; player_token: string };
type LineupRow = {
  court_number: number;
  court_type: 'singles' | 'doubles';
  player1_id: string | null;
  player2_id: string | null;
};
type ResultRow = {
  match_id: string;
  court_number: number;
  score: string | null;
  won: boolean | null;
  defaulted: boolean | null;
};

const infoOf = (m: Record<string, unknown>): MatchInfo => ({
  id: m.id as string,
  matchAt: m.match_at as string,
  isHome: m.is_home as boolean,
  opponent: (m.opponent as string) || null,
  location: (m.location as string) || null,
  arrivalNote: (m.arrival_note as string) || null,
  opposingCaptainName: null,
  opposingCaptainPhone: null,
});

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
    .select('id, team_id, match_at, is_home, opponent, location, arrival_note, status, recap_sent_at')
    .eq('id', body.match_id)
    .maybeSingle();
  if (!matchRow) return NextResponse.json({ error: 'Match not found.' }, { status: 404 });

  const ctx = await requireTeam(matchRow.team_id as string);
  if (isError(ctx)) return ctx.error;
  const { team, teamId } = ctx;

  const [{ data: players }, { data: lineups }, { data: results }, { data: templates }] =
    await Promise.all([
      db
        .from('captain_players')
        .select('id, name, email, player_token')
        .eq('team_id', teamId)
        .eq('active', true)
        .order('name'),
      db
        .from('captain_lineups')
        .select('court_number, court_type, player1_id, player2_id')
        .eq('match_id', body.match_id)
        .order('court_number'),
      db
        .from('captain_results')
        .select('match_id, court_number, score, won, defaulted')
        .eq('match_id', body.match_id),
      db
        .from('captain_recap_templates')
        .select('outcome, subject, body')
        .eq('team_id', teamId),
    ]);

  const roster = ((players as PlayerRow[]) || []).filter((p) => !!p.email);
  const resultRows = (results as ResultRow[]) || [];
  if (!resultRows.length) {
    return NextResponse.json(
      { error: 'Save the court scores first — the recap is built from them.' },
      { status: 400 },
    );
  }

  const nameOf = (id: string | null) =>
    id ? (((players as PlayerRow[]) || []).find((p) => p.id === id)?.name ?? '—') : '—';

  /**
   * Courts come from the LINEUP, so the recap names who played. A score row
   * with no matching court (a line the captain scored before building it)
   * still shows up rather than vanishing from the scoreboard.
   */
  const lineupRows = (lineups as LineupRow[]) || [];
  const courtNumbers = [
    ...new Set([...lineupRows.map((l) => l.court_number), ...resultRows.map((r) => r.court_number)]),
  ].sort((a, b) => a - b);

  const courts: RecapCourtRow[] = courtNumbers.map((n) => {
    const l = lineupRows.find((x) => x.court_number === n) || null;
    const res = resultRows.find((x) => x.court_number === n) || null;
    const ids = l
      ? ([l.player1_id, l.court_type === 'doubles' ? l.player2_id : null].filter(
          Boolean,
        ) as string[])
      : [];
    return {
      courtNumber: n,
      courtType: (l?.court_type ?? 'doubles') as 'singles' | 'doubles',
      names: ids.length ? ids.map(nameOf) : ['—'],
      playerIds: ids,
      score: res?.score ?? null,
      won: res?.won ?? null,
      defaulted: res?.defaulted === true,
    };
  });

  const tally = tallyCourts(courts);
  const outcome: RecapOutcome = tally.outcome;

  // Season record, this match included, counted per match rather than per court.
  const { data: seasonMatches } = await db
    .from('captain_matches')
    .select('id')
    .eq('team_id', teamId)
    .eq('status', 'played');
  const playedIds = [
    ...new Set([...(((seasonMatches as { id: string }[]) || []).map((m) => m.id)), body.match_id]),
  ];
  const { data: seasonResults } = await db
    .from('captain_results')
    .select('match_id, won')
    .in('match_id', playedIds);
  const record = seasonRecord(
    playedIds.map((id) => ({
      matchId: id,
      courts: (((seasonResults as { match_id: string; won: boolean | null }[]) || []).filter(
        (r) => r.match_id === id,
      )),
    })),
  );

  // Next fixture, so the recap ends looking forward instead of stopping dead.
  const { data: nextRow } = await db
    .from('captain_matches')
    .select('id, match_at, is_home, opponent, location, arrival_note')
    .eq('team_id', teamId)
    .eq('status', 'scheduled')
    .gt('match_at', matchRow.match_at as string)
    .order('match_at')
    .limit(1)
    .maybeSingle();

  const saved = templateFor(outcome, (templates as TemplateRow[]) || []);
  const subjectTpl = body.subject !== undefined ? body.subject : saved.subject;
  const bodyTpl = body.body !== undefined ? body.body : saved.body;

  const m = infoOf(matchRow as Record<string, unknown>);
  const varsFor = (name: string): RecapVars => ({
    team: team.name,
    name,
    opponent: m.opponent || 'them',
    when: formatMatchWhen(m.matchAt, CLUB_TZ),
    home_away: m.isHome ? 'home' : 'away',
    score: tally.scoreline,
    result: outcome,
    record: record.label,
  });

  const buildFor = (p: PlayerRow) => {
    const vars = varsFor(p.name);
    return matchRecapEmail(
      team.name,
      m,
      { playerId: p.id, name: p.name, email: p.email as string, token: p.player_token },
      {
        subject: renderRecap(subjectTpl, vars),
        bodyText: renderRecap(bodyTpl, vars),
        outcome,
        scoreline: tally.scoreline,
        courts,
        record: record.label,
        nextMatch: nextRow ? infoOf(nextRow as Record<string, unknown>) : null,
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
      roster[0] ??
      ({ id: 'sample', name: 'your player', email: 'sample@example.com', player_token: 'sample' } as PlayerRow);
    const email = buildFor(sample);
    return NextResponse.json({
      preview: true,
      outcome,
      scoreline: tally.scoreline,
      courts_won: tally.won,
      courts_lost: tally.lost,
      record: record.label,
      subject: email.subject,
      html: email.html,
      sample_for: roster.length ? sample.name : null,
      count: roster.length,
      recipients: roster.map((p) => ({ name: p.name, email: p.email })),
      already_sent_at: (matchRow.recap_sent_at as string) ?? null,
      template: {
        subject: subjectTpl,
        body: bodyTpl,
        is_default: saved.isDefault && body.subject === undefined && body.body === undefined,
        default_subject: DEFAULT_RECAP[outcome].subject,
        default_body: DEFAULT_RECAP[outcome].body,
      },
    });
  }

  if (!roster.length) {
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
  const previousStamp = (matchRow.recap_sent_at as string) ?? null;
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
    const sendResults = await sendAll(team.captain_user_id, roster.map(buildFor));
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
        .map((r, i) => (r.sent ? null : roster[i]?.name))
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

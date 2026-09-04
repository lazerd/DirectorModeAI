/**
 * Lineup generation, saving, and sending.
 *   POST { action:'generate', match_id }  — propose a lineup (does not save)
 *   POST { action:'save', match_id, courts } — persist captain's final version
 *   POST { action:'send', match_id }      — email it to the whole team
 */
import { NextResponse } from 'next/server';
import {
  requireTeam,
  isError,
  capForTeam,
  committedCounts,
  pairRecords,
  rulesFor,
  styleFor,
} from '@/lib/captain/server';
import {
  generateLineup,
  requiredMatches,
  type Player,
  type LeagueType,
  type RatingType,
} from '@/lib/captain/lineup';
import { generateJttLineup } from '@/lib/captain/jttLineup';
import { teamCcRecipients, ccPayloads } from '@/lib/captain/teamContacts';
import { leagueSpec } from '@/lib/captain/leagues';
import { resolveAvailability } from '@/lib/captain/availability';
import { answersByPlayer, rowsWithAnswers, answerTally } from '@/lib/captain/lineupSave';
import { lineupEmail, sendAll, type LineupRow, type MatchInfo } from '@/lib/captain/emails';
import { CreditLimitError } from '@/lib/billing';
import { creditLimitResponse } from '@/lib/email';

type Body = {
  action?: 'generate' | 'save' | 'send';
  team_id?: string;
  match_id?: string;
  courts?: {
    courtNumber: number;
    courtType: 'singles' | 'doubles';
    player1Id: string | null;
    player2Id: string | null;
  }[];
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  if (!body.team_id || !body.match_id) {
    return NextResponse.json({ error: 'team_id and match_id are required.' }, { status: 400 });
  }

  const ctx = await requireTeam(body.team_id);
  if (isError(ctx)) return ctx.error;
  const { db, team, teamId } = ctx;

  const { data: matchRow } = await db
    .from('captain_matches')
    .select('*')
    .eq('id', body.match_id)
    .eq('team_id', teamId)
    .maybeSingle();
  if (!matchRow) return NextResponse.json({ error: 'Match not found.' }, { status: 404 });
  const match = matchRow as Record<string, unknown>;

  // ---------------------------------------------------------------- generate
  if (body.action === 'generate') {
    // select('*') rather than a column list: the generator keeps gaining inputs
    // (sort_order, unavailable_days) and a stale list silently drops one.
    const { data: players } = await db
      .from('captain_players')
      .select('*')
      .eq('team_id', teamId)
      .eq('active', true);

    const { data: avail } = await db
      .from('captain_availability')
      .select('player_id, status')
      .eq('match_id', body.match_id);

    // Poll answers plus recurring blackouts from the pre-season intake. An
    // explicit yes to this match beats a standing blackout; a blackout with no
    // answer is an exclusion the captain gets told about.
    const resolved = resolveAvailability({
      roster: ((players as Record<string, unknown>[]) || []).map((p) => ({
        id: p.id as string,
        name: p.name as string,
        unavailable_days: (p.unavailable_days as string[] | null) ?? [],
        row: p,
      })),
      answers: (avail as { player_id: string; status: string }[]) || [],
      matchAt: match.match_at as string,
    });

    // Committed, NOT played. See committedCounts — at lineup time for match 2
    // nothing is marked played yet, and counting only played matches makes
    // every player look equally rested, which silently disables equal_play.
    const counts = await committedCounts(db, teamId, body.match_id);
    const rules = rulesFor(team);
    const history = await pairRecords(db, teamId);

    const available: Player[] = resolved.available
      .map((r) => r.row)
      .map((p) => {
        // Matches this player is already down for, counting lineups the captain
        // has saved but not yet played.
        const booked = counts[p.id as string] ?? 0;
        const need = requiredMatches(rules, (p.rating_type as RatingType) ?? 'computer');
        return {
          id: p.id as string,
          name: p.name as string,
          rating: p.rating == null ? null : Number(p.rating),
          gender: (p.gender as 'M' | 'F' | null) ?? null,
          returnSide: (p.return_side as 'deuce' | 'ad' | null) ?? null,
          courtLimit: (p.court_limit as Player['courtLimit']) ?? null,
          matchesPlayed: booked,
          // false for leagues with no playoffs — requiredMatches returns 0.
          // Measured against booked matches so a player already scheduled into
          // enough of them stops being pushed up the order every week.
          needsEligibility: need > 0 && booked < need,
          // captain's manual strength rank; null falls back to rating
          sortOrder: p.sort_order == null ? null : Number(p.sort_order),
          // WTN is the objective court-order input: lower is stronger, and the
          // generator only uses it when the whole sheet has one.
          wtn: p.wtn == null ? null : Number(p.wtn),
          wtnDoubles: p.wtn_doubles == null ? null : Number(p.wtn_doubles),
        };
      });

    const [{ data: prefs }, { data: never }] = await Promise.all([
      db.from('captain_partner_prefs').select('player_id, preferred_player_id, rank').eq('team_id', teamId),
      db.from('captain_never_pair').select('player_a_id, player_b_id').eq('team_id', teamId),
    ]);

    /*
     * Read straight off the match. No `?? 2 / ?? 3` fallback: those columns are
     * NOT NULL, so the fallback was unreachable — but it is the same shape as
     * the `time || '09:30'` default that put 9:30am into three teams' worth of
     * parent emails, and a harmless-looking default is exactly how that one sat
     * unnoticed. If these ever read null, that is a bug to see, not to paper over.
     */
    const singlesCourts = match.singles_courts as number;
    const doublesCourts = match.doubles_courts as number;
    const partnerPrefs = ((prefs as Record<string, unknown>[]) || []).map((r) => ({
      playerId: r.player_id as string,
      preferredPlayerId: r.preferred_player_id as string,
      rank: r.rank as number,
    }));
    const neverPairs = ((never as Record<string, unknown>[]) || []).map((r) => ({
      playerAId: r.player_a_id as string,
      playerBId: r.player_b_id as string,
    }));

    /*
     * Junior Team Tennis is a different problem, not a variant of this one: the
     * children share eight lines between them, so the same name appears on the
     * sheet up to three times and the adult generator — which seats each player
     * once — would report a six-child team as six players short of twelve.
     */
    const multiLine = leagueSpec(team.league_type as string).multiLine;

    const result = multiLine
      ? generateJttLineup({
          available,
          singlesCourts,
          doublesCourts,
          rules: multiLine,
          partnerPrefs,
          neverPairs,
          pairHistory: history,
          captainingStyle: styleFor(team),
        })
      : generateLineup({
      available,
      pairHistory: history,
      partnerPrefs,
      neverPairs,
      singlesCourts,
      doublesCourts,
      leagueType: (team.league_type as LeagueType) || 'usta_adult',
      combinedRatingCap: capForTeam(team),
      // equal_play is a hard tier gate on matches played, so this is the switch
      // that decides whether a stronger player gets benched for fairness.
      captainingStyle: styleFor(team),
        });

    const nameOf = (id: string | null) =>
      id ? ((players as { id: string; name: string }[]) || []).find((p) => p.id === id)?.name ?? null : null;

    // ---- why it chose this -------------------------------------------------
    // The generator already knows its own reasoning; this says it out loud. A
    // captain who cannot see why Sally is on court 3 will not trust the lineup
    // enough to send it, and will rebuild it by hand instead.
    const singles = singlesCourts;
    const doubles = doublesCourts;
    const spots = singles + doubles * 2;
    const answered = (avail as { player_id: string; status: string }[]) || [];
    const saidNo = answered.filter((a) => a.status === 'no').length;
    const saidMaybe = answered.filter((a) => a.status === 'maybe').length;
    const rosterSize = ((players as Record<string, unknown>[]) || []).length;
    const style = styleFor(team);
    const cap = capForTeam(team);

    const summary: string[] = [
      `${available.length} of ${rosterSize} said yes. This match needs ${spots}` +
        (singles ? ` — ${singles} singles and ${doubles} doubles courts.` : ` — ${doubles} doubles courts.`),
    ];

    if (style === 'equal_play') {
      // Name the numbers being compared, because "equal play" is the setting a
      // captain is most likely to think is broken when it is working.
      const booked = available
        .map((p) => p.matchesPlayed)
        .reduce((acc, n) => ((acc[n] = (acc[n] ?? 0) + 1), acc), {} as Record<number, number>);
      const spread = Object.keys(booked)
        .map(Number)
        .sort((a, b) => a - b)
        .map((n) => `${booked[n]} on ${n}`)
        .join(', ');
      summary.push(
        `Equal play is on, so who is IN the running was decided by matches already committed (${spread}) — anyone further behind gets the spot before a stronger teammate who is ahead. A lineup counts the moment you save it, not when the score is entered.`,
      );
    } else {
      summary.push(
        'This team is set to play to win, so the strongest available side is picked every week and fairness is only a tiebreaker. Switch the team to equal play if you want playing time spread evenly.',
      );
    }

    if (singles > 0) {
      summary.push('Singles went first, to the strongest available players who are not marked doubles-only.');
    }
    summary.push(
      'Doubles pairs were then scored on partner preference, complementary return sides (a deuce player with an ad player), and how past pairings have actually done.',
    );
    // Which number actually decided court 1 — the thing a captain gets asked
    // about most, and the whole reason for importing WTNs.
    const doublesPool = available.filter((p) => p.courtLimit !== 'singles_only');
    const wtnOfPlayer = (p: (typeof available)[number]) => p.wtnDoubles ?? p.wtn ?? null;
    const withWtn = doublesPool.filter((p) => wtnOfPlayer(p) != null).length;
    if (doublesPool.length > 0 && withWtn === doublesPool.length) {
      summary.push(
        'Courts are ordered by each pair’s average WTN, lowest average on court 1 — objective, not a judgement call. Each court shows the average it was ranked on.',
      );
    } else {
      summary.push('Courts are ordered strongest pair first, so court 1 is your best pairing.');
      if (withWtn > 0) {
        summary.push(
          `Court order fell back to rating because ${doublesPool.length - withWtn} of ${doublesPool.length} available players have no WTN. Paste the rest in on the team page and courts get ordered by average WTN instead.`,
        );
      }
    }
    if (cap != null) {
      summary.push(`Every pair was checked against the ${cap} combined-rating cap for this level.`);
    }
    if (rules.enabled) {
      summary.push('Players short of their playoff-eligibility minimum were pushed up the order.');
    }
    if (saidMaybe) summary.push(`${saidMaybe} said maybe and were left out — only a yes is used.`);
    if (saidNo) summary.push(`${saidNo} said no.`);
    if (resolved.awaiting.length) {
      summary.push(`${resolved.awaiting.length} have not answered yet and were not considered.`);
    }

    // Who said yes and still did not make it, and why. Under equal_play the
    // generator narrows the pool before assigning, so those players never reach
    // `unassigned` — they have to be recovered from the full available list.
    const seatedIds = new Set(
      result.courts.flatMap((c) => [c.player1Id, c.player2Id]).filter(Boolean) as string[],
    );
    const benched = available
      .filter((p) => !seatedIds.has(p.id))
      .sort((a, b) => a.matchesPlayed - b.matchesPlayed || a.name.localeCompare(b.name))
      .map((p) => ({
        name: p.name,
        reason:
          p.courtLimit === 'singles_only'
            ? 'plays singles only, and the singles courts were filled'
            : p.courtLimit === 'doubles_only'
              ? 'plays doubles only, and the doubles courts were filled'
              : style === 'equal_play'
                ? `already down for ${p.matchesPlayed} ${p.matchesPlayed === 1 ? 'match' : 'matches'} — sitting so someone behind can play`
                : p.needsEligibility
                  ? 'available, and still needs matches for playoff eligibility'
                  : 'available, but there were more players than spots',
      }));

    return NextResponse.json({
      ...result,
      // Blackout exclusions first: they explain a shortfall the generator's own
      // warnings would otherwise report only as "N short".
      warnings: [...resolved.warnings, ...result.warnings],
      courts: result.courts.map((c) => ({
        ...c,
        player1Name: nameOf(c.player1Id),
        player2Name: nameOf(c.player2Id),
      })),
      availableCount: available.length,
      blockedByDay: resolved.blockedByDay.map((r) => ({ id: r.id, name: r.name })),
      awaitingCount: resolved.awaiting.length,
      explanation: { summary, benched },
    });
  }

  // -------------------------------------------------------------------- save
  if (body.action === 'save') {
    const courts = body.courts || [];

    /**
     * Saving is a delete-and-reinsert, so every answer a player has given about
     * this match has to be carried across by hand or it is destroyed. See
     * lineupSave.ts for the rule and what it cost the first time it was missed.
     */
    const { data: previous } = await db
      .from('captain_lineups')
      .select(
        'player1_id, player2_id, player1_confirmed_at, player2_confirmed_at, player1_confirmed_source, player2_confirmed_source, player1_declined_at, player2_declined_at, player1_decline_note, player2_decline_note',
      )
      .eq('match_id', body.match_id);

    const answers = answersByPlayer((previous as Record<string, unknown>[]) || []);
    const { kept, dropped } = answerTally(courts, answers);

    await db.from('captain_lineups').delete().eq('match_id', body.match_id);
    if (courts.length) {
      const { error } = await db
        .from('captain_lineups')
        .insert(rowsWithAnswers(courts, answers, { team_id: teamId, match_id: body.match_id }));
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, saved: courts.length, kept, dropped });
  }

  // -------------------------------------------------------------------- send
  if (body.action === 'send') {
    const { data: lineups } = await db
      .from('captain_lineups')
      .select('court_number, court_type, player1_id, player2_id')
      .eq('match_id', body.match_id)
      .order('court_number');
    if (!lineups?.length) {
      return NextResponse.json({ error: 'Save a lineup before sending it.' }, { status: 400 });
    }

    const { data: players } = await db
      .from('captain_players')
      .select('id, name, email, player_token')
      .eq('team_id', teamId)
      .eq('active', true);

    const roster = (players as { id: string; name: string; email: string | null; player_token: string }[]) || [];
    const nameOf = (id: string | null) => (id ? roster.find((p) => p.id === id)?.name ?? '—' : '—');

    const rows: LineupRow[] = ((lineups as Record<string, unknown>[]) || []).map((l) => ({
      courtNumber: l.court_number as number,
      courtType: l.court_type as 'singles' | 'doubles',
      names: [nameOf(l.player1_id as string | null)].concat(
        l.court_type === 'doubles' ? [nameOf(l.player2_id as string | null)] : [],
      ),
    }));

    const playing = new Set(
      ((lineups as Record<string, unknown>[]) || [])
        .flatMap((l) => [l.player1_id, l.player2_id])
        .filter(Boolean) as string[],
    );

    const info: MatchInfo = {
      id: match.id as string,
      matchAt: match.match_at as string,
      isHome: match.is_home as boolean,
      opponent: (match.opponent as string) || null,
      location: (match.location as string) || null,
      arrivalNote: (match.arrival_note as string) || null,
      opposingCaptainName: (match.opposing_captain_name as string) || null,
      opposingCaptainPhone: (match.opposing_captain_phone as string) || null,
    };

    const payloads = roster
      .filter((p) => !!p.email)
      .map((p) =>
        lineupEmail(
          team.name,
          info,
          rows,
          { playerId: p.id, name: p.name, email: p.email as string, token: p.player_token },
          playing.has(p.id),
        ),
      );

    // The coaching staff gets the lineup too — arguably the email they most
    // need, since they are the ones running the match.
    const ccs = await teamCcRecipients(
      db,
      ctx.teamId,
      (players ?? []).filter((p) => !!p.email).map((p) => p.email as string),
    );
    const ccMail = payloads.length ? ccPayloads(payloads[0], ccs, team.name) : [];

    try {
      const results = await sendAll(ctx.userId, [...payloads, ...ccMail]);
      await db
        .from('captain_matches')
        .update({ lineup_email_sent_at: new Date().toISOString() })
        .eq('id', body.match_id);
      return NextResponse.json({ ok: true, sent: results.filter((r) => r.sent).length });
    } catch (err) {
      if (err instanceof CreditLimitError) return creditLimitResponse(err);
      return NextResponse.json({ error: 'Could not send the lineup.' }, { status: 502 });
    }
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}

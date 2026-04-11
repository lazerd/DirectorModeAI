/**
 * Per-match bracket progression.
 *
 * When a league match flips to 'confirmed' we immediately compute where its
 * winner (and, for compass, also its loser) should end up in the next round
 * and either create the next-round match row with a single slot filled or
 * update the existing row to fill its second slot. When a next-round match
 * ends up with both slots filled, the caller sends round-notification emails
 * to the 2–4 players involved.
 *
 * This replaces the old "Advance brackets" button flow where an entire next
 * round was generated in bulk once every prior match was confirmed. Players
 * now advance one match at a time, so e.g. finals get populated as soon as
 * ONE of the two semifinals resolves.
 *
 * Shared with the routes at:
 *   - /api/leagues/matches/[matchId]/admin-report
 *   - /api/leagues/progress                     (24h auto-confirm sweep)
 */

import { Resend } from 'resend';
import { getSupabaseAdmin } from './supabase/admin';
import { roundDeadline } from './compassBracket';
import { CATEGORY_LABELS, type CategoryKey } from './leagueUtils';

export type LeagueType = 'compass' | 'round_robin' | 'single_elimination';

export type AdvanceTarget = {
  round: number;
  matchIndex: number;       // global, unique within a (flight, round)
  bracketPosition: string;
  slot: 'a' | 'b';
};

export type AdvancementPair = {
  winner: AdvanceTarget | null;
  loser: AdvanceTarget | null;
};

// ----------------------------------------------------------------------------
// Pure advancement math
// ----------------------------------------------------------------------------

/**
 * Given a confirmed match, return where its winner (and, for compass, its
 * loser) should be placed in the next round. Returns `{ winner: null, loser:
 * null }` when there is no further round to advance into, e.g. round-robin
 * leagues or the final round of a bracket.
 *
 * Slot mapping:
 *   - slot 'a' = entry_a_id of the target match
 *   - slot 'b' = entry_b_id of the target match
 *
 * The match_index values returned here MUST match the sequential indexing
 * that `generateNextRound` in compassBracket.ts would produce, so that
 * existing rows written by that code path are compatible with this one.
 */
export function computeAdvancementTargets(params: {
  leagueType: LeagueType;
  flightSize: number;
  numRounds: number;
  round: number;
  matchIndex: number;
  bracketPosition: string | null;
}): AdvancementPair {
  const { leagueType, flightSize, numRounds, round, bracketPosition, matchIndex } = params;

  if (leagueType === 'round_robin') {
    // Every match is created up front — no progression.
    return { winner: null, loser: null };
  }

  if (leagueType === 'single_elimination') {
    if (round >= numRounds) return { winner: null, loser: null };
    const nextRound = round + 1;
    const nextMatchIndex = Math.floor(matchIndex / 2);
    const slot: 'a' | 'b' = matchIndex % 2 === 0 ? 'a' : 'b';
    const nextBracketPosition =
      nextRound === numRounds
        ? 'SE-FINAL'
        : nextRound === numRounds - 1
          ? `SE-SF-M${nextMatchIndex + 1}`
          : `SE-R${nextRound}-M${nextMatchIndex + 1}`;
    return {
      winner: {
        round: nextRound,
        matchIndex: nextMatchIndex,
        bracketPosition: nextBracketPosition,
        slot,
      },
      loser: null,
    };
  }

  // Compass from here down.
  if (!bracketPosition) return { winner: null, loser: null };
  const subMatch = parseSubMatchNumber(bracketPosition); // 1-indexed within its sub-pool

  if (flightSize === 16) {
    // R1 (8 matches, prefix 'R1') → R2 East (4 matches) + R2 West (4 matches)
    //   Winner of R1-M{i}  → E-R2-M{ceil(i/2)} slot (odd i → 'a', even i → 'b')
    //   Loser  of R1-M{i}  → W-R2-M{ceil(i/2)} slot (same rule)
    // sequentialIndex in compassBracket writes E first (match_index 0..3),
    // then W (match_index 4..7) for R2.
    if (round === 1) {
      if (!subMatch) return { winner: null, loser: null };
      const poolPos = subMatch - 1;
      const targetSubMatch = Math.floor(poolPos / 2) + 1; // 1..4
      const slot: 'a' | 'b' = poolPos % 2 === 0 ? 'a' : 'b';
      return {
        winner: {
          round: 2,
          matchIndex: targetSubMatch - 1, // East pool: 0..3
          bracketPosition: `E-R2-M${targetSubMatch}`,
          slot,
        },
        loser: {
          round: 2,
          matchIndex: 4 + (targetSubMatch - 1), // West pool: 4..7
          bracketPosition: `W-R2-M${targetSubMatch}`,
          slot,
        },
      };
    }

    // R2 → R3: East matches split into NE (winners) + SE (losers);
    //          West matches split into NW (winners) + SW (losers).
    // R3 sequentialIndex order: NE (0..1), SE (2..3), NW (4..5), SW (6..7).
    if (round === 2) {
      if (!subMatch) return { winner: null, loser: null };
      const isEast = bracketPosition.startsWith('E-');
      const isWest = bracketPosition.startsWith('W-');
      if (!isEast && !isWest) return { winner: null, loser: null };
      const poolPos = subMatch - 1;
      const targetSubMatch = Math.floor(poolPos / 2) + 1; // 1..2
      const slot: 'a' | 'b' = poolPos % 2 === 0 ? 'a' : 'b';
      const winnerPrefix = isEast ? 'NE' : 'NW';
      const loserPrefix = isEast ? 'SE' : 'SW';
      const winnerBase = isEast ? 0 : 4;
      const loserBase = isEast ? 2 : 6;
      return {
        winner: {
          round: 3,
          matchIndex: winnerBase + (targetSubMatch - 1),
          bracketPosition: `${winnerPrefix}-R3-M${targetSubMatch}`,
          slot,
        },
        loser: {
          round: 3,
          matchIndex: loserBase + (targetSubMatch - 1),
          bracketPosition: `${loserPrefix}-R3-M${targetSubMatch}`,
          slot,
        },
      };
    }

    // R3 → R4: within each of NE/SE/NW/SW, the two R3 matches feed a
    // championship final (for 1st-in-quadrant) and a 3rd-place match
    // (for 3rd-in-quadrant). R4 sequentialIndex writes NE first
    // (M1=FINAL idx 0, M2=3RD idx 1), then SE (2,3), NW (4,5), SW (6,7).
    if (round === 3) {
      if (!subMatch) return { winner: null, loser: null };
      const prefix = parseCompassPrefix(bracketPosition);
      if (!prefix) return { winner: null, loser: null };
      const slot: 'a' | 'b' = subMatch === 1 ? 'a' : 'b';
      const base = { NE: 0, SE: 2, NW: 4, SW: 6 }[prefix];
      return {
        winner: {
          round: 4,
          matchIndex: base,
          bracketPosition: `${prefix}-FINAL`,
          slot,
        },
        loser: {
          round: 4,
          matchIndex: base + 1,
          bracketPosition: `${prefix}-3RD`,
          slot,
        },
      };
    }

    return { winner: null, loser: null };
  }

  if (flightSize === 8) {
    if (round === 1) {
      // Same logic as 16-player R1 but only 4 R1 matches, 2 target sub-matches per pool.
      if (!subMatch) return { winner: null, loser: null };
      const poolPos = subMatch - 1;
      const targetSubMatch = Math.floor(poolPos / 2) + 1; // 1..2
      const slot: 'a' | 'b' = poolPos % 2 === 0 ? 'a' : 'b';
      return {
        winner: {
          round: 2,
          matchIndex: targetSubMatch - 1, // East pool: 0..1
          bracketPosition: `E-R2-M${targetSubMatch}`,
          slot,
        },
        loser: {
          round: 2,
          matchIndex: 2 + (targetSubMatch - 1), // West pool: 2..3
          bracketPosition: `W-R2-M${targetSubMatch}`,
          slot,
        },
      };
    }

    // R2 → R3 finals (compass-8 only has 3 rounds, so R3 IS finals).
    // Order in compassBracket.ts: NE-FINAL, SE-FINAL, NW-FINAL, SW-FINAL
    // so match_index 0,1,2,3 respectively.
    if (round === 2) {
      if (!subMatch) return { winner: null, loser: null };
      const isEast = bracketPosition.startsWith('E-');
      const isWest = bracketPosition.startsWith('W-');
      if (!isEast && !isWest) return { winner: null, loser: null };
      const slot: 'a' | 'b' = subMatch === 1 ? 'a' : 'b';
      const winnerPrefix = isEast ? 'NE' : 'NW';
      const loserPrefix = isEast ? 'SE' : 'SW';
      const indexMap = { NE: 0, SE: 1, NW: 2, SW: 3 } as const;
      return {
        winner: {
          round: 3,
          matchIndex: indexMap[winnerPrefix],
          bracketPosition: `${winnerPrefix}-FINAL`,
          slot,
        },
        loser: {
          round: 3,
          matchIndex: indexMap[loserPrefix],
          bracketPosition: `${loserPrefix}-FINAL`,
          slot,
        },
      };
    }

    return { winner: null, loser: null };
  }

  return { winner: null, loser: null };
}

/** Extract the trailing "M{n}" number from a compass bracket position. */
function parseSubMatchNumber(bracketPosition: string): number | null {
  const m = bracketPosition.match(/-M(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

/** Extract NE|SE|NW|SW from a compass bracket position string. */
function parseCompassPrefix(
  bracketPosition: string
): 'NE' | 'SE' | 'NW' | 'SW' | null {
  const m = bracketPosition.match(/^(NE|SE|NW|SW)/);
  return m ? (m[1] as 'NE' | 'SE' | 'NW' | 'SW') : null;
}

// ----------------------------------------------------------------------------
// Database-level progression
// ----------------------------------------------------------------------------

export type ProgressionResult = {
  advanced: boolean;
  createdMatches: number;
  updatedSlots: number;
  /** Match IDs that became fully paired (both slots filled) as a result of
   *  this call. The caller should send round-notification emails for these. */
  newlyPairedMatchIds: string[];
  flightCompleted: boolean;
  leagueCompleted: boolean;
};

/**
 * Progress a single match's winner (and, for compass, also its loser) into
 * the next round. Only has an effect when the match is in 'confirmed' state.
 * Idempotent: re-running overwrites the target slot with the same value.
 */
export async function progressMatchOnConfirm(
  matchId: string
): Promise<ProgressionResult> {
  const admin = getSupabaseAdmin();
  const empty: ProgressionResult = {
    advanced: false,
    createdMatches: 0,
    updatedSlots: 0,
    newlyPairedMatchIds: [],
    flightCompleted: false,
    leagueCompleted: false,
  };

  const { data: match } = await admin
    .from('league_matches')
    .select('id, flight_id, round, match_index, bracket_position, entry_a_id, entry_b_id, winner_entry_id, status')
    .eq('id', matchId)
    .maybeSingle();
  if (!match) return empty;
  const m = match as any;
  if (m.status !== 'confirmed') return empty;
  if (!m.winner_entry_id) return empty;

  const { data: flight } = await admin
    .from('league_flights')
    .select('id, league_id, size, num_rounds, status')
    .eq('id', m.flight_id)
    .maybeSingle();
  if (!flight) return empty;
  const f = flight as any;

  const { data: league } = await admin
    .from('leagues')
    .select('id, league_type, start_date, status')
    .eq('id', f.league_id)
    .maybeSingle();
  if (!league) return empty;
  const lg = league as any;

  const leagueType = (lg.league_type || 'compass') as LeagueType;

  const targets = computeAdvancementTargets({
    leagueType,
    flightSize: f.size,
    numRounds: f.num_rounds,
    round: m.round,
    matchIndex: m.match_index,
    bracketPosition: m.bracket_position,
  });

  const winnerEntryId: string = m.winner_entry_id;
  const loserEntryId: string | null =
    winnerEntryId === m.entry_a_id ? m.entry_b_id : m.entry_a_id;

  const leagueStart = new Date(lg.start_date);
  let createdMatches = 0;
  let updatedSlots = 0;
  const newlyPairedMatchIds: string[] = [];

  const placeEntry = async (target: AdvanceTarget, entryId: string) => {
    const { data: existing } = await admin
      .from('league_matches')
      .select('id, entry_a_id, entry_b_id, status')
      .eq('flight_id', f.id)
      .eq('round', target.round)
      .eq('match_index', target.matchIndex)
      .maybeSingle();

    if (existing) {
      const ex = existing as any;
      const otherSlotFilled =
        target.slot === 'a' ? !!ex.entry_b_id : !!ex.entry_a_id;
      const currentSlotFilled =
        target.slot === 'a' ? !!ex.entry_a_id : !!ex.entry_b_id;
      const patch: any = {};
      if (target.slot === 'a') patch.entry_a_id = entryId;
      else patch.entry_b_id = entryId;
      await admin.from('league_matches').update(patch).eq('id', ex.id);
      updatedSlots += 1;
      // Transitioning 1→2 slots filled: newly paired, email-worthy.
      if (!currentSlotFilled && otherSlotFilled) {
        newlyPairedMatchIds.push(ex.id);
      }
    } else {
      const deadline = roundDeadline(leagueStart, target.round);
      const row: any = {
        flight_id: f.id,
        round: target.round,
        match_index: target.matchIndex,
        bracket_position: target.bracketPosition,
        deadline: deadline.toISOString().split('T')[0],
        status: 'pending',
        entry_a_id: null,
        entry_b_id: null,
      };
      if (target.slot === 'a') row.entry_a_id = entryId;
      else row.entry_b_id = entryId;
      const { error: insertErr } = await admin
        .from('league_matches')
        .insert(row);
      if (insertErr) {
        console.error('progressMatchOnConfirm insert failed:', insertErr);
      } else {
        createdMatches += 1;
      }
    }
  };

  if (targets.winner) await placeEntry(targets.winner, winnerEntryId);
  if (targets.loser && loserEntryId) await placeEntry(targets.loser, loserEntryId);

  // Flight/league completion: when the confirmed match IS in the final round,
  // check if all final-round matches are done and mark the flight complete.
  let flightCompleted = false;
  let leagueCompleted = false;
  if (m.round >= f.num_rounds && f.status !== 'completed') {
    const { data: finalRoundMatches } = await admin
      .from('league_matches')
      .select('status')
      .eq('flight_id', f.id)
      .eq('round', f.num_rounds);
    const frm = (finalRoundMatches as any[]) || [];
    if (frm.length > 0 && frm.every(x => x.status === 'confirmed')) {
      await admin
        .from('league_flights')
        .update({ status: 'completed' })
        .eq('id', f.id);
      flightCompleted = true;
    }
  }

  if (flightCompleted && lg.status !== 'completed') {
    const { data: remainingFlights } = await admin
      .from('league_flights')
      .select('status')
      .eq('league_id', lg.id);
    const rfs = (remainingFlights as any[]) || [];
    if (rfs.length > 0 && rfs.every(x => x.status === 'completed')) {
      await admin.from('leagues').update({ status: 'completed' }).eq('id', lg.id);
      leagueCompleted = true;
    }
  }

  return {
    advanced: !!(targets.winner || targets.loser),
    createdMatches,
    updatedSlots,
    newlyPairedMatchIds,
    flightCompleted,
    leagueCompleted,
  };
}

// ----------------------------------------------------------------------------
// Downstream check (used by edit/delete guards)
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// Dispute-window auto-confirm sweep (shared between cron + director button)
// ----------------------------------------------------------------------------

export type SweepSummary = {
  autoConfirmed: number;
  advancedMatches: number;
  newSlotsFilled: number;
  newMatchesCreated: number;
  flightsCompleted: number;
  leaguesCompleted: number;
  emailsSent: number;
};

const AUTO_CONFIRM_MS = 24 * 60 * 60 * 1000;

/**
 * Core 24-hour dispute-window sweep. For every flight in the given leagues,
 * flip 'reported' matches older than 24h to 'confirmed', then run per-match
 * advancement and send round-notification emails for newly-paired matches.
 *
 * Lives in this module (instead of inside the /api/leagues/progress route)
 * so both paths can call it directly:
 *
 *   - POST /api/leagues/progress       — director clicks "Lock in overdue"
 *   - GET  /api/lessons/send-reminders — daily Vercel cron folds the sweep
 *                                        into its existing run to avoid
 *                                        adding a 3rd cron entry on Hobby
 *
 * Idempotent. Only touches matches whose dispute window has actually
 * elapsed, so calling it repeatedly is safe.
 */
export async function runSweep(
  leagueIds: string[],
  requestOrigin: string
): Promise<SweepSummary> {
  const admin = getSupabaseAdmin();

  const summary: SweepSummary = {
    autoConfirmed: 0,
    advancedMatches: 0,
    newSlotsFilled: 0,
    newMatchesCreated: 0,
    flightsCompleted: 0,
    leaguesCompleted: 0,
    emailsSent: 0,
  };

  const cutoffIso = new Date(Date.now() - AUTO_CONFIRM_MS).toISOString();

  for (const lid of leagueIds) {
    const { data: leagueFlights } = await admin
      .from('league_flights')
      .select('id')
      .eq('league_id', lid);
    const flightIds = ((leagueFlights as any[]) || []).map(f => f.id);
    if (flightIds.length === 0) continue;

    const { data: staleReports } = await admin
      .from('league_matches')
      .select('id')
      .in('flight_id', flightIds)
      .eq('status', 'reported')
      .lt('reported_at', cutoffIso);

    const staleIds = ((staleReports as any[]) || []).map(m => m.id);
    if (staleIds.length === 0) continue;

    for (const matchId of staleIds) {
      await admin
        .from('league_matches')
        .update({ status: 'confirmed' })
        .eq('id', matchId);
      summary.autoConfirmed += 1;

      const progression = await progressMatchOnConfirm(matchId);
      if (progression.advanced) summary.advancedMatches += 1;
      summary.newSlotsFilled += progression.updatedSlots;
      summary.newMatchesCreated += progression.createdMatches;
      if (progression.flightCompleted) summary.flightsCompleted += 1;
      if (progression.leagueCompleted) summary.leaguesCompleted += 1;

      for (const pairedId of progression.newlyPairedMatchIds) {
        try {
          const { sent } = await sendRoundMatchEmails(pairedId, requestOrigin);
          summary.emailsSent += sent;
        } catch (e) {
          console.error('sendRoundMatchEmails failed:', e);
        }
      }
    }
  }

  return summary;
}

/**
 * Helper for cron callers: fetch the id list of every league currently in
 * 'running' status, across all directors. Use this + `runSweep(ids, origin)`
 * to resolve overdue reports for the entire platform in one shot.
 */
export async function getAllRunningLeagueIds(): Promise<string[]> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from('leagues')
    .select('id')
    .eq('status', 'running');
  return ((data as any[]) || []).map(l => l.id);
}

// ----------------------------------------------------------------------------
// Match reminder emails (shared between director button + daily cron)
// ----------------------------------------------------------------------------

export type ReminderSummary = {
  leaguesScanned: number;
  matchesConsidered: number;
  remindersSent: number;
};

/**
 * Send "your match is coming up" reminder emails for pending matches with
 * upcoming deadlines. Two modes:
 *
 *   - mode='manual'  — called from the director's "Send reminders" button
 *                      on the league dashboard. Sends for every pending
 *                      match with a deadline in the next 0–3 days. Hitting
 *                      the button twice in a row will re-send, which is
 *                      fine because the director made that choice.
 *
 *   - mode='cron'    — called from the daily 8am UTC /api/lessons cron
 *                      for every running league. Uses a narrow filter so
 *                      each match gets at most two reminders during its
 *                      lifecycle: one when it hits exactly 3 days out,
 *                      and one when it hits exactly 1 day out. No state
 *                      tracking column needed — deadline is a DATE so
 *                      date-diff comparisons are stable across cron runs.
 *
 * Both modes share the same fetch, the same per-match email template, and
 * the same recipient list (captain + partner for both sides of the match).
 */
export async function sendMatchReminders(
  leagueIds: string[],
  requestOrigin: string,
  mode: 'manual' | 'cron'
): Promise<ReminderSummary> {
  const admin = getSupabaseAdmin();
  const resend = new Resend(process.env.RESEND_API_KEY);
  const FROM =
    process.env.RESEND_FROM_EMAIL ||
    'CoachMode Leagues <noreply@mail.coachmode.ai>';

  const summary: ReminderSummary = {
    leaguesScanned: 0,
    matchesConsidered: 0,
    remindersSent: 0,
  };

  // Date math: compute today (UTC), today+1, today+3 as yyyy-mm-dd strings
  // so they compare directly against the match.deadline DATE column.
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const todayStr = fmt(today);
  const plus1 = new Date(today); plus1.setUTCDate(plus1.getUTCDate() + 1);
  const plus3 = new Date(today); plus3.setUTCDate(plus3.getUTCDate() + 3);
  const plus1Str = fmt(plus1);
  const plus3Str = fmt(plus3);

  for (const lid of leagueIds) {
    summary.leaguesScanned += 1;

    const { data: league } = await admin
      .from('leagues')
      .select('id, name, slug')
      .eq('id', lid)
      .maybeSingle();
    if (!league) continue;
    const leagueName = (league as any).name as string;
    const leagueSlug = (league as any).slug as string;
    const publicBracketUrl = `${requestOrigin}/leagues/${leagueSlug}/bracket`;

    // Every flight in this league.
    const { data: flights } = await admin
      .from('league_flights')
      .select('id')
      .eq('league_id', lid);
    const flightIds = ((flights as any[]) || []).map(f => f.id);
    if (flightIds.length === 0) continue;

    // Pending matches whose deadline falls in the target window. Cron mode
    // narrows to exactly +3 days or exactly +1 day; manual mode uses the
    // broad today…+3 range (inclusive of overdue).
    let query = admin
      .from('league_matches')
      .select(
        'id, flight_id, round, deadline, bracket_position, entry_a_id, entry_b_id'
      )
      .in('flight_id', flightIds)
      .eq('status', 'pending');

    if (mode === 'cron') {
      query = query.in('deadline', [plus1Str, plus3Str]);
    } else {
      query = query.lte('deadline', plus3Str).gte('deadline', todayStr);
    }

    const { data: pendingMatches } = await query;
    const matches = (pendingMatches as any[]) || [];
    summary.matchesConsidered += matches.length;
    if (matches.length === 0) continue;

    // Bulk-load the entries referenced so we can address every player.
    const entryIdSet = new Set<string>();
    for (const m of matches) {
      if (m.entry_a_id) entryIdSet.add(m.entry_a_id);
      if (m.entry_b_id) entryIdSet.add(m.entry_b_id);
    }
    if (entryIdSet.size === 0) continue;
    const { data: entries } = await admin
      .from('league_entries')
      .select(
        'id, captain_name, captain_email, captain_token, partner_name, partner_email, partner_token'
      )
      .in('id', Array.from(entryIdSet));
    const byId = new Map(((entries as any[]) || []).map(e => [e.id, e]));

    for (const m of matches) {
      const a = byId.get(m.entry_a_id);
      const b = byId.get(m.entry_b_id);
      if (!a || !b) continue;
      const opponentOfA = `${b.captain_name}${b.partner_name ? ' & ' + b.partner_name : ''}`;
      const opponentOfB = `${a.captain_name}${a.partner_name ? ' & ' + a.partner_name : ''}`;

      const sendOne = async (
        email: string | null,
        token: string | null,
        name: string,
        opponent: string
      ) => {
        if (!email || !token) return;
        const reportUrl = `${requestOrigin}/leagues/match/${token}`;
        try {
          await resend.emails.send({
            from: FROM,
            to: email,
            subject: `Reminder: your R${m.round} match vs ${opponent} — deadline ${m.deadline}`,
            html: `
              <div style="font-family: -apple-system, sans-serif; max-width: 600px; padding: 20px;">
                <h2 style="color: #ea580c;">Match reminder</h2>
                <p>Hi ${name}, just a heads-up — your Round ${m.round} match still hasn't been reported.</p>
                <div style="background: #fff7ed; border-left: 4px solid #ea580c; padding: 14px 18px; border-radius: 6px; margin: 16px 0;">
                  <div style="font-weight: 600;">vs ${opponent}</div>
                  <div style="color: #6b7280; font-size: 14px; margin-top: 8px;">Deadline: <strong>${m.deadline}</strong></div>
                </div>
                <p style="margin: 24px 0 12px;">
                  <a href="${reportUrl}" style="display: inline-block; background: #ea580c; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500;">Report score</a>
                </p>
                <p style="margin: 0 0 24px;">
                  <a href="${publicBracketUrl}" style="display: inline-block; background: transparent; color: #ea580c; border: 1.5px solid #ea580c; padding: 10px 22px; border-radius: 8px; text-decoration: none; font-weight: 500;">View live bracket</a>
                </p>
                <p style="color: #6b7280; font-size: 12px; margin: 0;">
                  ${leagueName} · The bracket page is public — share it with anyone.
                </p>
              </div>
            `,
          });
          summary.remindersSent += 1;
        } catch (e) {
          console.error('reminder failed:', e);
        }
      };

      await sendOne(a.captain_email, a.captain_token, a.captain_name, opponentOfA);
      if (a.partner_email) await sendOne(a.partner_email, a.partner_token, a.partner_name || 'Player', opponentOfA);
      await sendOne(b.captain_email, b.captain_token, b.captain_name, opponentOfB);
      if (b.partner_email) await sendOne(b.partner_email, b.partner_token, b.partner_name || 'Player', opponentOfB);
    }
  }

  return summary;
}

export type DownstreamMatch = {
  id: string;
  round: number;
  bracket_position: string | null;
  status: string;
};

/**
 * Find any matches later in the same flight that are currently holding this
 * match's winner or loser as one of their entries. Used to block editing or
 * deleting a result that has already propagated forward — the admin must
 * delete the downstream matches first so the bracket doesn't end up
 * referencing ghost entries.
 *
 * Returns an empty array if nothing references the winner/loser yet, or if
 * this match has no winner recorded (i.e. nothing has been advanced from it).
 */
export async function findDownstreamMatches(
  matchId: string
): Promise<DownstreamMatch[]> {
  const admin = getSupabaseAdmin();

  const { data: match } = await admin
    .from('league_matches')
    .select('id, flight_id, round, winner_entry_id, entry_a_id, entry_b_id')
    .eq('id', matchId)
    .maybeSingle();
  if (!match) return [];
  const m = match as any;

  // If no winner has been recorded there's no advancement to worry about yet.
  if (!m.winner_entry_id) return [];
  const winnerId: string = m.winner_entry_id;
  const loserId: string | null =
    winnerId === m.entry_a_id ? m.entry_b_id : m.entry_a_id;

  const relevantIds = [winnerId, loserId].filter(Boolean) as string[];
  if (relevantIds.length === 0) return [];

  // Supabase .or() with .in() helpers — fetch all later-round matches in this
  // flight that contain either id on either side. We filter in code to keep
  // the query simple.
  const { data: later } = await admin
    .from('league_matches')
    .select('id, round, bracket_position, entry_a_id, entry_b_id, status')
    .eq('flight_id', m.flight_id)
    .gt('round', m.round);

  const rows = ((later as any[]) || []).filter(
    r =>
      (r.entry_a_id && relevantIds.includes(r.entry_a_id)) ||
      (r.entry_b_id && relevantIds.includes(r.entry_b_id))
  );

  return rows.map(r => ({
    id: r.id,
    round: r.round,
    bracket_position: r.bracket_position,
    status: r.status,
  }));
}

/**
 * Format a list of downstream matches into a human-readable error message
 * the UI can display without further processing.
 */
export function describeDownstream(matches: DownstreamMatch[]): string {
  if (matches.length === 0) return '';
  const labels = matches
    .slice(0, 4)
    .map(m => m.bracket_position || `Round ${m.round}`)
    .join(', ');
  const more = matches.length > 4 ? ` and ${matches.length - 4} more` : '';
  return (
    `This result has already advanced into ${matches.length} later match` +
    `${matches.length === 1 ? '' : 'es'} (${labels}${more}). ` +
    `Delete or clear those downstream matches first, then you can edit this one.`
  );
}

// ----------------------------------------------------------------------------
// Shared round-notification email
// ----------------------------------------------------------------------------

/**
 * Render the HTML body for a round-start notification. Used for every round
 * (R1 through finals) so players see the same structure and disclaimer every
 * time: opponent contact info, report-score button, the public live-bracket
 * link, and the standard "save this email" + dispute-window footer.
 */
export function buildRoundMatchEmailHtml(params: {
  roundNumber: number;
  playerName: string;
  opponentName: string;
  opponentEmail: string | null;
  opponentPhone: string | null;
  leagueName: string;
  categoryLabel: string | null;
  bracketPosition: string | null;
  deadline: string;
  reportUrl: string;
  /** Optional full URL to the public /leagues/{slug}/bracket page so
   *  recipients can see the whole draw, not just their own match. */
  publicBracketUrl?: string | null;
}): string {
  const {
    roundNumber,
    playerName,
    opponentName,
    opponentEmail,
    opponentPhone,
    leagueName,
    categoryLabel,
    bracketPosition,
    deadline,
    reportUrl,
    publicBracketUrl,
  } = params;

  const heading = `Round ${roundNumber} is on`;
  const lede =
    roundNumber === 1
      ? `The draws for <strong>${leagueName}</strong> are live. Here's your first match:`
      : `You advanced! Here's your Round ${roundNumber} match:`;

  const cardEyebrow = [categoryLabel, bracketPosition]
    .filter(Boolean)
    .join(' · ');

  const bracketCta = publicBracketUrl
    ? `
      <p style="margin: 12px 0 24px;">
        <a href="${publicBracketUrl}" style="display: inline-block; background: transparent; color: #ea580c; border: 1.5px solid #ea580c; padding: 10px 22px; border-radius: 8px; text-decoration: none; font-weight: 500;">View live bracket</a>
      </p>
      <p style="color: #6b7280; font-size: 12px; margin: 0 0 24px;">
        The bracket page is public — share it with anyone. It updates in real time as scores come in.
      </p>
    `
    : '';

  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #ea580c; margin-top: 0;">${heading}</h2>
      <p>Hi ${playerName},</p>
      <p>${lede}</p>
      <div style="background: #fff7ed; border-left: 4px solid #ea580c; padding: 14px 18px; border-radius: 6px; margin: 16px 0;">
        ${cardEyebrow ? `<div style="color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em;">${cardEyebrow}</div>` : ''}
        <div style="font-weight: 600; font-size: 16px; margin-top: 4px;">vs ${opponentName}</div>
        <div style="color: #6b7280; font-size: 14px; margin-top: 8px;">Deadline: <strong>${deadline}</strong></div>
      </div>
      <p>Schedule the match directly with your opponent:</p>
      <ul style="color: #374151;">
        <li><strong>Email:</strong> ${opponentEmail || 'not provided'}</li>
        <li><strong>Phone:</strong> ${opponentPhone || 'not provided'}</li>
      </ul>
      <p>When the match is finished, any player can report the score here:</p>
      <p style="margin: 24px 0 12px;">
        <a href="${reportUrl}" style="display: inline-block; background: #ea580c; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500;">Report score</a>
      </p>
      ${bracketCta}
      <p style="color: #6b7280; font-size: 12px; margin-top: 32px;">
        Save this email — the link is your unique score-reporting URL. If your opponent reports first, you'll get another email with a dispute button.
      </p>
    </div>
  `;
}

/**
 * Load everything needed to send round-notification emails for a match that
 * just became fully paired, then send one email per player (2 for singles,
 * up to 4 for doubles). Fire-and-forget at the call site — email failures
 * are logged but do not block.
 */
export async function sendRoundMatchEmails(
  matchId: string,
  requestOrigin: string
): Promise<{ sent: number }> {
  const admin = getSupabaseAdmin();
  const resend = new Resend(process.env.RESEND_API_KEY);
  const FROM =
    process.env.RESEND_FROM_EMAIL ||
    'CoachMode Leagues <noreply@mail.coachmode.ai>';

  const { data: match } = await admin
    .from('league_matches')
    .select('id, flight_id, round, bracket_position, entry_a_id, entry_b_id, deadline')
    .eq('id', matchId)
    .maybeSingle();
  if (!match) return { sent: 0 };
  const m = match as any;
  if (!m.entry_a_id || !m.entry_b_id) return { sent: 0 };

  const { data: flight } = await admin
    .from('league_flights')
    .select('league_id, category_id')
    .eq('id', m.flight_id)
    .maybeSingle();
  if (!flight) return { sent: 0 };
  const f = flight as any;

  const { data: league } = await admin
    .from('leagues')
    .select('name, slug')
    .eq('id', f.league_id)
    .maybeSingle();
  const leagueName = (league as any)?.name || 'League';
  const leagueSlug = (league as any)?.slug || null;
  const publicBracketUrl = leagueSlug ? `${requestOrigin}/leagues/${leagueSlug}/bracket` : null;

  const { data: category } = await admin
    .from('league_categories')
    .select('category_key')
    .eq('id', f.category_id)
    .maybeSingle();
  const categoryKey = ((category as any)?.category_key || null) as CategoryKey | null;
  const categoryLabel = categoryKey ? CATEGORY_LABELS[categoryKey] || null : null;

  const { data: entries } = await admin
    .from('league_entries')
    .select(
      'id, captain_name, captain_email, captain_phone, captain_token, partner_name, partner_email, partner_phone, partner_token'
    )
    .in('id', [m.entry_a_id, m.entry_b_id]);
  const entryById = new Map((entries as any[] | null || []).map(e => [e.id, e]));
  const entryA = entryById.get(m.entry_a_id);
  const entryB = entryById.get(m.entry_b_id);
  if (!entryA || !entryB) return { sent: 0 };

  const opponentOfA = `${entryB.captain_name}${entryB.partner_name ? ' & ' + entryB.partner_name : ''}`;
  const opponentOfB = `${entryA.captain_name}${entryA.partner_name ? ' & ' + entryA.partner_name : ''}`;
  const deadline: string = m.deadline || '';

  let sent = 0;
  const sendOne = async (
    email: string | null,
    token: string | null,
    playerName: string,
    opponentName: string,
    opponentEmail: string | null,
    opponentPhone: string | null
  ) => {
    if (!email || !token) return;
    const reportUrl = `${requestOrigin}/leagues/match/${token}`;
    const html = buildRoundMatchEmailHtml({
      roundNumber: m.round,
      playerName,
      opponentName,
      opponentEmail,
      opponentPhone,
      leagueName,
      categoryLabel,
      bracketPosition: m.bracket_position,
      deadline,
      reportUrl,
      publicBracketUrl,
    });
    try {
      await resend.emails.send({
        from: FROM,
        to: email,
        subject: `Round ${m.round}: ${leagueName} — deadline ${deadline}`,
        html,
      });
      sent += 1;
    } catch (e) {
      console.error('Round email send failed:', e);
    }
  };

  // Team A players → opponent contact is Team B's captain (singles) or the
  // doubles team as a whole. We pass Team B's captain email/phone as the
  // canonical contact since that's what the existing R1 email does.
  await sendOne(
    entryA.captain_email,
    entryA.captain_token,
    entryA.captain_name,
    opponentOfA,
    entryB.captain_email,
    entryB.captain_phone
  );
  if (entryA.partner_email) {
    await sendOne(
      entryA.partner_email,
      entryA.partner_token,
      entryA.partner_name || 'Player',
      opponentOfA,
      entryB.captain_email,
      entryB.captain_phone
    );
  }
  await sendOne(
    entryB.captain_email,
    entryB.captain_token,
    entryB.captain_name,
    opponentOfB,
    entryA.captain_email,
    entryA.captain_phone
  );
  if (entryB.partner_email) {
    await sendOne(
      entryB.partner_email,
      entryB.partner_token,
      entryB.partner_name || 'Player',
      opponentOfB,
      entryA.captain_email,
      entryA.captain_phone
    );
  }

  return { sent };
}

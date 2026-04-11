/**
 * POST /api/leagues/progress
 *
 * League bracket progression worker. Does two things:
 *   1. Auto-confirm any 'reported' match whose report is older than 24h.
 *   2. For any flight whose current round is fully confirmed, generate the
 *      next round's matches, send the R(n+1) email blast, and mark the
 *      flight as completed when all rounds finish.
 *
 * Safe to call on-demand from the league detail page ("advance brackets")
 * or on a schedule (Vercel cron hitting this endpoint nightly). Idempotent.
 *
 * Scoped to one league at a time via ?leagueId=XXX, or all leagues the
 * authenticated director owns when no leagueId is provided.
 */

import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { generateNextRound, roundDeadline, type MatchResult } from '@/lib/compassBracket';
import { generateSingleEliminationNextRound } from '@/lib/singleEliminationBracket';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.RESEND_FROM_EMAIL || 'CoachMode Leagues <noreply@mail.coachmode.ai>';

const AUTO_CONFIRM_MS = 24 * 60 * 60 * 1000;

export async function POST(request: Request) {
  try {
    const userClient = await createClient();
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const url = new URL(request.url);
    const leagueId = url.searchParams.get('leagueId');

    const admin = getSupabaseAdmin();

    // 1. Which leagues to scan?
    let leagueIds: string[] = [];
    if (leagueId) {
      const { data: lg } = await admin
        .from('leagues')
        .select('id, director_id')
        .eq('id', leagueId)
        .maybeSingle();
      if (!lg || (lg as any).director_id !== user.id) {
        return NextResponse.json({ error: 'Not found or not authorized' }, { status: 403 });
      }
      leagueIds = [leagueId];
    } else {
      const { data: ls } = await admin
        .from('leagues')
        .select('id')
        .eq('director_id', user.id)
        .eq('status', 'running');
      leagueIds = ((ls as any[]) || []).map(l => l.id);
    }

    const summary = {
      autoConfirmed: 0,
      nextRoundsGenerated: 0,
      newMatches: 0,
      flightsCompleted: 0,
      leaguesCompleted: 0,
      emailsSent: 0,
    };

    for (const lid of leagueIds) {
      // Load league basics (for deadlines + emails)
      const { data: league } = await admin
        .from('leagues')
        .select('id, name, start_date, status, league_type')
        .eq('id', lid)
        .maybeSingle();
      if (!league) continue;
      const leagueType = ((league as any).league_type || 'compass') as
        'compass' | 'round_robin' | 'single_elimination';

      // 2. Auto-confirm any 'reported' matches whose report window has elapsed
      const cutoffIso = new Date(Date.now() - AUTO_CONFIRM_MS).toISOString();
      const { data: toConfirm } = await admin
        .from('league_matches')
        .select('id, flight_id')
        .eq('status', 'reported')
        .lt('reported_at', cutoffIso);
      if (toConfirm && toConfirm.length > 0) {
        // Only confirm matches belonging to this league's flights
        const { data: leagueFlights } = await admin
          .from('league_flights')
          .select('id')
          .eq('league_id', lid);
        const leagueFlightIds = new Set(((leagueFlights as any[]) || []).map(f => f.id));
        const toConfirmInLeague = (toConfirm as any[])
          .filter(m => leagueFlightIds.has(m.flight_id))
          .map(m => m.id);
        if (toConfirmInLeague.length > 0) {
          await admin
            .from('league_matches')
            .update({ status: 'confirmed' })
            .in('id', toConfirmInLeague);
          summary.autoConfirmed += toConfirmInLeague.length;
        }
      }

      // 3. For each flight in this league, check if the current round is complete
      const { data: flights } = await admin
        .from('league_flights')
        .select('id, size, num_rounds, status, category_id, flight_name')
        .eq('league_id', lid)
        .eq('status', 'running');

      for (const flight of (flights as any[]) || []) {
        // Find highest round that has any matches
        const { data: allMatches } = await admin
          .from('league_matches')
          .select('id, round, match_index, bracket_position, status, winner_entry_id, entry_a_id, entry_b_id')
          .eq('flight_id', flight.id)
          .order('round', { ascending: false });

        const matches = (allMatches as any[]) || [];
        if (matches.length === 0) continue;

        const highestRound = matches[0].round;
        const currentRoundMatches = matches.filter(m => m.round === highestRound);
        const allConfirmed = currentRoundMatches.every(m => m.status === 'confirmed');
        if (!allConfirmed) continue;

        // If this WAS the final round, mark the flight complete
        if (highestRound >= flight.num_rounds) {
          await admin
            .from('league_flights')
            .update({ status: 'completed' })
            .eq('id', flight.id);
          summary.flightsCompleted += 1;
          continue;
        }

        // Build MatchResult[] and generate next round
        const results: MatchResult[] = currentRoundMatches
          .filter(m => m.winner_entry_id && m.entry_a_id && m.entry_b_id)
          .map(m => ({
            round: m.round,
            matchIndex: m.match_index,
            bracketPosition: m.bracket_position,
            winnerId: m.winner_entry_id!,
            loserId: m.winner_entry_id === m.entry_a_id ? m.entry_b_id! : m.entry_a_id!,
          }));

        let nextRoundMatches: ReturnType<typeof generateNextRound> = [];
        if (leagueType === 'compass') {
          nextRoundMatches = generateNextRound(
            flight.size as 8 | 16,
            highestRound,
            results
          );
        } else if (leagueType === 'single_elimination') {
          nextRoundMatches = generateSingleEliminationNextRound(
            highestRound,
            flight.num_rounds,
            results
          );
        }
        // Round robin doesn't progress — all matches are created up front.
        if (nextRoundMatches.length === 0) continue;

        const leagueStart = new Date((league as any).start_date);
        const deadline = roundDeadline(leagueStart, highestRound + 1);
        const matchRows = nextRoundMatches.map(m => ({
          flight_id: flight.id,
          round: m.round,
          match_index: m.matchIndex,
          bracket_position: m.bracketPosition,
          entry_a_id: m.entryAId,
          entry_b_id: m.entryBId,
          deadline: deadline.toISOString().split('T')[0],
          status: 'pending',
        }));

        const { error: insertErr } = await admin
          .from('league_matches')
          .insert(matchRows);
        if (insertErr) {
          console.error('Next round insert failed:', insertErr);
          continue;
        }

        summary.nextRoundsGenerated += 1;
        summary.newMatches += matchRows.length;

        // Email every player in the new matches
        const entryIds = new Set<string>();
        for (const m of nextRoundMatches) {
          if (m.entryAId) entryIds.add(m.entryAId);
          if (m.entryBId) entryIds.add(m.entryBId);
        }
        if (entryIds.size > 0) {
          const { data: entries } = await admin
            .from('league_entries')
            .select('id, captain_name, captain_email, captain_token, partner_name, partner_email, partner_token')
            .in('id', Array.from(entryIds));
          const entryById = new Map((entries as any[] || []).map(e => [e.id, e]));
          const origin = new URL(request.url).origin;

          for (const m of nextRoundMatches) {
            const a = entryById.get(m.entryAId || '');
            const b = entryById.get(m.entryBId || '');
            if (!a || !b) continue;
            const opponentOfA = `${b.captain_name}${b.partner_name ? ' & ' + b.partner_name : ''}`;
            const opponentOfB = `${a.captain_name}${a.partner_name ? ' & ' + a.partner_name : ''}`;

            const sendOne = async (
              email: string | null,
              tokenOut: string | null,
              name: string,
              opponent: string
            ) => {
              if (!email || !tokenOut) return;
              const reportUrl = `${origin}/leagues/match/${tokenOut}`;
              try {
                await resend.emails.send({
                  from: FROM,
                  to: email,
                  subject: `Round ${m.round}: ${(league as any).name} — deadline ${deadline.toISOString().split('T')[0]}`,
                  html: `
                    <div style="font-family: -apple-system, sans-serif; max-width: 600px; padding: 20px;">
                      <h2 style="color: #ea580c;">Round ${m.round} is on</h2>
                      <p>Hi ${name},</p>
                      <p>You advanced! Your next match:</p>
                      <div style="background: #fff7ed; border-left: 4px solid #ea580c; padding: 14px 18px; border-radius: 6px; margin: 16px 0;">
                        <div style="font-size: 12px; color: #6b7280; text-transform: uppercase;">${m.bracketPosition}</div>
                        <div style="font-weight: 600; font-size: 16px; margin-top: 4px;">vs ${opponent}</div>
                        <div style="color: #6b7280; font-size: 14px; margin-top: 8px;">Deadline: <strong>${deadline.toISOString().split('T')[0]}</strong></div>
                      </div>
                      <p style="margin: 24px 0;">
                        <a href="${reportUrl}" style="display: inline-block; background: #ea580c; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500;">View match & report score</a>
                      </p>
                    </div>
                  `,
                });
                summary.emailsSent += 1;
              } catch (e) { console.error('email failed:', e); }
            };

            await sendOne(a.captain_email, a.captain_token, a.captain_name, opponentOfA);
            if (a.partner_email) await sendOne(a.partner_email, a.partner_token, a.partner_name || 'Player', opponentOfA);
            await sendOne(b.captain_email, b.captain_token, b.captain_name, opponentOfB);
            if (b.partner_email) await sendOne(b.partner_email, b.partner_token, b.partner_name || 'Player', opponentOfB);
          }
        }
      }

      // If every flight in this league is completed, mark the league completed.
      const { data: remaining } = await admin
        .from('league_flights')
        .select('status')
        .eq('league_id', lid);
      if (remaining && (remaining as any[]).length > 0 && (remaining as any[]).every(f => f.status === 'completed')) {
        await admin.from('leagues').update({ status: 'completed' }).eq('id', lid);
        summary.leaguesCompleted += 1;
      }
    }

    return NextResponse.json({ success: true, summary });
  } catch (err: any) {
    console.error('Progress error:', err);
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 });
  }
}

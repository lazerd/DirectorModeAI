/**
 * POST /api/leagues/[id]/generate-draws
 *
 * Director-only endpoint that:
 *  1. Verifies the caller owns this league
 *  2. For each enabled category, collects all PAID active entries
 *  3. Sorts them by composite_score (desc)
 *  4. Runs assignEntriesToFlights to slice into 16-player / 8-player flights
 *  5. Creates league_flights rows and writes flight_id + seed_in_flight
 *     back onto entries. Waitlisted entries get marked entry_status='waitlisted'.
 *  6. Generates round-1 compass matches via generateRound1
 *  7. Sends a "You're in Round 1, here's your match" email to every placed
 *     player with magic links for score reporting
 *  8. Flips the league status to 'running'
 *
 * Idempotent-ish: if flights already exist for a category, it's skipped and
 * returned in the response as `already_generated`.
 */

import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { assignEntriesToFlights, CATEGORY_LABELS, type CategoryKey } from '@/lib/leagueUtils';
import { generateRound1, roundDeadline, type CompassEntry } from '@/lib/compassBracket';
import { generateRoundRobin } from '@/lib/roundRobinBracket';
import { generateSingleEliminationRound1 } from '@/lib/singleEliminationBracket';
import { buildRoundMatchEmailHtml } from '@/lib/leagueProgression';

type LeagueType = 'compass' | 'round_robin' | 'single_elimination';

const resend = new Resend(process.env.RESEND_API_KEY);

type GenerateResult = {
  category: string;
  flightsCreated: number;
  matchesCreated: number;
  waitlisted: number;
  cancelled: boolean;
  skipped?: 'already_generated';
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: leagueId } = await params;

    // Auth: must be the director of this league
    const userClient = await createClient();
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = getSupabaseAdmin();

    // Optional category filter so directors can generate draws one category at a time.
    const body = await request.json().catch(() => ({}));
    const onlyCategoryKey: CategoryKey | null =
      typeof body?.categoryKey === 'string' ? (body.categoryKey as CategoryKey) : null;

    const { data: league, error: leagueErr } = await admin
      .from('leagues')
      .select('id, name, slug, director_id, start_date, status, league_type')
      .eq('id', leagueId)
      .maybeSingle();
    if (leagueErr || !league) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 });
    }
    if ((league as any).director_id !== user.id) {
      return NextResponse.json({ error: 'Not the league director' }, { status: 403 });
    }

    const leagueType = ((league as any).league_type || 'compass') as LeagueType;

    // Load categories + paid active entries
    const { data: categoriesRaw } = await admin
      .from('league_categories')
      .select('id, category_key, is_enabled')
      .eq('league_id', leagueId);
    const categories = onlyCategoryKey
      ? ((categoriesRaw as any[]) || []).filter(c => c.category_key === onlyCategoryKey)
      : (categoriesRaw as any[]) || [];

    const results: GenerateResult[] = [];
    const playerEmailsToSend: Array<{
      email: string;
      name: string;
      opponentName: string;
      opponentEmail: string | null;
      opponentPhone: string | null;
      categoryLabel: string;
      bracketPosition: string | null;
      leagueName: string;
      token: string;
      roundNumber: number;
      deadline: string;
    }> = [];

    for (const cat of categories) {
      if (!cat.is_enabled) continue;
      const categoryKey = cat.category_key as CategoryKey;
      const categoryLabel = CATEGORY_LABELS[categoryKey];

      // Skip if any flights already exist for this category
      const { data: existingFlights } = await admin
        .from('league_flights')
        .select('id')
        .eq('category_id', cat.id);
      if (existingFlights && existingFlights.length > 0) {
        results.push({
          category: categoryLabel,
          flightsCreated: 0,
          matchesCreated: 0,
          waitlisted: 0,
          cancelled: false,
          skipped: 'already_generated',
        });
        continue;
      }

      // Fetch paid active entries. Sort by manual_seed first (nulls last),
      // then by composite_score desc. Manual overrides always win.
      const { data: paidEntries } = await admin
        .from('league_entries')
        .select('id, composite_score, manual_seed, captain_name, captain_email, captain_phone, captain_token, partner_name, partner_email, partner_phone, partner_token')
        .eq('league_id', leagueId)
        .eq('category_id', cat.id)
        .eq('payment_status', 'paid')
        .eq('entry_status', 'active');

      const entryList = ((paidEntries as any[]) || []).sort((a, b) => {
        // Manual seeds first (nulls last)
        const am = a.manual_seed;
        const bm = b.manual_seed;
        if (am != null && bm != null) return am - bm;
        if (am != null) return -1;
        if (bm != null) return 1;
        // Then composite desc
        const ac = a.composite_score ?? -Infinity;
        const bc = b.composite_score ?? -Infinity;
        return bc - ac;
      });
      const entryIds = entryList.map(e => e.id);

      // Round robin: one flight holds everyone (min 2, no 16-player cap)
      const assignment = leagueType === 'round_robin'
        ? entryIds.length < 2
          ? { flights: [], waitlistEntryIds: entryIds, cancelled: true }
          : {
              flights: [{ name: 'A', size: entryIds.length as 8 | 16, entryIds }],
              waitlistEntryIds: [] as string[],
              cancelled: false,
            }
        : leagueType === 'single_elimination'
          ? entryIds.length < 2
            ? { flights: [], waitlistEntryIds: entryIds, cancelled: true }
            : {
                flights: [{ name: 'A', size: entryIds.length as 8 | 16, entryIds }],
                waitlistEntryIds: [] as string[],
                cancelled: false,
              }
          : assignEntriesToFlights(entryIds);

      if (assignment.cancelled) {
        // Mark every entry as waitlisted so the director can manually refund
        if (entryList.length > 0) {
          await admin
            .from('league_entries')
            .update({ entry_status: 'waitlisted' })
            .in('id', entryList.map(e => e.id));
        }
        results.push({
          category: categoryLabel,
          flightsCreated: 0,
          matchesCreated: 0,
          waitlisted: entryList.length,
          cancelled: true,
        });
        continue;
      }

      let matchesCreated = 0;

      // Create flights + match rows + update entries
      for (const flight of assignment.flights) {
        const seededEntries: CompassEntry[] = flight.entryIds.map((id, idx) => ({
          id,
          seed: idx + 1,
        }));

        // Compute numRounds + R1 matches based on the league type.
        let numRounds: number;
        let initialMatches: any[];
        let allMatchesUpFront = false;

        if (leagueType === 'compass') {
          numRounds = flight.size === 16 ? 4 : 3;
          initialMatches = generateRound1(seededEntries, flight.size);
        } else if (leagueType === 'round_robin') {
          const rr = generateRoundRobin(seededEntries);
          numRounds = rr.numRounds;
          initialMatches = rr.matches;
          allMatchesUpFront = true;
        } else {
          // single_elimination
          const se = generateSingleEliminationRound1(seededEntries);
          numRounds = se.numRounds;
          initialMatches = se.matches;
        }

        const { data: newFlight, error: flightErr } = await admin
          .from('league_flights')
          .insert({
            league_id: leagueId,
            category_id: cat.id,
            flight_name: flight.name,
            size: flight.entryIds.length,
            num_rounds: numRounds,
            status: 'running',
          })
          .select('id')
          .single();
        if (flightErr || !newFlight) {
          console.error('Flight create failed:', flightErr);
          continue;
        }

        // Update entries with flight_id + seed (1-indexed within flight)
        for (let i = 0; i < flight.entryIds.length; i++) {
          await admin
            .from('league_entries')
            .update({ flight_id: (newFlight as any).id, seed_in_flight: i + 1 })
            .eq('id', flight.entryIds[i]);
        }

        const leagueStart = new Date((league as any).start_date);

        const matchRows = initialMatches.map((m: any) => ({
          flight_id: (newFlight as any).id,
          round: m.round,
          match_index: m.matchIndex,
          bracket_position: m.bracketPosition,
          entry_a_id: m.entryAId,
          entry_b_id: m.entryBId,
          deadline: roundDeadline(leagueStart, m.round).toISOString().split('T')[0],
          status: 'pending',
        }));
        const { error: matchErr } = await admin
          .from('league_matches')
          .insert(matchRows);
        if (matchErr) {
          console.error('Match insert failed:', matchErr);
          continue;
        }
        matchesCreated += matchRows.length;

        // Only send R1 emails for compass + single elim. Round robin gets
        // a different "here are all your matches for the league" email
        // since it's not progression-based.
        const r1OnlyMatches = allMatchesUpFront
          ? initialMatches.filter((m: any) => m.round === 1)
          : initialMatches;

        // Queue up emails for every player in this flight
        const entryById = new Map(entryList.map(e => [e.id, e]));
        for (const m of r1OnlyMatches as any[]) {
          const a = entryById.get(m.entryAId!);
          const b = entryById.get(m.entryBId!);
          if (!a || !b) continue;
          const opponentA = `${b.captain_name}${b.partner_name ? ' & ' + b.partner_name : ''}`;
          const opponentB = `${a.captain_name}${a.partner_name ? ' & ' + a.partner_name : ''}`;

          const matchRound = (m as any).round || 1;
          const matchDeadline = roundDeadline(leagueStart, matchRound)
            .toISOString()
            .split('T')[0];
          const bracketPosition = (m as any).bracketPosition || null;

          // Captain of A
          playerEmailsToSend.push({
            email: a.captain_email,
            name: a.captain_name,
            opponentName: opponentA,
            opponentEmail: b.captain_email,
            opponentPhone: b.captain_phone,
            categoryLabel,
            bracketPosition,
            leagueName: (league as any).name,
            token: a.captain_token,
            roundNumber: matchRound,
            deadline: matchDeadline,
          });
          // Partner of A
          if (a.partner_email && a.partner_token) {
            playerEmailsToSend.push({
              email: a.partner_email,
              name: a.partner_name || 'Player',
              opponentName: opponentA,
              opponentEmail: b.captain_email,
              opponentPhone: b.captain_phone,
              categoryLabel,
              bracketPosition,
              leagueName: (league as any).name,
              token: a.partner_token,
              roundNumber: matchRound,
              deadline: matchDeadline,
            });
          }
          // Captain of B
          playerEmailsToSend.push({
            email: b.captain_email,
            name: b.captain_name,
            opponentName: opponentB,
            opponentEmail: a.captain_email,
            opponentPhone: a.captain_phone,
            categoryLabel,
            bracketPosition,
            leagueName: (league as any).name,
            token: b.captain_token,
            roundNumber: matchRound,
            deadline: matchDeadline,
          });
          // Partner of B
          if (b.partner_email && b.partner_token) {
            playerEmailsToSend.push({
              email: b.partner_email,
              name: b.partner_name || 'Player',
              opponentName: opponentB,
              opponentEmail: a.captain_email,
              opponentPhone: a.captain_phone,
              categoryLabel,
              bracketPosition,
              leagueName: (league as any).name,
              token: b.partner_token,
              roundNumber: matchRound,
              deadline: matchDeadline,
            });
          }
        }
      }

      // Mark waitlisted entries (those past the last flight)
      if (assignment.waitlistEntryIds.length > 0) {
        await admin
          .from('league_entries')
          .update({ entry_status: 'waitlisted' })
          .in('id', assignment.waitlistEntryIds);
      }

      results.push({
        category: categoryLabel,
        flightsCreated: assignment.flights.length,
        matchesCreated,
        waitlisted: assignment.waitlistEntryIds.length,
        cancelled: false,
      });
    }

    // Flip league to running only if it's still open (per-category calls
    // shouldn't force it if other categories are still filling up).
    await admin
      .from('leagues')
      .update({ status: 'running' })
      .eq('id', leagueId)
      .eq('status', 'open');

    // Test leagues (name prefixed with [TEST]) skip email delivery so the
    // seeded @example.com addresses don't burn Resend quota or clutter the
    // inbox during demo / compass-draw QA runs.
    const isTestLeague = ((league as any).name || '').startsWith('[TEST]');

    // Fire-and-forget emails (don't block the response)
    const origin = new URL(request.url).origin;
    const publicBracketUrl = `${origin}/leagues/${(league as any).slug}/bracket`;
    const fromAddress = process.env.RESEND_FROM_EMAIL || 'CoachMode Leagues <noreply@mail.coachmode.ai>';
    if (isTestLeague) {
      // Skip — but still return emailCount=0 so the response shape is stable.
      return NextResponse.json({
        success: true,
        results,
        emailCount: 0,
        skippedEmails: playerEmailsToSend.length,
      });
    }
    (async () => {
      for (const msg of playerEmailsToSend) {
        const reportUrl = `${origin}/leagues/match/${msg.token}`;
        try {
          await resend.emails.send({
            from: fromAddress,
            to: msg.email,
            subject: `Round ${msg.roundNumber}: ${msg.leagueName} — deadline ${msg.deadline}`,
            html: buildRoundMatchEmailHtml({
              roundNumber: msg.roundNumber,
              playerName: msg.name,
              opponentName: msg.opponentName,
              opponentEmail: msg.opponentEmail,
              opponentPhone: msg.opponentPhone,
              leagueName: msg.leagueName,
              categoryLabel: msg.categoryLabel,
              bracketPosition: msg.bracketPosition,
              deadline: msg.deadline,
              reportUrl,
              publicBracketUrl,
            }),
          });
        } catch (e) {
          console.error(`Email send failed for ${msg.email}:`, e);
        }
      }
    })();

    return NextResponse.json({
      success: true,
      results,
      emailCount: playerEmailsToSend.length,
    });
  } catch (err: any) {
    console.error('Generate draws error:', err);
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 });
  }
}

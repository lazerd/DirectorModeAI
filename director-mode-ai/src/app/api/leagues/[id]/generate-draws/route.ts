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
import { assignEntriesToFlights, CATEGORY_LABELS, isDoubles, type CategoryKey } from '@/lib/leagueUtils';
import { generateRound1, roundDeadline, type CompassEntry } from '@/lib/compassBracket';

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

    const { data: league, error: leagueErr } = await admin
      .from('leagues')
      .select('id, name, slug, director_id, start_date, status')
      .eq('id', leagueId)
      .maybeSingle();
    if (leagueErr || !league) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 });
    }
    if ((league as any).director_id !== user.id) {
      return NextResponse.json({ error: 'Not the league director' }, { status: 403 });
    }

    // Load categories + paid active entries
    const { data: categories } = await admin
      .from('league_categories')
      .select('id, category_key, is_enabled')
      .eq('league_id', leagueId);

    const results: GenerateResult[] = [];
    const playerEmailsToSend: Array<{
      email: string;
      name: string;
      opponentName: string;
      opponentEmail: string | null;
      opponentPhone: string | null;
      categoryLabel: string;
      leagueName: string;
      captainToken: string;
      partnerToken?: string | null;
      deadline: string;
    }> = [];

    for (const cat of (categories as any[]) || []) {
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

      // Fetch paid active entries sorted by composite_score desc
      const { data: paidEntries } = await admin
        .from('league_entries')
        .select('id, composite_score, captain_name, captain_email, captain_phone, captain_token, partner_name, partner_email, partner_phone, partner_token')
        .eq('league_id', leagueId)
        .eq('category_id', cat.id)
        .eq('payment_status', 'paid')
        .eq('entry_status', 'active')
        .order('composite_score', { ascending: false, nullsFirst: false });

      const entryList = (paidEntries as any[]) || [];
      const entryIds = entryList.map(e => e.id);
      const assignment = assignEntriesToFlights(entryIds);

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
        const numRounds = flight.size === 16 ? 4 : 3;

        const { data: newFlight, error: flightErr } = await admin
          .from('league_flights')
          .insert({
            league_id: leagueId,
            category_id: cat.id,
            flight_name: flight.name,
            size: flight.size,
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

        // Generate R1 matches
        const seededEntries: CompassEntry[] = flight.entryIds.map((id, idx) => ({
          id,
          seed: idx + 1,
        }));
        const r1Matches = generateRound1(seededEntries, flight.size);
        const leagueStart = new Date((league as any).start_date);
        const deadline = roundDeadline(leagueStart, 1);

        const matchRows = r1Matches.map(m => ({
          flight_id: (newFlight as any).id,
          round: 1,
          match_index: m.matchIndex,
          bracket_position: m.bracketPosition,
          entry_a_id: m.entryAId,
          entry_b_id: m.entryBId,
          deadline: deadline.toISOString().split('T')[0],
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

        // Queue up emails for every player in this flight
        const entryById = new Map(entryList.map(e => [e.id, e]));
        for (const m of r1Matches) {
          const a = entryById.get(m.entryAId!);
          const b = entryById.get(m.entryBId!);
          if (!a || !b) continue;
          const opponentA = `${b.captain_name}${b.partner_name ? ' & ' + b.partner_name : ''}`;
          const opponentB = `${a.captain_name}${a.partner_name ? ' & ' + a.partner_name : ''}`;

          // Captain of A
          playerEmailsToSend.push({
            email: a.captain_email,
            name: a.captain_name,
            opponentName: opponentA,
            opponentEmail: b.captain_email,
            opponentPhone: b.captain_phone,
            categoryLabel,
            leagueName: (league as any).name,
            captainToken: a.captain_token,
            deadline: deadline.toISOString().split('T')[0],
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
              leagueName: (league as any).name,
              captainToken: a.partner_token,
              deadline: deadline.toISOString().split('T')[0],
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
            leagueName: (league as any).name,
            captainToken: b.captain_token,
            deadline: deadline.toISOString().split('T')[0],
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
              leagueName: (league as any).name,
              captainToken: b.partner_token,
              deadline: deadline.toISOString().split('T')[0],
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

    // Flip league to running
    await admin
      .from('leagues')
      .update({ status: 'running' })
      .eq('id', leagueId);

    // Fire-and-forget emails (don't block the response)
    const origin = new URL(request.url).origin;
    const fromAddress = process.env.RESEND_FROM_EMAIL || 'CoachMode Leagues <noreply@mail.coachmode.ai>';
    (async () => {
      for (const msg of playerEmailsToSend) {
        const reportUrl = `${origin}/leagues/match/${msg.captainToken}`;
        try {
          await resend.emails.send({
            from: fromAddress,
            to: msg.email,
            subject: `Round 1: ${msg.leagueName} — deadline ${msg.deadline}`,
            html: `
              <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #ea580c; margin-top: 0;">Round 1 is on</h2>
                <p>Hi ${msg.name},</p>
                <p>The draws for <strong>${msg.leagueName}</strong> are live. Here's your first match:</p>
                <div style="background: #fff7ed; border-left: 4px solid #ea580c; padding: 14px 18px; border-radius: 6px; margin: 16px 0;">
                  <div style="color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em;">${msg.categoryLabel}</div>
                  <div style="font-weight: 600; font-size: 16px; margin-top: 4px;">vs ${msg.opponentName}</div>
                  <div style="color: #6b7280; font-size: 14px; margin-top: 8px;">Deadline: <strong>${msg.deadline}</strong></div>
                </div>
                <p>Schedule the match directly with your opponent:</p>
                <ul style="color: #374151;">
                  <li><strong>Email:</strong> ${msg.opponentEmail || 'not provided'}</li>
                  ${msg.opponentPhone ? `<li><strong>Phone:</strong> ${msg.opponentPhone}</li>` : ''}
                </ul>
                <p>When the match is finished, any player can report the score here:</p>
                <p style="margin: 24px 0;">
                  <a href="${reportUrl}" style="display: inline-block; background: #ea580c; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500;">Report score</a>
                </p>
                <p style="color: #6b7280; font-size: 12px; margin-top: 32px;">
                  Save this email — the link is your unique score-reporting URL. If your opponent reports first, you'll get another email with a dispute button.
                </p>
              </div>
            `,
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

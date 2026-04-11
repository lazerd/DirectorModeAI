/**
 * POST /api/leagues/[id]/send-reminders
 *
 * Director-only. Sends reminder emails to any player whose current R-match
 * is within 3 days of the deadline and hasn't been reported yet.
 * Safe to call repeatedly — it doesn't track state, but the director can
 * judge timing by checking which matches are actually overdue.
 */

import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.RESEND_FROM_EMAIL || 'CoachMode Leagues <noreply@mail.coachmode.ai>';

const WARNING_WINDOW_DAYS = 3;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: leagueId } = await params;

    const userClient = await createClient();
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = getSupabaseAdmin();

    const { data: league } = await admin
      .from('leagues')
      .select('id, name, slug, director_id')
      .eq('id', leagueId)
      .maybeSingle();
    if (!league || (league as any).director_id !== user.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }
    const leagueSlug = (league as any).slug as string;

    // Get all flights for this league
    const { data: flights } = await admin
      .from('league_flights')
      .select('id')
      .eq('league_id', leagueId);
    const flightIds = ((flights as any[]) || []).map(f => f.id);
    if (flightIds.length === 0) {
      return NextResponse.json({ sent: 0, message: 'No flights yet.' });
    }

    const warningDate = new Date();
    warningDate.setDate(warningDate.getDate() + WARNING_WINDOW_DAYS);
    const warningDateStr = warningDate.toISOString().split('T')[0];

    const { data: pendingMatches } = await admin
      .from('league_matches')
      .select('id, flight_id, round, deadline, bracket_position, entry_a_id, entry_b_id')
      .in('flight_id', flightIds)
      .eq('status', 'pending')
      .lte('deadline', warningDateStr);

    if (!pendingMatches || (pendingMatches as any[]).length === 0) {
      return NextResponse.json({ sent: 0, message: 'Nothing needs a reminder.' });
    }

    const entryIdSet = new Set<string>();
    for (const m of pendingMatches as any[]) {
      if (m.entry_a_id) entryIdSet.add(m.entry_a_id);
      if (m.entry_b_id) entryIdSet.add(m.entry_b_id);
    }
    const { data: entries } = await admin
      .from('league_entries')
      .select('id, captain_name, captain_email, captain_token, partner_name, partner_email, partner_token')
      .in('id', Array.from(entryIdSet));
    const byId = new Map(((entries as any[]) || []).map(e => [e.id, e]));

    const origin = new URL(_request.url).origin;
    const publicBracketUrl = `${origin}/leagues/${leagueSlug}/bracket`;
    let sent = 0;

    for (const m of pendingMatches as any[]) {
      const a = byId.get(m.entry_a_id);
      const b = byId.get(m.entry_b_id);
      if (!a || !b) continue;
      const opponentOfA = `${b.captain_name}${b.partner_name ? ' & ' + b.partner_name : ''}`;
      const opponentOfB = `${a.captain_name}${a.partner_name ? ' & ' + a.partner_name : ''}`;

      const sendOne = async (email: string | null, token: string | null, name: string, opponent: string) => {
        if (!email || !token) return;
        const reportUrl = `${origin}/leagues/match/${token}`;
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
                  The bracket page is public — share it with anyone.
                </p>
              </div>
            `,
          });
          sent += 1;
        } catch (e) { console.error('reminder failed:', e); }
      };

      await sendOne(a.captain_email, a.captain_token, a.captain_name, opponentOfA);
      if (a.partner_email) await sendOne(a.partner_email, a.partner_token, a.partner_name, opponentOfA);
      await sendOne(b.captain_email, b.captain_token, b.captain_name, opponentOfB);
      if (b.partner_email) await sendOne(b.partner_email, b.partner_token, b.partner_name, opponentOfB);
    }

    return NextResponse.json({ sent, matches: (pendingMatches as any[]).length });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 });
  }
}

/**
 * POST /api/leagues/[id]/jtt/results-email
 *
 * Director-only. Builds the JTT match-day results email for a given date and
 * either previews it or sends it to the league's coaches.
 *
 * Body:
 *   {
 *     date: 'YYYY-MM-DD',
 *     mode: 'preview' | 'send',
 *     recipients?: string[],   // send mode; defaults to club contact emails
 *     note?: string            // optional director note shown atop the email
 *   }
 *
 * preview → { subject, html, defaultRecipients: {email,name}[], availableDates }
 * send    → { sent, skipped, failed }
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import {
  buildJTTResultsEmail,
  datesWithResults,
  type EmailClub,
  type EmailDivision,
  type EmailDivisionClub,
  type EmailRoster,
  type EmailMatchup,
  type EmailLine,
} from '@/lib/jttResultsEmail';
import { sendBilledEmail, creditLimitResponse, CreditLimitError } from '@/lib/email';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: leagueId } = await params;
    const body = await request.json().catch(() => ({}));
    const date: string = String(body.date || '').slice(0, 10);
    const mode: 'preview' | 'send' = body.mode === 'send' ? 'send' : 'preview';
    const note: string | null = typeof body.note === 'string' ? body.note.slice(0, 1000) : null;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'A valid date (YYYY-MM-DD) is required.' }, { status: 400 });
    }

    // --- Auth: must be the league director ---
    const userClient = await createClient();
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = getSupabaseAdmin();
    const { data: league } = await admin
      .from('leagues')
      .select('id, name, director_id, format')
      .eq('id', leagueId)
      .maybeSingle();
    if (!league || (league as any).director_id !== user.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }
    if ((league as any).format !== 'team') {
      return NextResponse.json({ error: 'Not a JTT (team-format) league.' }, { status: 400 });
    }

    // --- Pull league data ---
    const [cRes, dRes, dcRes, rRes, mRes] = await Promise.all([
      admin.from('league_clubs').select('id, name, short_code, color, contact_name, contact_email').eq('league_id', leagueId).order('sort_order'),
      admin.from('league_divisions').select('id, name, short_code, sort_order').eq('league_id', leagueId).order('sort_order'),
      admin.from('league_division_clubs').select('division_id, club_id'),
      admin.from('league_team_rosters').select('id, player_name, division_id, club_id'),
      admin.from('league_team_matchups').select('id, division_id, match_date, home_club_id, away_club_id, home_lines_won, away_lines_won, winner, status'),
    ]);

    const clubsRaw = (cRes.data as Array<EmailClub & { contact_name: string | null; contact_email: string | null }>) || [];
    const divisions = (dRes.data as EmailDivision[]) || [];
    const divisionIds = new Set(divisions.map(d => d.id));
    const divisionClubs = ((dcRes.data as EmailDivisionClub[]) || []).filter(dc => divisionIds.has(dc.division_id));
    const rosters = ((rRes.data as EmailRoster[]) || []).filter(r => divisionIds.has(r.division_id));
    const matchups = ((mRes.data as EmailMatchup[]) || []).filter(m => divisionIds.has(m.division_id));

    let lines: EmailLine[] = [];
    if (matchups.length > 0) {
      const { data: lRes } = await admin
        .from('league_matchup_lines')
        .select('id, matchup_id, line_type, line_number, home_player1_id, home_player2_id, away_player1_id, away_player2_id, score, winner, status')
        .in('matchup_id', matchups.map(m => m.id));
      lines = (lRes as EmailLine[]) || [];
    }

    const clubs: EmailClub[] = clubsRaw.map(c => ({ id: c.id, name: c.name, short_code: c.short_code, color: c.color }));
    const email = buildJTTResultsEmail({
      leagueName: (league as any).name,
      date,
      clubs,
      divisions,
      divisionClubs,
      rosters,
      matchups,
      lines,
      note,
    });

    const defaultRecipients = clubsRaw
      .filter(c => c.contact_email && EMAIL_RE.test(c.contact_email))
      .map(c => ({ email: c.contact_email as string, name: c.contact_name || c.name }));

    if (mode === 'preview') {
      return NextResponse.json({
        subject: email.subject,
        html: email.html,
        defaultRecipients,
        availableDates: datesWithResults(matchups, lines),
      });
    }

    // --- Send ---
    const requested: string[] = Array.isArray(body.recipients) ? body.recipients : [];
    const recipients = (requested.length ? requested : defaultRecipients.map(r => r.email))
      .map(e => String(e).trim().toLowerCase())
      .filter((e, i, arr) => EMAIL_RE.test(e) && arr.indexOf(e) === i);

    if (recipients.length === 0) {
      return NextResponse.json({ error: 'No valid recipient emails. Add coach emails on the Settings tab or enter them manually.' }, { status: 400 });
    }

    const replyTo = user.email || undefined;
    let sent = 0, skipped = 0, failed = 0;
    for (const to of recipients) {
      try {
        const r = await sendBilledEmail((league as any).director_id, {
          to,
          subject: email.subject,
          html: email.html,
          replyTo,
        });
        if (r.sent) sent++; else skipped++;
      } catch (err) {
        if (err instanceof CreditLimitError) return creditLimitResponse(err);
        failed++;
      }
    }

    return NextResponse.json({ sent, skipped, failed, total: recipients.length });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 });
  }
}

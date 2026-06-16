/**
 * POST /api/leagues/[id]/jtt/matchup/[matchupId]/confirm-email
 *
 * Director-only. Day-before match confirmation. Reads who marked themselves
 * "Available" in the Sleepy Hollow availability form (Google Sheet) for this
 * matchup's division + date, then previews or sends a confirmation email to
 * those players' parents confirming date / time / host-club location.
 *
 * NOTE: source of truth is the availability FORM (RSVP), not day-of check-ins.
 *
 * Body: { mode: 'preview' | 'send', recipients?: string[], note?: string }
 *
 * preview → { subject, html, defaultRecipients, availableCount, maybeCount }
 * send    → { sent, skipped, failed, total }
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { buildJTTConfirmationEmail } from '@/lib/jttMatchEmail';
import { fetchAvailability } from '@/lib/jttAvailability';
import { sendBilledEmail, creditLimitResponse, CreditLimitError } from '@/lib/email';

export const runtime = 'nodejs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; matchupId: string }> }
) {
  try {
    const { id: leagueId, matchupId } = await params;
    const body = await request.json().catch(() => ({}));
    const mode: 'preview' | 'send' = body.mode === 'send' ? 'send' : 'preview';
    const note: string | null = typeof body.note === 'string' ? body.note.slice(0, 1000) : null;

    // --- Auth: must be the league director ---
    const userClient = await createClient();
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = getSupabaseAdmin();
    const { data: league } = await admin
      .from('leagues')
      .select('id, name, director_id')
      .eq('id', leagueId)
      .maybeSingle();
    if (!league || (league as any).director_id !== user.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    // --- Matchup + division + clubs ---
    const { data: matchup } = await admin
      .from('league_team_matchups')
      .select('id, division_id, match_date, start_time, home_club_id, away_club_id')
      .eq('id', matchupId)
      .maybeSingle();
    if (!matchup || (matchup as any).division_id == null) {
      return NextResponse.json({ error: 'Matchup not found.' }, { status: 404 });
    }
    const m = matchup as any;

    const [dRes, cRes] = await Promise.all([
      admin.from('league_divisions').select('id, name, short_code, start_time, end_time, league_id').eq('id', m.division_id).maybeSingle(),
      admin.from('league_clubs').select('id, name, short_code').in('id', [m.home_club_id, m.away_club_id]),
    ]);

    const division = dRes.data as any;
    if (!division || division.league_id !== leagueId) {
      return NextResponse.json({ error: 'Matchup is not in this league.' }, { status: 400 });
    }
    const clubs = (cRes.data as Array<{ id: string; name: string; short_code: string }>) || [];
    const homeClub = clubs.find(c => c.id === m.home_club_id);
    const awayClub = clubs.find(c => c.id === m.away_club_id);
    const shClub = clubs.find(c => c.short_code === 'SH');

    // The availability form only covers Sleepy Hollow players.
    if (!shClub) {
      return NextResponse.json(
        { error: 'This match doesn’t involve Sleepy Hollow. The availability form only covers SH players, so there’s no one to confirm here.' },
        { status: 400 }
      );
    }

    const matchDate = String(m.match_date).slice(0, 10);

    // --- Read availability from the Google form/sheet ---
    let available: Awaited<ReturnType<typeof fetchAvailability>> = [];
    try {
      const entries = await fetchAvailability(division.short_code, matchDate);
      available = entries;
    } catch (err: any) {
      return NextResponse.json({ error: err?.message || 'Could not read the availability sheet.' }, { status: 502 });
    }

    const yes = available.filter(e => e.status === 'available');
    const maybe = available.filter(e => e.status === 'maybe');

    const email = buildJTTConfirmationEmail({
      leagueName: (league as any).name,
      divisionName: division.name,
      date: matchDate,
      startTime: m.start_time || division.start_time || null,
      endTime: division.end_time || null,
      homeClubName: homeClub?.name || 'Home',
      awayClubName: awayClub?.name || 'Away',
      confirmed: yes.map(e => ({ name: e.player_name, clubName: shClub.name, clubShort: 'SH' })),
      maybe: maybe.map(e => e.player_name),
      note,
    });

    // Recipients: parent emails of AVAILABLE players plus MAYBE players (so the
    // day-before confirmation also nudges the tentative ones). Deduped by email,
    // Available first. The email body still lists maybes as tentative.
    // A single "parent email" cell may hold MULTIPLE addresses (comma/semicolon/
    // slash separated) — e.g. both guardians — so split and include each.
    const splitEmails = (raw: string | null | undefined): string[] =>
      (raw || '')
        .split(/[,;/\s]+/)
        .map(s => s.trim())
        .filter(s => EMAIL_RE.test(s));
    const seenDefault = new Set<string>();
    const defaultRecipients: { email: string; name: string }[] = [];
    for (const e of [...yes, ...maybe]) {
      for (const addr of splitEmails(e.parent_email)) {
        const key = addr.toLowerCase();
        if (seenDefault.has(key)) continue;
        seenDefault.add(key);
        defaultRecipients.push({ email: addr, name: e.parent_name || e.player_name });
      }
    }

    if (mode === 'preview') {
      return NextResponse.json({
        subject: email.subject,
        html: email.html,
        defaultRecipients,
        availableCount: yes.length,
        maybeCount: maybe.length,
      });
    }

    // --- Send ---
    const requested: string[] = Array.isArray(body.recipients) ? body.recipients : [];
    const recipients = (requested.length ? requested : defaultRecipients.map(r => r.email))
      .map(e => String(e).trim().toLowerCase())
      .filter((e, i, arr) => EMAIL_RE.test(e) && arr.indexOf(e) === i);

    if (recipients.length === 0) {
      return NextResponse.json({ error: 'No valid recipient emails among the available players. Check that their parent emails are filled in on the form.' }, { status: 400 });
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

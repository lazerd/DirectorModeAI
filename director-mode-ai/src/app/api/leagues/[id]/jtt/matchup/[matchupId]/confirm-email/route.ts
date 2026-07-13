/**
 * POST /api/leagues/[id]/jtt/matchup/[matchupId]/confirm-email
 *
 * Director-only. Day-before match confirmation. Merges two availability
 * sources — the in-app RSVP magic links (league_player_availability +
 * check-ins, exact per matchup) and the legacy Sleepy Hollow Google Form
 * (division + date) — then previews or sends a confirmation email to those
 * players' parents confirming date / time / host-club location. An explicit
 * "no" via the RSVP link removes a player even if the form said Available.
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

    // --- Availability source 1: the in-app RSVP magic links (per-matchup) ---
    // league_player_availability holds explicit yes/no; a coach check-in also
    // counts as a yes. This is exact per matchup, so it wins over the sheet.
    const [dbAvailRes, checkinsRes] = await Promise.all([
      admin.from('league_player_availability').select('roster_id, status').eq('matchup_id', matchupId),
      admin.from('league_matchup_checkins').select('roster_id').eq('matchup_id', matchupId),
    ]);
    const dbAvail = (dbAvailRes.data as Array<{ roster_id: string; status: 'yes' | 'no' }>) || [];
    const checkinIds = ((checkinsRes.data as Array<{ roster_id: string }>) || []).map(c => c.roster_id);
    const yesIds = new Set([
      ...dbAvail.filter(a => a.status === 'yes').map(a => a.roster_id),
      ...checkinIds,
    ]);
    const respondedIds = new Set([...dbAvail.map(a => a.roster_id), ...checkinIds]);

    type Entry = Awaited<ReturnType<typeof fetchAvailability>>[number];
    const dbYes: Entry[] = [];
    const declinedNames = new Set<string>();
    if (respondedIds.size > 0) {
      const { data: rosterRows } = await admin
        .from('league_team_rosters')
        .select('id, player_name, parent_name, parent_email, parent_phone')
        .in('id', [...respondedIds])
        .eq('club_id', shClub.id);
      for (const r of (rosterRows as Array<{ id: string; player_name: string; parent_name: string | null; parent_email: string | null; parent_phone: string | null }>) || []) {
        if (yesIds.has(r.id)) {
          dbYes.push({
            player_name: r.player_name,
            parent_name: r.parent_name || '',
            parent_email: r.parent_email || '',
            parent_phone: r.parent_phone || '',
            status: 'available',
          });
        } else {
          declinedNames.add(r.player_name.trim().toLowerCase());
        }
      }
    }

    // --- Availability source 2: the legacy Google form/sheet ---
    let sheetEntries: Entry[] = [];
    let sheetError: string | null = null;
    try {
      sheetEntries = await fetchAvailability(division.short_code, matchDate);
    } catch (err: any) {
      sheetError = err?.message || 'Could not read the availability sheet.';
    }
    if (sheetError && dbYes.length === 0) {
      return NextResponse.json({ error: sheetError }, { status: 502 });
    }

    // Merge: sheet first, drop anyone who explicitly declined via their RSVP
    // link, then overlay the in-app yeses (exact per-matchup, so they win).
    const byName = new Map<string, Entry>();
    for (const e of sheetEntries) byName.set(e.player_name.trim().toLowerCase(), e);
    for (const name of declinedNames) byName.delete(name);
    for (const e of dbYes) byName.set(e.player_name.trim().toLowerCase(), e);
    const available = [...byName.values()].sort((a, b) => a.player_name.localeCompare(b.player_name));

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

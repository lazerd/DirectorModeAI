/**
 * POST /api/leagues/[id]/jtt/matchup/[matchupId]/confirm-email
 *
 * Director-only. Builds a "you're confirmed for this match" email listing every
 * checked-in (confirmed) player for the matchup and confirming the date / time /
 * location, then previews or sends it to those players' parents.
 *
 * Body: { mode: 'preview' | 'send', recipients?: string[], note?: string }
 *
 * preview → { subject, html, defaultRecipients: {email,name}[], confirmedCount }
 * send    → { sent, skipped, failed, total }
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { buildJTTConfirmationEmail } from '@/lib/jttMatchEmail';
import { sendBilledEmail, creditLimitResponse, CreditLimitError } from '@/lib/email';

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
      .select('id, name, director_id, format')
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

    const [dRes, cRes, ciRes] = await Promise.all([
      admin.from('league_divisions').select('id, name, start_time, end_time, league_id').eq('id', m.division_id).maybeSingle(),
      admin.from('league_clubs').select('id, name, short_code').in('id', [m.home_club_id, m.away_club_id]),
      admin.from('league_matchup_checkins').select('roster_id').eq('matchup_id', matchupId),
    ]);

    const division = dRes.data as any;
    if (!division || division.league_id !== leagueId) {
      return NextResponse.json({ error: 'Matchup is not in this league.' }, { status: 400 });
    }
    const clubs = (cRes.data as Array<{ id: string; name: string; short_code: string }>) || [];
    const homeClub = clubs.find(c => c.id === m.home_club_id);
    const awayClub = clubs.find(c => c.id === m.away_club_id);
    const clubById = new Map(clubs.map(c => [c.id, c]));

    const checkedInIds = ((ciRes.data as Array<{ roster_id: string }>) || []).map(x => x.roster_id);

    let confirmedRosters: Array<{
      id: string; player_name: string; club_id: string; ladder_position: number | null;
      parent_email: string | null; parent_name: string | null; player_email: string | null;
    }> = [];
    if (checkedInIds.length > 0) {
      const { data: rRes } = await admin
        .from('league_team_rosters')
        .select('id, player_name, club_id, ladder_position, parent_email, parent_name, player_email')
        .in('id', checkedInIds);
      confirmedRosters = (rRes as typeof confirmedRosters) || [];
    }

    // Order: home club first, then away; ladder order within each club.
    const order = (clubId: string) => (clubId === m.home_club_id ? 0 : 1);
    confirmedRosters.sort(
      (a, b) =>
        order(a.club_id) - order(b.club_id) ||
        (a.ladder_position ?? 9999) - (b.ladder_position ?? 9999) ||
        a.player_name.localeCompare(b.player_name)
    );

    const confirmed = confirmedRosters.map(r => ({
      name: r.player_name,
      clubName: clubById.get(r.club_id)?.name || '',
      clubShort: clubById.get(r.club_id)?.short_code || '',
    }));

    const email = buildJTTConfirmationEmail({
      leagueName: (league as any).name,
      divisionName: division.name,
      date: String(m.match_date).slice(0, 10),
      startTime: m.start_time || division.start_time || null,
      endTime: division.end_time || null,
      homeClubName: homeClub?.name || 'Home',
      awayClubName: awayClub?.name || 'Away',
      confirmed,
      note,
    });

    // Recipients: parent_email (preferred) or player_email of each confirmed player.
    const defaultRecipients = confirmedRosters
      .map(r => {
        const e = (r.parent_email || r.player_email || '').trim();
        return e ? { email: e, name: r.parent_name || r.player_name } : null;
      })
      .filter((x): x is { email: string; name: string } => !!x && EMAIL_RE.test(x.email));

    if (mode === 'preview') {
      return NextResponse.json({
        subject: email.subject,
        html: email.html,
        defaultRecipients,
        confirmedCount: confirmed.length,
      });
    }

    // --- Send ---
    const requested: string[] = Array.isArray(body.recipients) ? body.recipients : [];
    const recipients = (requested.length ? requested : defaultRecipients.map(r => r.email))
      .map(e => String(e).trim().toLowerCase())
      .filter((e, i, arr) => EMAIL_RE.test(e) && arr.indexOf(e) === i);

    if (recipients.length === 0) {
      return NextResponse.json({ error: 'No valid recipient emails. Confirmed players need a parent or player email on the roster.' }, { status: 400 });
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

/**
 * Preview or send the pre-match note to the OPPOSING captain when we're hosting.
 *   POST { match_id, preview?, to?, name?, host_notes?, intro?, save_notes? }
 *
 * `preview: true` renders the exact email that sending would produce — same
 * builder, same recipient — and sends nothing. The UI must always preview
 * first: this email goes to someone at another club, so there is no undo and no
 * "ignore that, wrong draft" that isn't embarrassing.
 *
 * Sending stamps captain_matches.host_email_sent_at so the button can show it
 * has already gone out, and persists the recipient + venue notes so next home
 * match is pre-filled rather than retyped.
 */
import { NextResponse } from 'next/server';
import { requireTeam, isError } from '@/lib/captain/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import {
  opponentHostingEmail,
  hostingBodyText,
  defaultHostingSubject,
  visitingBodyText,
  defaultVisitingSubject,
  type MatchInfo,
} from '@/lib/captain/emails';
import { CLUB_TZ } from '@/lib/captain/clubTime';
import { leagueSpec } from '@/lib/captain/leagues';
import { sendBilledEmails, creditLimitResponse } from '@/lib/email';
import { CreditLimitError } from '@/lib/billing';

export const dynamic = 'force-dynamic';

type Body = {
  match_id?: string;
  preview?: boolean;
  to?: string;
  name?: string;
  host_notes?: string;
  lines_note?: string;
  /** The captain's own words. Sent verbatim. */
  body?: string;
  intro?: string;
  subject?: string;
  from_name?: string;
  from_title?: string;
  /** Persist host_notes onto the team so every future home match pre-fills. */
  save_notes?: boolean;
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const matchId = body.match_id;
  if (!matchId) return NextResponse.json({ error: 'match_id is required.' }, { status: 400 });

  const db = await createServiceClient();
  const { data: matchRow } = await db
    .from('captain_matches')
    .select(
      'id, team_id, match_at, is_home, opponent, location, arrival_note, opposing_captain_name, opposing_captain_email, opposing_captain_phone, doubles_courts, singles_courts, host_email_sent_at',
    )
    .eq('id', matchId)
    .maybeSingle();
  if (!matchRow) return NextResponse.json({ error: 'Match not found.' }, { status: 404 });

  const ctx = await requireTeam(matchRow.team_id as string);
  if (isError(ctx)) return ctx.error;

  const admin = getSupabaseAdmin();
  const { data: team } = await admin
    .from('captain_teams')
    .select('id, name, club_id, host_notes, league_type, court_format')
    .eq('id', matchRow.team_id)
    .maybeSingle();
  if (!team) return NextResponse.json({ error: 'Team not found.' }, { status: 404 });

  // Club supplies the venue name and address so the captain isn't retyping the
  // club's own details into every email.
  let clubName = (matchRow.location as string) || 'our club';
  let address: string | null = null;
  if (team.club_id) {
    const { data: club } = await admin
      .from('cc_clubs')
      .select('name, address, city, state, zip')
      .eq('id', team.club_id)
      .maybeSingle();
    if (club) {
      clubName = club.name || clubName;
      const parts = [club.address, [club.city, club.state].filter(Boolean).join(', '), club.zip]
        .filter(Boolean)
        .join(', ');
      address = parts || null;
    }
  }

  // Signed by a human: this is a courtesy note between captains, and an
  // unsigned one reads like an automated blast.
  const { data: me } = await admin
    .from('profiles')
    .select('full_name, email')
    .eq('id', ctx.userId)
    .maybeSingle();
  const fromName =
    (body.from_name ?? me?.full_name ?? me?.email?.split('@')[0] ?? '').trim() || null;
  const fromTitle = (body.from_title ?? '').trim() || null;

  /**
   * Fall back to whatever we already know about this opponent from another
   * fixture. Captains are per-club, not per-match, so once it has been typed
   * anywhere for this team it should never be asked for again.
   */
  let known: { email: string | null; name: string | null } = {
    email: (matchRow.opposing_captain_email as string | null) ?? null,
    name: (matchRow.opposing_captain_name as string | null) ?? null,
  };
  // The opponent directory is the real source: contacts are pulled off the
  // league site once per season and apply to every fixture against that club.
  if (!known.email && matchRow.opponent) {
    const { data: opp } = await admin
      .from('captain_opponents')
      .select('captain_name, captain_email')
      .eq('team_id', matchRow.team_id)
      .eq('opponent', matchRow.opponent as string)
      .maybeSingle();
    if (opp?.captain_email) {
      known = {
        email: opp.captain_email as string,
        name: (opp.captain_name as string | null) ?? known.name,
      };
    }
  }

  if (!known.email && matchRow.opponent) {
    const { data: sibling } = await admin
      .from('captain_matches')
      .select('opposing_captain_email, opposing_captain_name')
      .eq('team_id', matchRow.team_id)
      .eq('opponent', matchRow.opponent as string)
      .not('opposing_captain_email', 'is', null)
      .limit(1)
      .maybeSingle();
    if (sibling?.opposing_captain_email) {
      known = {
        email: sibling.opposing_captain_email as string,
        name: (sibling.opposing_captain_name as string | null) ?? known.name,
      };
    }
  }

  const to = (body.to ?? known.email ?? '').trim();
  const name = (body.name ?? known.name ?? '').trim();
  const hostNotes = body.host_notes ?? (team.host_notes as string | null) ?? '';

  const m: MatchInfo = {
    id: matchRow.id as string,
    matchAt: matchRow.match_at as string,
    isHome: matchRow.is_home as boolean,
    opponent: matchRow.opponent as string | null,
    location: matchRow.location as string | null,
    arrivalNote: matchRow.arrival_note as string | null,
    opposingCaptainName: name || null,
    opposingCaptainPhone: matchRow.opposing_captain_phone as string | null,
  };

  const multiLine = leagueSpec(team.league_type as string).multiLine;

  const lineCount =
    ((matchRow.doubles_courts as number) || 0) + ((matchRow.singles_courts as number) || 0);

  /**
   * The default body, fully rendered for THIS match. The captain edits real
   * prose rather than filling slots around a fixed skeleton — match details
   * change enough week to week that a rigid template is wrong at the worst
   * possible moment.
   */
  /*
   * Away, the questions run the other way — we are confirming we'll be there,
   * saying how many lines we're bringing so they can plan courts, and asking
   * whether there is anywhere to warm up. The panel used to vanish entirely on
   * an away match, so four away fixtures meant four unconfirmed matches.
   */
  const defaultBody = !m.isHome
    ? visitingBodyText(
        m,
        {
          opposingCaptainName: name || null,
          teamName: team.name as string,
          venue: (matchRow.location as string | null) ?? null,
          lineCount,
          singlesCourts: (matchRow.singles_courts as number) || null,
          doublesCourts: (matchRow.doubles_courts as number) || null,
          notes: hostNotes || null,
          fromName,
          fromTitle,
        },
        CLUB_TZ,
      )
    : hostingBodyText(
    m,
    {
      opposingCaptainName: name || null,
      clubName,
      address,
      hostNotes,
      lineCount,
      linesNote: body.lines_note,
      /*
       * Only leagues where players share the lines get the format sentence.
       * For an adult team match "how many are you bringing" is not a question —
       * eight named people turn up for eight lines.
       */
      courtFormat: (team.court_format as number | null) ?? null,
      singlesCourts: multiLine ? (matchRow.singles_courts as number) : null,
      doublesCourts: multiLine ? (matchRow.doubles_courts as number) : null,
      minPlayers: multiLine?.minToPlay ?? null,
      fromName,
      fromTitle,
    },
    CLUB_TZ,
  );
  const bodyText = body.body !== undefined ? body.body : defaultBody;
  const subject =
    body.subject ??
    (m.isHome
      ? defaultHostingSubject(team.name as string, m, clubName, CLUB_TZ)
      : defaultVisitingSubject(team.name as string, m, CLUB_TZ));

  const email = opponentHostingEmail(
    team.name as string,
    m,
    { to: to || 'captain@example.com', clubName, bodyText, subject },
    CLUB_TZ,
  );

  if (body.preview !== false) {
    return NextResponse.json({
      preview: true,
      to,
      subject: email.subject,
      html: email.html,
      // Surfaced so the UI can warn instead of the send failing at the last step.
      missing_recipient: !to,
      already_sent_at: matchRow.host_email_sent_at ?? null,
      defaults: {
        host_notes: hostNotes,
        name,
        club_name: clubName,
        address,
        line_count: lineCount,
        // Prefills the editor. The captain edits it when the opponent has
        // already announced a default, which happens often enough to matter.
        body: bodyText,
        subject,
      },
    });
  }

  if (!to) {
    return NextResponse.json(
      { error: "Add the opposing captain's email address first." },
      { status: 400 },
    );
  }

  try {
    const [result] = await sendBilledEmails(ctx.userId, [
      { to: email.to, subject: email.subject, html: email.html },
    ]);
    if (!result || result.sent !== true) {
      const reason =
        result && result.sent === false
          ? result.reason === 'unsubscribed'
            ? 'That address has unsubscribed from ClubMode email.'
            : result.error || 'Send failed.'
          : 'Send failed.';
      return NextResponse.json({ error: reason }, { status: 502 });
    }
  } catch (e) {
    if (e instanceof CreditLimitError) return creditLimitResponse(e);
    throw e;
  }

  await admin
    .from('captain_matches')
    .update({
      opposing_captain_email: to,
      opposing_captain_name: name || null,
      host_email_sent_at: new Date().toISOString(),
    })
    .eq('id', matchId);

  /**
   * A captain's contact details arrive ONCE per opponent per season -- off the
   * league contact sheet or the TopDog schedule -- not once per match. So
   * entering them here fills in every other fixture against the same opponent
   * for this team, home or away.
   *
   * Only fills blanks: a match that already has a contact stored keeps it,
   * because a club can change captain mid-season and the newer entry should
   * not be clobbered by an older one.
   */
  if (matchRow.opponent) {
    await admin
      .from('captain_matches')
      .update({ opposing_captain_email: to, opposing_captain_name: name || null })
      .eq('team_id', matchRow.team_id)
      .eq('opponent', matchRow.opponent as string)
      .neq('id', matchId)
      .is('opposing_captain_email', null);
  }

  if (body.save_notes && body.host_notes !== undefined) {
    await admin.from('captain_teams').update({ host_notes: body.host_notes }).eq('id', team.id);
  }

  return NextResponse.json({ ok: true, sent_to: to });
}

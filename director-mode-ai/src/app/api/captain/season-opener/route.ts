/**
 * GET|POST /api/captain/season-opener — one introduction to every opposing
 * captain in the division.
 *
 *   GET  ?team_id=…                 -> who it would go to, and the draft body
 *   POST { team_id, preview: true } -> the exact emails, sending nothing
 *   POST { team_id, send: true }    -> sends
 *
 * ⚠️ This is the only CaptainMode email that goes to people at OTHER CLUBS in
 * bulk. There is no undo and no "ignore that, wrong draft" that isn't
 * embarrassing in front of twenty colleagues, so:
 *   - `send` must be passed explicitly; nothing sends by default
 *   - the preview renders through the SAME builder as the send, so the two
 *     cannot drift
 *   - a recipient who has already had it is skipped, and re-sending to them
 *     needs `resend: true`
 */
import { NextResponse } from 'next/server';
import { requireTeam, isError } from '@/lib/captain/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { seasonOpenerBodyText, seasonOpenerEmail, seasonWhenText } from '@/lib/captain/emails';
import { CLUB_TZ } from '@/lib/captain/clubTime';
import { leagueSpec, defaultCourts } from '@/lib/captain/leagues';
import { sendBilledEmails, creditLimitResponse } from '@/lib/email';
import { CreditLimitError } from '@/lib/billing';

export const dynamic = 'force-dynamic';

type Recipient = {
  opponentId: string;
  opponent: string;
  name: string;
  email: string;
  alreadySentAt: string | null;
  nextMeeting: string | null;
};

async function build(teamId: string) {
  const db = getSupabaseAdmin();

  const { data: teamRow } = await db
    .from('captain_teams')
    .select(
      'id, name, level, league_type, club_id, host_notes, court_format, default_singles_courts, default_doubles_courts',
    )
    .eq('id', teamId)
    .maybeSingle();
  if (!teamRow) return null;
  const team = teamRow as Record<string, unknown>;

  const [{ data: matches }, { data: opponents }] = await Promise.all([
    db
      .from('captain_matches')
      .select('match_at, opponent, is_home, season_opener_sent_at')
      .eq('team_id', teamId)
      .neq('status', 'cancelled')
      .order('match_at'),
    db
      .from('captain_opponents')
      .select('id, opponent, season_opener_sent_at')
      .eq('team_id', teamId)
      .order('opponent'),
  ]);

  const fixtures = ((matches as Record<string, unknown>[]) || []).filter(
    (m) => new Date(m.match_at as string) >= new Date(Date.now() - 86_400_000),
  );

  const opponentRows = (opponents as { id: string; opponent: string; season_opener_sent_at: string | null }[]) || [];
  const { data: people } = opponentRows.length
    ? await db
        .from('captain_opponent_captains')
        .select('opponent_id, name, email, sort_order')
        .in(
          'opponent_id',
          opponentRows.map((o) => o.id),
        )
        .not('email', 'is', null)
        .order('sort_order')
    : { data: [] };

  const fmtWhen = (d: string) =>
    new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: CLUB_TZ,
    }).format(new Date(d));

  const recipients: Recipient[] = [];
  for (const o of opponentRows) {
    const next = fixtures.find((m) => m.opponent === o.opponent);
    for (const p of (people as { opponent_id: string; name: string; email: string }[]) || []) {
      if (p.opponent_id !== o.id) continue;
      recipients.push({
        opponentId: o.id,
        opponent: o.opponent,
        name: p.name,
        email: p.email,
        alreadySentAt: o.season_opener_sent_at,
        nextMeeting: next
          ? `${fmtWhen(next.match_at as string)}${next.is_home ? ' here' : ' at yours'}`
          : null,
      });
    }
  }

  /*
   * Club name + address, so the captain isn't retyping their own venue.
   *
   * ⚠️ NO PLACEHOLDER. This used to default to the literal string "our club",
   * which would have gone to twenty captains at rival clubs as the name of the
   * venue. An unknown venue is left out of the email entirely — a missing line
   * reads as brevity, a placeholder reads as a mailmerge nobody proofread.
   *
   * Falls back to the venue named on a home fixture before giving up, because
   * a team can be perfectly well set up without a ClubMode club record.
   */
  let clubName: string | null = null;
  let address: string | null = null;
  if (team.club_id) {
    const { data: club } = await db
      .from('cc_clubs')
      .select('name, address, city, state, zip')
      .eq('id', team.club_id as string)
      .maybeSingle();
    if (club) {
      clubName = (club.name as string) || null;
      const parts = [club.address, [club.city, club.state].filter(Boolean).join(', '), club.zip]
        .filter(Boolean)
        .join(', ');
      address = parts || null;
    }
  }

  if (!clubName) {
    const home = fixtures.find((m) => m.is_home && m.location);
    clubName = (home?.location as string | undefined) ?? null;
  }

  const spec = leagueSpec(team.league_type as string);
  const courts = defaultCourts(team as never);

  return {
    db,
    team,
    clubName,
    address,
    spec,
    courts,
    recipients,
    whenText: seasonWhenText(fixtures.map((m) => m.match_at as string)),
  };
}

export async function GET(req: Request) {
  const teamId = new URL(req.url).searchParams.get('team_id') || '';
  const ctx = await requireTeam(teamId);
  if (isError(ctx)) return ctx.error;

  const built = await build(teamId);
  if (!built) return NextResponse.json({ error: 'Team not found.' }, { status: 404 });

  const { data: me } = await built.db
    .from('profiles')
    .select('full_name, email')
    .eq('id', ctx.userId)
    .maybeSingle();

  return NextResponse.json({
    recipients: built.recipients,
    whenText: built.whenText,
    courtFormat: built.team.court_format ?? null,
    clubName: built.clubName,
    address: built.address,
    fromName: me?.full_name ?? null,
    defaultSubject: `${built.team.name} — ${built.team.level ?? ''} season`.replace(/\s+—\s+$/, ''),
    defaultBody: seasonOpenerBodyText({
      teamName: built.team.name as string,
      division: built.team.level as string | null,
      clubName: built.clubName,
      address: built.address,
      whenText: built.whenText,
      courtFormat: built.team.court_format as number | null,
      singlesCourts: built.spec.multiLine ? built.courts.singles : null,
      doublesCourts: built.spec.multiLine ? built.courts.doubles : null,
      minPlayers: built.spec.multiLine?.minToPlay ?? null,
      hostNotes: built.team.host_notes as string | null,
      fromName: me?.full_name ?? null,
    }),
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    team_id?: string;
    subject?: string;
    body?: string;
    /** Opponent ids to include. Omitted = everyone not already sent to. */
    opponent_ids?: string[];
    preview?: boolean;
    send?: boolean;
    resend?: boolean;
  };

  const ctx = await requireTeam(body.team_id || '');
  if (isError(ctx)) return ctx.error;

  const built = await build(body.team_id as string);
  if (!built) return NextResponse.json({ error: 'Team not found.' }, { status: 404 });

  const { data: me } = await built.db
    .from('profiles')
    .select('full_name, email')
    .eq('id', ctx.userId)
    .maybeSingle();

  let targets = built.recipients;
  if (body.opponent_ids?.length) {
    const wanted = new Set(body.opponent_ids);
    targets = targets.filter((r) => wanted.has(r.opponentId));
  }
  if (!body.resend) targets = targets.filter((r) => !r.alreadySentAt);

  if (!targets.length) {
    return NextResponse.json(
      {
        error: body.resend
          ? 'No opposing captains with an email address yet — paste the league contact list first.'
          : 'Everyone on the list has already had it. Tick “send again” to repeat it.',
      },
      { status: 400 },
    );
  }

  const subject =
    (body.subject || '').trim() ||
    `${built.team.name} — ${built.team.level ?? ''} season`.replace(/\s+—\s+$/, '');

  /** The same builder for preview and send, so the two cannot disagree. */
  const emailFor = (r: Recipient) => {
    const text =
      body.body?.trim() ||
      seasonOpenerBodyText({
        opposingCaptainName: r.name,
        teamName: built.team.name as string,
        division: built.team.level as string | null,
        clubName: built.clubName,
        address: built.address,
        whenText: built.whenText,
        courtFormat: built.team.court_format as number | null,
        singlesCourts: built.spec.multiLine ? built.courts.singles : null,
        doublesCourts: built.spec.multiLine ? built.courts.doubles : null,
        minPlayers: built.spec.multiLine?.minToPlay ?? null,
        nextMeeting: r.nextMeeting,
        hostNotes: built.team.host_notes as string | null,
        fromName: me?.full_name ?? null,
      });
    // A captain-edited body is one piece of prose for everyone, so the greeting
    // is theirs to write; the generated one is personalised per recipient.
    return seasonOpenerEmail({
      to: r.email,
      subject,
      bodyText: text,
      ref: `opener-${built.team.id}`,
    });
  };

  if (!body.send) {
    return NextResponse.json({
      preview: true,
      subject,
      count: targets.length,
      recipients: targets,
      // Three worked examples, not twenty. The captain is checking the wording
      // and that the merge fields resolved, and a wall of near-identical emails
      // is how a bad one gets scrolled past.
      emails: targets.slice(0, 3).map((r) => ({ opponent: r.opponent, ...emailFor(r) })),
    });
  }

  try {
    await sendBilledEmails(
      ctx.userId,
      targets.map((r) => emailFor(r)),
    );
  } catch (e) {
    if (e instanceof CreditLimitError) return creditLimitResponse(e);
    throw e;
  }

  const now = new Date().toISOString();
  const ids = [...new Set(targets.map((r) => r.opponentId))];
  await built.db
    .from('captain_opponents')
    .update({ season_opener_sent_at: now })
    .in('id', ids);

  return NextResponse.json({ ok: true, sent: targets.length });
}

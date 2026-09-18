/**
 * Shared payload construction for every scheduled CaptainMode email.
 *
 * The cron, the timeline preview and the "send now" button all call
 * `payloadsFor` — so what a captain sees in the preview pane is byte-for-byte
 * what the cron will put in players' inboxes, including their own subject and
 * intro overrides.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  availabilityEmail,
  nudgeEmail,
  lineupEmail,
  matchReminderEmail,
  type EmailCustom,
  type LineupRow,
  type MatchInfo,
  type Recipient,
} from './emails';
import {
  buildTimeline,
  resolveSettings,
  EMAIL_KINDS,
  type EmailKind,
  type MatchRow,
  type OverrideRow,
  type ResolvedSetting,
  type SettingRow,
  type TimelineCounts,
  type TimelineEvent,
} from './timeline';
import {
  ccPayloads,
  recipientRows,
  withMatchCoach,
  withSecondContact,
  type MatchCoach,
  type TeamCc,
} from './teamContacts';
import {
  DEFAULT_JTT_COURT_FORMAT,
  exhibitionRows,
  leagueSpec,
  roundsByCourt,
  singlesFirstInLine,
} from './leagues';
import { singlesCounts } from './server';
import { formatPhone } from './phone';
import { resolveTeamTimeZone } from './clubTime';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export const MATCH_COLUMNS =
  'id, team_id, match_at, status, is_home, opponent, location, arrival_note, ' +
  'opposing_captain_name, opposing_captain_phone, availability_poll_sent_at, ' +
  'nudge_sent_at, lineup_email_sent_at, reminder_sent_at, court_format, singles_courts, doubles_courts, ' +
  'match_coach_id';

type PlayerRow = {
  id: string;
  name: string;
  email: string | null;
  player_token: string;
  contact2_name?: string | null;
  contact2_email?: string | null;
};
type CourtRow = {
  match_id: string;
  court_number: number;
  court_type: 'singles' | 'doubles';
  player1_id: string | null;
  player2_id: string | null;
};

export type TeamEmailContext = {
  team: { id: string; name: string; captain_user_id: string };
  matches: MatchRow[];
  /** Full match rows — the email body needs location, arrival note, opposing captain. */
  matchInfo: Map<string, MatchInfo>;
  roster: PlayerRow[];
  answered: Map<string, Set<string>>;
  courts: Map<string, CourtRow[]>;
  settings: Record<EmailKind, ResolvedSetting>;
  overrides: OverrideRow[];
  counts: TimelineCounts;
  /**
   * JTT only: courts played at once for each match (match → team → 3), which
   * decides the rounds the lineup and reminder emails print. Empty for adults.
   */
  roundFormat: Map<string, number>;
  /** The club's IANA zone — every time in every email is written in it. */
  timeZone: string;
  /** Contacts flagged "on team emails" — they get a copy of every team-wide send. */
  teamCcs: TeamCc[];
  /** The coach named for each match, copied on every email about it. */
  matchCoach: Map<string, MatchCoach>;
};

function infoOf(m: Record<string, unknown>): MatchInfo {
  return {
    id: m.id as string,
    matchAt: m.match_at as string,
    isHome: m.is_home as boolean,
    opponent: (m.opponent as string) || null,
    location: (m.location as string) || null,
    arrivalNote: (m.arrival_note as string) || null,
    opposingCaptainName: (m.opposing_captain_name as string) || null,
    opposingCaptainPhone: (m.opposing_captain_phone as string) || null,
    // So a lineup short of the match's lines says which line gets defaulted.
    singlesCourts: (m.singles_courts as number | null) ?? null,
    doublesCourts: (m.doubles_courts as number | null) ?? null,
  };
}

const recipientOf = (p: PlayerRow): Recipient => ({
  playerId: p.id,
  name: p.name,
  email: p.email as string,
  token: p.player_token,
});

/**
 * Everything the timeline and the cron need for one team, in one round of
 * queries. `matchIds` narrows the availability/lineup lookups when the caller
 * only cares about a few matches.
 */
export async function loadTeamEmailContext(
  db: SupabaseClient,
  team: { id: string; name: string; captain_user_id: string },
  matches: Record<string, unknown>[],
): Promise<TeamEmailContext> {
  const matchIds = matches.map((m) => m.id as string);

  const [
    { data: players },
    { data: avail },
    { data: courtRows },
    { data: settingRows },
    { data: ovRows },
    { data: teamShape },
    timeZone,
    { data: contactRows },
  ] = await Promise.all([
      db
        .from('captain_players')
        .select('id, name, email, player_token, contact2_name, contact2_email, is_sub')
        .eq('team_id', team.id)
        .eq('active', true),
      matchIds.length
        ? db.from('captain_availability').select('match_id, player_id').in('match_id', matchIds)
        : Promise.resolve({ data: [] as { match_id: string; player_id: string }[] }),
      matchIds.length
        ? db
            .from('captain_lineups')
            .select('match_id, court_number, court_type, player1_id, player2_id')
            .in('match_id', matchIds)
            .order('court_number')
        : Promise.resolve({ data: [] as CourtRow[] }),
      db
        .from('captain_email_settings')
        .select('kind, enabled, lead_days, subject_override, intro_override')
        .eq('team_id', team.id),
      matchIds.length
        ? db
            .from('captain_email_overrides')
            .select('match_id, kind, skip, send_at, subject_override, intro_override')
            .in('match_id', matchIds)
        : Promise.resolve({ data: [] as OverrideRow[] }),
      // League + default format, for the rounds a JTT email prints. Read here
      // rather than widened on every caller's team row, so no caller can forget.
      db.from('captain_teams').select('league_type, court_format').eq('id', team.id).maybeSingle(),
      // Admin, not `db`: the preview (RLS-scoped) and the cron (admin) must
      // resolve the same zone or the preview stops being the send.
      resolveTeamTimeZone(getSupabaseAdmin(), team.id),
      db
        .from('captain_team_contacts')
        .select('id, name, email, phone, role, on_emails')
        .eq('team_id', team.id)
        .order('sort_order')
        .order('name'),
    ]);

  type ContactRow = MatchCoach & { role: string; on_emails: boolean };
  const contacts = (contactRows as ContactRow[] | null) ?? [];
  const teamCcs: TeamCc[] = [];
  const seenCc = new Set<string>();
  for (const c of contacts) {
    const email = (c.email || '').trim();
    if (!c.on_emails || !email || seenCc.has(email.toLowerCase())) continue;
    seenCc.add(email.toLowerCase());
    teamCcs.push({ name: c.name, email, role: c.role });
  }
  const matchCoach = new Map<string, MatchCoach>();
  for (const m of matches) {
    const c = contacts.find((x) => x.id === (m.match_coach_id as string | null));
    if (c) matchCoach.set(m.id as string, c);
  }

  const shape = teamShape as { league_type: string | null; court_format: number | null } | null;
  const roundFormat = new Map<string, number>();
  if (leagueSpec(shape?.league_type).multiLine) {
    for (const m of matches) {
      roundFormat.set(
        m.id as string,
        (m.court_format as number | null) ?? shape?.court_format ?? DEFAULT_JTT_COURT_FORMAT,
      );
    }
  }

  const roster = ((players as PlayerRow[]) || []).filter((p) => !!p.email);

  const answered = new Map<string, Set<string>>();
  for (const a of (avail as { match_id: string; player_id: string }[]) || []) {
    if (!answered.has(a.match_id)) answered.set(a.match_id, new Set());
    answered.get(a.match_id)!.add(a.player_id);
  }

  const courts = new Map<string, CourtRow[]>();
  for (const c of (courtRows as CourtRow[]) || []) {
    if (!courts.has(c.match_id)) courts.set(c.match_id, []);
    courts.get(c.match_id)!.push(c);
  }

  const matchInfo = new Map<string, MatchInfo>();
  const sharedLines = !!leagueSpec(shape?.league_type).multiLine;
  // JTT: singles on earlier matches, per match with a saved sheet — for the
  // lineup email's "first in line for singles next match" note.
  const regulars = ((players as (PlayerRow & { is_sub?: boolean })[]) || [])
    .filter((p) => !p.is_sub)
    .map((p) => ({ id: p.id, name: p.name }));
  const singlesBefore = new Map<string, Record<string, number>>();
  if (sharedLines) {
    await Promise.all(
      matches
        .filter((m) => (courts.get(m.id as string) || []).length)
        .map(async (m) => singlesBefore.set(m.id as string, await singlesCounts(db, team.id, m.id as string))),
    );
  }
  for (const m of matches) {
    const info = infoOf(m);
    // JTT shares its lines across rounds: an unfilled line isn't a default.
    if (sharedLines) {
      info.singlesCourts = null;
      info.doublesCourts = null;
      const before = singlesBefore.get(m.id as string);
      if (before) {
        info.singlesNextUp = singlesFirstInLine(
          regulars,
          before,
          (courts.get(m.id as string) || []).map((c) => ({ courtType: c.court_type, player1Id: c.player1_id })),
        );
      }
    }
    const coach = contacts.find((x) => x.id === (m.match_coach_id as string | null));
    if (coach) {
      info.coachName = coach.name;
      info.coachPhone = coach.phone ? formatPhone(coach.phone) : null;
    }
    matchInfo.set(m.id as string, info);
  }

  const rosterIds = new Set(roster.map((p) => p.id));
  const counts: TimelineCounts = {
    roster: roster.length,
    unanswered: new Map(
      matchIds.map((id) => {
        const done = answered.get(id) || new Set<string>();
        return [id, roster.filter((p) => !done.has(p.id)).length];
      }),
    ),
    lineupCourts: new Map(matchIds.map((id) => [id, (courts.get(id) || []).length])),
    playing: new Map(
      matchIds.map((id) => {
        const named = new Set(
          (courts.get(id) || []).flatMap((c) => [c.player1_id, c.player2_id]).filter(Boolean) as string[],
        );
        return [id, [...named].filter((pid) => rosterIds.has(pid)).length];
      }),
    ),
  };

  return {
    team,
    matches: matches as unknown as MatchRow[],
    matchInfo,
    roster,
    answered,
    courts,
    settings: resolveSettings((settingRows as SettingRow[]) || []),
    overrides: (ovRows as OverrideRow[]) || [],
    counts,
    roundFormat,
    timeZone,
    teamCcs,
    matchCoach,
  };
}

/**
 * Who gets a copy of a team-wide send for this match. The poll, lineup and
 * reminder go to everyone on team emails plus the match coach; a nudge (the
 * chase to non-responders) only to the match coach, who is the one needing
 * the headcount. A targeted send copies nobody — it is about one player.
 */
function ccsFor(
  kind: EmailKind,
  ctx: TeamEmailContext,
  matchId: string,
  playerAddresses: string[],
): TeamCc[] {
  const base = kind === 'nudge' ? [] : ctx.teamCcs;
  const taken = new Set(playerAddresses.map((e) => e.trim().toLowerCase()));
  const team = base.filter((c) => !taken.has(c.email.toLowerCase()));
  return withMatchCoach(team, ctx.matchCoach.get(matchId) ?? null, playerAddresses);
}

/** Team default merged with this match's exception — the override wins. */
export function customFor(setting: ResolvedSetting, ov: OverrideRow | null): EmailCustom {
  return {
    subject: ov?.subject_override ?? setting.subjectOverride ?? null,
    intro: ov?.intro_override ?? setting.introOverride ?? null,
  };
}

/**
 * The exact emails one scheduled send would produce, in send order. Empty when
 * there is nobody to send to or the lineup it depends on does not exist yet.
 */
export function payloadsFor(
  kind: EmailKind,
  ctx: TeamEmailContext,
  matchId: string,
  onlyPlayerIds?: string[] | null,
): { to: string; subject: string; html: string }[] {
  const players = playerPayloadsFor(kind, ctx, matchId, onlyPlayerIds);
  if (onlyPlayerIds?.length || !players.length) return players;
  const ccs = ccsFor(kind, ctx, matchId, players.map((p) => p.to));
  return [...players, ...ccPayloads(players[0], ccs, ctx.team.name)];
}

function playerPayloadsFor(
  kind: EmailKind,
  ctx: TeamEmailContext,
  matchId: string,
  /**
   * Narrow the send to specific players. The email BODY is unchanged — a
   * targeted lineup still shows every court — only the recipient list shrinks.
   * This is the "one player came in late, tell just her" path: re-mailing 23
   * people about a swap they aren't in trains a team to stop opening these.
   */
  onlyPlayerIds?: string[] | null,
): { to: string; subject: string; html: string }[] {
  const info = ctx.matchInfo.get(matchId);
  if (!info) return [];

  const ov = ctx.overrides.find((o) => o.match_id === matchId && o.kind === kind) || null;
  const custom = customFor(ctx.settings[kind], ov);
  const courts = ctx.courts.get(matchId) || [];
  const teamName = ctx.team.name;

  // An EMPTY array means "these players" with nobody in it — not "everyone".
  // Treating it as no filter is how a modal that said 1 recipient could mail 24.
  if (onlyPlayerIds && onlyPlayerIds.length === 0) return [];
  const only = onlyPlayerIds?.length ? new Set(onlyPlayerIds) : null;
  const audience = only ? ctx.roster.filter((p) => only.has(p.id)) : ctx.roster;

  if (kind === 'poll') {
    return audience.flatMap((p) =>
      withSecondContact(availabilityEmail(teamName, info, recipientOf(p), ctx.timeZone, custom), p.contact2_email),
    );
  }

  if (kind === 'nudge') {
    const done = ctx.answered.get(matchId) || new Set<string>();
    return audience
      .filter((p) => !done.has(p.id))
      .flatMap((p) =>
        withSecondContact(nudgeEmail(teamName, info, recipientOf(p), ctx.timeZone, custom), p.contact2_email),
      );
  }

  if (!courts.length) return []; // lineup + reminder both depend on a built lineup

  const nameOf = (id: string | null) => (id ? (ctx.roster.find((p) => p.id === id)?.name ?? '—') : '—');

  // JTT: which round each line is played in, from the same plan the match page uses.
  const fmt = ctx.roundFormat.get(matchId);
  const rounds = fmt
    ? roundsByCourt(
        courts.map((c) => ({ courtNumber: c.court_number, courtType: c.court_type })),
        fmt,
      )
    : null;

  // JTT at home: whoever is off in a round plays the exhibition court.
  const exhibition =
    fmt && info.isHome
      ? exhibitionRows(
          courts.map((c) => ({
            courtNumber: c.court_number,
            courtType: c.court_type,
            player1Id: c.player1_id,
            player2Id: c.player2_id,
          })),
          fmt,
          (id) => nameOf(id),
        )
      : [];

  if (kind === 'lineup') {
    const rows: LineupRow[] = [
      ...courts.map((c) => ({
        courtNumber: c.court_number,
        courtType: c.court_type,
        names: [nameOf(c.player1_id)].concat(c.court_type === 'doubles' ? [nameOf(c.player2_id)] : []),
        round: rounds?.get(c.court_number) ?? null,
      })),
      ...exhibition,
    ];
    const playing = new Set(
      courts.flatMap((c) => [c.player1_id, c.player2_id]).filter(Boolean) as string[],
    );
    return audience.flatMap((p) =>
      withSecondContact(
        lineupEmail(teamName, info, rows, recipientOf(p), playing.has(p.id), ctx.timeZone, custom),
        p.contact2_email,
      ),
    );
  }

  // reminder
  // Every line the player is on — a JTT child can have three — with its round.
  const courtFor = (pid: string) => {
    const mine = courts
      .filter((x) => x.player1_id === pid || x.player2_id === pid)
      .sort(
        (a, b) =>
          (rounds?.get(a.court_number) ?? 0) - (rounds?.get(b.court_number) ?? 0) ||
          a.court_number - b.court_number,
      );
    if (!mine.length) return null;
    const lines = mine.map((c) => {
      const r = rounds?.get(c.court_number);
      return {
        round: r ?? 0,
        text: `${c.court_type === 'singles' ? 'Singles' : 'Doubles'} ${c.court_number}${r ? ` (round ${r})` : ''}`,
      };
    });
    const me = nameOf(pid);
    for (const x of exhibition) {
      if (x.names.includes(me)) lines.push({ round: x.round, text: `Exhibition court (round ${x.round})` });
    }
    return lines
      .sort((a, b) => a.round - b.round)
      .map((l) => l.text)
      .join(', ');
  };
  return audience
    .filter((p) => !!courtFor(p.id))
    .flatMap((p) =>
      withSecondContact(
        matchReminderEmail(teamName, info, recipientOf(p), courtFor(p.id), ctx.timeZone, custom),
        p.contact2_email,
      ),
    );
}

/**
 * Who a given send would actually reach, for the preview's recipient list.
 * Mirrors payloadsFor exactly, including the targeted-send filter — the two
 * lists are shown side by side in the preview and must never disagree.
 */
export function recipientsFor(
  kind: EmailKind,
  ctx: TeamEmailContext,
  matchId: string,
  onlyPlayerIds?: string[] | null,
): { name: string; email: string | null }[] {
  const players = playerRecipientsFor(kind, ctx, matchId, onlyPlayerIds);
  // Same rule as payloadsFor: copies only when the players' send is non-empty.
  if (onlyPlayerIds?.length || !playerPayloadsFor(kind, ctx, matchId, onlyPlayerIds).length) return players;
  const addresses = players.map((p) => p.email).filter(Boolean) as string[];
  return [
    ...players,
    ...ccsFor(kind, ctx, matchId, addresses).map((c) => ({
      name: `${c.name} · ${c.role === 'match coach' ? 'coach at this match' : 'copy'}`,
      email: c.email,
    })),
  ];
}

function playerRecipientsFor(
  kind: EmailKind,
  ctx: TeamEmailContext,
  matchId: string,
  onlyPlayerIds?: string[] | null,
): { name: string; email: string | null }[] {
  const courts = ctx.courts.get(matchId) || [];
  const only = onlyPlayerIds?.length ? new Set(onlyPlayerIds) : null;
  const audience = only ? ctx.roster.filter((p) => only.has(p.id)) : ctx.roster;

  if (kind === 'nudge') {
    const done = ctx.answered.get(matchId) || new Set<string>();
    return audience.filter((p) => !done.has(p.id)).flatMap(recipientRows);
  }
  if (kind === 'reminder') {
    const named = new Set(
      courts.flatMap((c) => [c.player1_id, c.player2_id]).filter(Boolean) as string[],
    );
    return audience.filter((p) => named.has(p.id)).flatMap(recipientRows);
  }
  return audience.flatMap(recipientRows);
}

/** The season timeline, with every subject line rendered from the real builder. */
export function timelineFor(ctx: TeamEmailContext, now: Date): TimelineEvent[] {
  return buildTimeline({
    matches: ctx.matches,
    settings: ctx.settings,
    overrides: ctx.overrides,
    counts: ctx.counts,
    now,
    subjectFor: (kind, m) => {
      const built = payloadsFor(kind, ctx, m.id);
      if (built.length) return built[0].subject;
      // Nothing to send right now (no lineup, everyone answered) — still show
      // the captain the subject line this email would carry.
      return sampleSubject(kind, ctx, m.id);
    },
  });
}

/**
 * Subject line for a send with no live audience. Uses a placeholder recipient so
 * a blocked row still shows the captain what the email is called.
 */
function sampleSubject(kind: EmailKind, ctx: TeamEmailContext, matchId: string): string {
  const info = ctx.matchInfo.get(matchId);
  if (!info) return '';
  const ov = ctx.overrides.find((o) => o.match_id === matchId && o.kind === kind) || null;
  const custom = customFor(ctx.settings[kind], ov);
  const r: Recipient = {
    playerId: 'sample',
    name: ctx.roster[0]?.name || 'your player',
    email: 'sample@example.com',
    token: 'sample',
  };
  const t = ctx.team.name;
  const tz = ctx.timeZone;
  if (kind === 'poll') return availabilityEmail(t, info, r, tz, custom).subject;
  if (kind === 'nudge') return nudgeEmail(t, info, r, tz, custom).subject;
  if (kind === 'lineup') return lineupEmail(t, info, [], r, false, tz, custom).subject;
  return matchReminderEmail(t, info, r, null, tz, custom).subject;
}

export { EMAIL_KINDS };

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

export const MATCH_COLUMNS =
  'id, team_id, match_at, status, is_home, opponent, location, arrival_note, ' +
  'opposing_captain_name, opposing_captain_phone, availability_poll_sent_at, ' +
  'nudge_sent_at, lineup_email_sent_at, reminder_sent_at';

type PlayerRow = { id: string; name: string; email: string | null; player_token: string };
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

  const [{ data: players }, { data: avail }, { data: courtRows }, { data: settingRows }, { data: ovRows }] =
    await Promise.all([
      db
        .from('captain_players')
        .select('id, name, email, player_token')
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
    ]);

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
  for (const m of matches) matchInfo.set(m.id as string, infoOf(m));

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
  };
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
): { to: string; subject: string; html: string }[] {
  const info = ctx.matchInfo.get(matchId);
  if (!info) return [];

  const ov = ctx.overrides.find((o) => o.match_id === matchId && o.kind === kind) || null;
  const custom = customFor(ctx.settings[kind], ov);
  const courts = ctx.courts.get(matchId) || [];
  const teamName = ctx.team.name;

  if (kind === 'poll') {
    return ctx.roster.map((p) => availabilityEmail(teamName, info, recipientOf(p), undefined, custom));
  }

  if (kind === 'nudge') {
    const done = ctx.answered.get(matchId) || new Set<string>();
    return ctx.roster
      .filter((p) => !done.has(p.id))
      .map((p) => nudgeEmail(teamName, info, recipientOf(p), undefined, custom));
  }

  if (!courts.length) return []; // lineup + reminder both depend on a built lineup

  const nameOf = (id: string | null) => (id ? (ctx.roster.find((p) => p.id === id)?.name ?? '—') : '—');

  if (kind === 'lineup') {
    const rows: LineupRow[] = courts.map((c) => ({
      courtNumber: c.court_number,
      courtType: c.court_type,
      names: [nameOf(c.player1_id)].concat(c.court_type === 'doubles' ? [nameOf(c.player2_id)] : []),
    }));
    const playing = new Set(
      courts.flatMap((c) => [c.player1_id, c.player2_id]).filter(Boolean) as string[],
    );
    return ctx.roster.map((p) =>
      lineupEmail(teamName, info, rows, recipientOf(p), playing.has(p.id), undefined, custom),
    );
  }

  // reminder
  const courtFor = (pid: string) => {
    const c = courts.find((x) => x.player1_id === pid || x.player2_id === pid);
    return c ? `${c.court_type === 'singles' ? 'Singles' : 'Doubles'} ${c.court_number}` : null;
  };
  return ctx.roster
    .filter((p) => !!courtFor(p.id))
    .map((p) => matchReminderEmail(teamName, info, recipientOf(p), courtFor(p.id), undefined, custom));
}

/** Who a given send would actually reach, for the preview's recipient list. */
export function recipientsFor(
  kind: EmailKind,
  ctx: TeamEmailContext,
  matchId: string,
): { name: string; email: string | null }[] {
  const courts = ctx.courts.get(matchId) || [];
  if (kind === 'nudge') {
    const done = ctx.answered.get(matchId) || new Set<string>();
    return ctx.roster.filter((p) => !done.has(p.id)).map((p) => ({ name: p.name, email: p.email }));
  }
  if (kind === 'reminder') {
    const named = new Set(
      courts.flatMap((c) => [c.player1_id, c.player2_id]).filter(Boolean) as string[],
    );
    return ctx.roster.filter((p) => named.has(p.id)).map((p) => ({ name: p.name, email: p.email }));
  }
  return ctx.roster.map((p) => ({ name: p.name, email: p.email }));
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
  if (kind === 'poll') return availabilityEmail(t, info, r, undefined, custom).subject;
  if (kind === 'nudge') return nudgeEmail(t, info, r, undefined, custom).subject;
  if (kind === 'lineup') return lineupEmail(t, info, [], r, false, undefined, custom).subject;
  return matchReminderEmail(t, info, r, null, undefined, custom).subject;
}

export { EMAIL_KINDS };

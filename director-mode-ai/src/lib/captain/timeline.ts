/**
 * CaptainMode season email timeline.
 *
 * One source of truth for "what goes out, to whom, and exactly when" — the
 * daily cron and the captain-facing timeline both compute from the functions
 * here. If they were computed separately the dashboard would eventually start
 * lying, which is the one thing a schedule preview must never do.
 *
 * Timing model: a send becomes DUE at `match_at - lead_days` (or an explicit
 * per-match `send_at`), but the cron only ticks once a day, so the real send
 * lands on the first tick at or after that moment. The timeline shows that real
 * tick, not the theoretical due time.
 */

export type EmailKind = 'poll' | 'nudge' | 'lineup' | 'reminder';

export const EMAIL_KINDS: EmailKind[] = ['poll', 'nudge', 'lineup', 'reminder'];

/** Vercel cron: "0 16 * * *" in vercel.json. Keep in sync with it. */
export const CRON_UTC_HOUR = 16;

const DAY = 24 * 60 * 60 * 1000;

export type KindMeta = {
  label: string;
  blurb: string;
  audience: string;
  defaultLeadDays: number;
  defaultEnabled: boolean;
  needsLineup: boolean;
  sentColumn:
    | 'availability_poll_sent_at'
    | 'nudge_sent_at'
    | 'lineup_email_sent_at'
    | 'reminder_sent_at';
};

export const KIND_META: Record<EmailKind, KindMeta> = {
  poll: {
    label: 'Availability poll',
    blurb: 'Can you play? — one tap, no login.',
    audience: 'Everyone on the roster with an email',
    // Off by default: this blast has always been captain-triggered, and a
    // migration must never start sending mail nobody asked for.
    defaultLeadDays: 14,
    defaultEnabled: false,
    needsLineup: false,
    sentColumn: 'availability_poll_sent_at',
  },
  lineup: {
    label: 'Lineup',
    blurb: 'The court assignments, with a confirm button for anyone playing.',
    audience: 'Everyone on the roster with an email',
    defaultLeadDays: 7,
    defaultEnabled: true,
    needsLineup: true,
    sentColumn: 'lineup_email_sent_at',
  },
  nudge: {
    label: 'Availability nudge',
    blurb: 'Chases only the players who never answered the poll.',
    audience: 'Players with no answer yet',
    defaultLeadDays: 2,
    defaultEnabled: true,
    needsLineup: false,
    sentColumn: 'nudge_sent_at',
  },
  reminder: {
    label: 'Day-before reminder',
    blurb: 'See you tomorrow, plus which court they are on.',
    audience: 'Players in the lineup',
    defaultLeadDays: 1,
    defaultEnabled: true,
    needsLineup: true,
    sentColumn: 'reminder_sent_at',
  },
};

export type SettingRow = {
  kind: EmailKind;
  enabled: boolean;
  lead_days: number | string;
  subject_override: string | null;
  intro_override: string | null;
};

export type ResolvedSetting = {
  kind: EmailKind;
  enabled: boolean;
  leadDays: number;
  subjectOverride: string | null;
  introOverride: string | null;
  isDefault: boolean;
};

export type OverrideRow = {
  match_id: string;
  kind: EmailKind;
  skip: boolean;
  send_at: string | null;
  subject_override: string | null;
  intro_override: string | null;
};

export type MatchRow = {
  id: string;
  match_at: string;
  status: string;
  is_home: boolean;
  opponent: string | null;
  availability_poll_sent_at: string | null;
  nudge_sent_at: string | null;
  lineup_email_sent_at: string | null;
  reminder_sent_at: string | null;
};

export type TimelineStatus =
  | 'sent'
  | 'due' // past its send time; goes on the next daily run
  | 'scheduled'
  | 'blocked' // enabled, but something is missing (no lineup, no recipients)
  | 'skipped' // captain turned this one off
  | 'off' // whole kind is disabled for the team
  | 'missed'; // match already played and it never went

export type TimelineEvent = {
  id: string;
  kind: EmailKind;
  matchId: string;
  matchAt: string;
  opponent: string | null;
  isHome: boolean;
  sendAt: string;
  dueAt: string;
  status: TimelineStatus;
  reason: string | null;
  audienceCount: number;
  audienceLabel: string;
  subject: string;
  sentAt: string | null;
  edited: boolean;
};

/** Team settings with the built-in defaults filled in for missing kinds. */
export function resolveSettings(rows: SettingRow[]): Record<EmailKind, ResolvedSetting> {
  const out = {} as Record<EmailKind, ResolvedSetting>;
  for (const kind of EMAIL_KINDS) {
    const row = rows.find((r) => r.kind === kind);
    const meta = KIND_META[kind];
    out[kind] = row
      ? {
          kind,
          enabled: row.enabled,
          leadDays: Number(row.lead_days),
          subjectOverride: row.subject_override,
          introOverride: row.intro_override,
          isDefault: false,
        }
      : {
          kind,
          enabled: meta.defaultEnabled,
          leadDays: meta.defaultLeadDays,
          subjectOverride: null,
          introOverride: null,
          isDefault: true,
        };
  }
  return out;
}

/** The moment a send becomes eligible, before cron granularity. */
export function dueAtFor(
  matchAt: string,
  leadDays: number,
  override?: OverrideRow | null,
): string {
  if (override?.send_at) return new Date(override.send_at).toISOString();
  return new Date(new Date(matchAt).getTime() - leadDays * DAY).toISOString();
}

/** First daily cron tick at or after `due` — the time the email really goes. */
export function nextCronTick(due: string | Date): string {
  const d = due instanceof Date ? due : new Date(due);
  const tick = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), CRON_UTC_HOUR, 0, 0, 0),
  );
  if (tick.getTime() < d.getTime()) tick.setUTCDate(tick.getUTCDate() + 1);
  return tick.toISOString();
}

export function sentAtOf(match: MatchRow, kind: EmailKind): string | null {
  return match[KIND_META[kind].sentColumn] ?? null;
}

export type TimelineCounts = {
  /** Active players with an email — the poll and lineup audience. */
  roster: number;
  /** match_id -> players who have not answered availability yet. */
  unanswered: Map<string, number>;
  /** match_id -> number of courts in the built lineup (0 = not built). */
  lineupCourts: Map<string, number>;
  /** match_id -> players named in the lineup who have an email. */
  playing: Map<string, number>;
};

function audienceFor(kind: EmailKind, m: MatchRow, counts: TimelineCounts): number {
  if (kind === 'nudge') return counts.unanswered.get(m.id) ?? counts.roster;
  if (kind === 'reminder') return counts.playing.get(m.id) ?? 0;
  return counts.roster;
}

/**
 * Why this one will not go out, in the captain's words. Returns null when the
 * send is healthy.
 */
function blockReason(
  kind: EmailKind,
  m: MatchRow,
  counts: TimelineCounts,
  audience: number,
): string | null {
  if (KIND_META[kind].needsLineup && !(counts.lineupCourts.get(m.id) ?? 0)) {
    return 'No lineup built yet — build one and this sends on the next daily run.';
  }
  if (audience === 0) {
    if (kind === 'nudge') return 'Everyone has already answered — nothing to chase.';
    if (kind === 'reminder') return 'Nobody in the lineup has an email address.';
    return 'Nobody on the roster has an email address.';
  }
  return null;
}

export type BuildTimelineArgs = {
  matches: MatchRow[];
  settings: Record<EmailKind, ResolvedSetting>;
  overrides: OverrideRow[];
  counts: TimelineCounts;
  now: Date;
  /** Renders the exact subject line for one event. */
  subjectFor: (
    kind: EmailKind,
    m: MatchRow,
    setting: ResolvedSetting,
    ov: OverrideRow | null,
  ) => string;
};

export function buildTimeline(args: BuildTimelineArgs): TimelineEvent[] {
  const { matches, settings, overrides, counts, now, subjectFor } = args;
  const events: TimelineEvent[] = [];

  for (const m of matches) {
    for (const kind of EMAIL_KINDS) {
      const setting = settings[kind];
      const ov = overrides.find((o) => o.match_id === m.id && o.kind === kind) || null;
      const dueAt = dueAtFor(m.match_at, setting.leadDays, ov);
      const sendAt = nextCronTick(dueAt);
      const sentAt = sentAtOf(m, kind);
      const audience = audienceFor(kind, m, counts);

      let status: TimelineStatus;
      let reason: string | null = null;

      if (sentAt) {
        status = 'sent';
      } else if (ov?.skip) {
        status = 'skipped';
        reason = 'You skipped this one.';
      } else if (m.status !== 'scheduled') {
        status = 'skipped';
        reason = `Match is ${m.status}.`;
      } else if (!setting.enabled) {
        status = 'off';
        reason = `${KIND_META[kind].label} emails are turned off for this team.`;
      } else if (new Date(m.match_at).getTime() <= now.getTime()) {
        status = 'missed';
        reason = 'Match has already been played.';
      } else {
        reason = blockReason(kind, m, counts, audience);
        if (reason) status = 'blocked';
        else if (new Date(sendAt).getTime() <= now.getTime()) status = 'due';
        else status = 'scheduled';
      }

      events.push({
        id: `${m.id}:${kind}`,
        kind,
        matchId: m.id,
        matchAt: m.match_at,
        opponent: m.opponent,
        isHome: m.is_home,
        sendAt,
        dueAt,
        status,
        reason,
        audienceCount: audience,
        audienceLabel: KIND_META[kind].audience,
        subject: subjectFor(kind, m, setting, ov),
        sentAt,
        edited: !!(ov && (ov.skip || ov.send_at || ov.subject_override || ov.intro_override)),
      });
    }
  }

  // Sent items sort by when they actually went; everything else by when it will.
  return events.sort((a, b) => {
    const at = new Date(a.sentAt || a.sendAt).getTime();
    const bt = new Date(b.sentAt || b.sendAt).getTime();
    return at - bt || a.matchId.localeCompare(b.matchId);
  });
}

/**
 * Cron predicate. Kept next to buildTimeline so "will send" and "did send" can
 * never disagree: the dashboard's due/scheduled split is this same test.
 */
export function isDue(
  kind: EmailKind,
  m: MatchRow,
  setting: ResolvedSetting,
  ov: OverrideRow | null,
  now: Date,
): boolean {
  if (!setting.enabled) return false;
  if (ov?.skip) return false;
  if (m.status !== 'scheduled') return false;
  if (sentAtOf(m, kind)) return false;
  if (new Date(m.match_at).getTime() <= now.getTime()) return false;
  return new Date(dueAtFor(m.match_at, setting.leadDays, ov)).getTime() <= now.getTime();
}

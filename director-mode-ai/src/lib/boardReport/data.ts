import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BoardReportData,
  CourtsSection,
  MembershipSection,
  ParticipationSection,
  NpsSection,
  AttentionItem,
} from "./types";
import { computeNps } from "./nps";

// Builds the live Board Report from real data. Every section is defensive:
// a missing legacy table or empty result degrades to an honest empty/"not
// connected yet" state rather than throwing. Court utilization and membership
// are cleanly club/owner-scoped and reliable today; cross-program
// participation is intentionally left to Phase 2 (the master-players spine),
// because the legacy program tables aren't cleanly club-scoped and we won't
// surface numbers we can't stand behind.

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const OPEN_HOUR = 6; // assumed operating window start
const CLOSE_HOUR = 22; // assumed operating window end (16h/day)
const OPEN_HOURS_PER_DAY = CLOSE_HOUR - OPEN_HOUR;

function tzParts(d: Date, tz: string): { wd: number; hour: number } {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(d);
    const wdName = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10) % 24;
    const wdMap: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
    return { wd: wdMap[wdName] ?? 0, hour };
  } catch {
    const wd = (d.getUTCDay() + 6) % 7; // JS Sun=0 → Mon=0 ordering
    return { wd, hour: d.getUTCHours() };
  }
}

function fmtHourWindow(hour: number): string {
  const h12 = (h: number) => {
    const am = h < 12;
    const base = h % 12 === 0 ? 12 : h % 12;
    return `${base}${am ? "am" : "pm"}`;
  };
  return `${h12(hour)}–${h12((hour + 2) % 24)}`;
}

async function buildCourts(
  db: SupabaseClient<any, "public", any>,
  clubId: string,
  tz: string,
  start: Date,
  end: Date
): Promise<CourtsSection> {
  const empty: CourtsSection = {
    available: false,
    utilizationPct: 0,
    peakUtilizationPct: 0,
    peakWindow: "",
    quietWindow: "",
    courtHoursBooked: 0,
    courtHoursAvailable: 0,
    byDay: WEEKDAYS.map((d) => ({ label: d, value: 0 })),
  };

  try {
    const { data: courts } = await db
      .from("courts")
      .select("id")
      .eq("club_id", clubId)
      .neq("status", "hidden");
    const courtCount = courts?.length ?? 0;
    if (courtCount === 0) return empty;

    const { data: rows } = await db
      .from("reservations")
      .select("starts_at, ends_at, type")
      .eq("club_id", clubId)
      .neq("status", "cancelled")
      .lt("starts_at", end.toISOString())
      .gt("ends_at", start.toISOString());

    // booked court-hours, bucketed by weekday and by (weekday, hour)
    const perDayBooked = new Array(7).fill(0);
    const perBucketBooked: Record<string, number> = {}; // `${wd}-${hour}`
    let totalBooked = 0;

    for (const r of rows ?? []) {
      if (r.type === "blackout" || r.type === "maintenance") continue;
      const s = new Date(r.starts_at);
      const e = new Date(r.ends_at);
      let cur = Math.max(s.getTime(), start.getTime());
      const stop = Math.min(e.getTime(), end.getTime());
      while (cur < stop) {
        const next = Math.min(cur + 3_600_000, stop);
        const frac = (next - cur) / 3_600_000;
        const { wd, hour } = tzParts(new Date(cur), tz);
        perDayBooked[wd] += frac;
        const key = `${wd}-${hour}`;
        perBucketBooked[key] = (perBucketBooked[key] ?? 0) + frac;
        totalBooked += frac;
        cur = next;
      }
    }

    // available court-hours: count each weekday occurrence in the window
    const perDayCount = new Array(7).fill(0);
    let dayCursor = new Date(start.getTime());
    while (dayCursor < end) {
      const { wd } = tzParts(dayCursor, tz);
      perDayCount[wd] += 1;
      dayCursor = new Date(dayCursor.getTime() + 24 * 3_600_000);
    }
    const perDayAvail = perDayCount.map((c) => c * courtCount * OPEN_HOURS_PER_DAY);
    const totalAvail = perDayAvail.reduce((a, b) => a + b, 0);

    const pct = (n: number, d: number) => (d > 0 ? Math.min(100, Math.round((n / d) * 100)) : 0);

    const byDay = WEEKDAYS.map((label, i) => ({ label, value: pct(perDayBooked[i], perDayAvail[i]) }));

    // peak/quiet (weekday, hour) buckets within operating hours
    let peakUtil = 0;
    let peakKey = "";
    let quietUtil = 101;
    let quietKey = "";
    for (let wd = 0; wd < 7; wd++) {
      const dayCapacityPerHour = perDayCount[wd] * courtCount;
      if (dayCapacityPerHour === 0) continue;
      for (let h = OPEN_HOUR; h < CLOSE_HOUR; h++) {
        const booked = perBucketBooked[`${wd}-${h}`] ?? 0;
        const util = Math.min(100, Math.round((booked / dayCapacityPerHour) * 100));
        if (util > peakUtil) {
          peakUtil = util;
          peakKey = `${WEEKDAYS[wd]} ${fmtHourWindow(h)}`;
        }
        if (util < quietUtil) {
          quietUtil = util;
          quietKey = `${WEEKDAYS[wd]} ${fmtHourWindow(h)}`;
        }
      }
    }

    return {
      available: (rows?.length ?? 0) > 0,
      utilizationPct: pct(totalBooked, totalAvail),
      peakUtilizationPct: peakUtil,
      peakWindow: peakKey,
      quietWindow: quietKey,
      courtHoursBooked: Math.round(totalBooked),
      courtHoursAvailable: Math.round(totalAvail),
      byDay,
    };
  } catch {
    return empty;
  }
}

async function buildMembership(
  db: SupabaseClient<any, "public", any>,
  directorId: string,
  start: Date,
  end: Date
): Promise<MembershipSection> {
  const empty: MembershipSection = {
    available: false,
    active: 0,
    newThisPeriod: 0,
    lapsedThisPeriod: 0,
    netChange: 0,
    trend: [],
  };
  try {
    const { data: players } = await db
      .from("cc_vault_players")
      .select("membership_status, created_at, updated_at")
      .eq("director_id", directorId);

    if (!players || players.length === 0) return empty;

    const isActive = (s: string | null) => s === null || s === "active";
    const active = players.filter((p) => isActive(p.membership_status)).length;
    const newThisPeriod = players.filter((p) => {
      const c = p.created_at ? new Date(p.created_at) : null;
      return c && c >= start && c < end;
    }).length;
    const lapsedThisPeriod = players.filter((p) => {
      const u = p.updated_at ? new Date(p.updated_at) : null;
      return p.membership_status === "inactive" && u && u >= start && u < end;
    }).length;

    // Trailing 6-month growth curve: cumulative members created on/before each
    // month end (excluding those later marked inactive). Real, no snapshots
    // required.
    const trend = [];
    for (let i = 5; i >= 0; i--) {
      const monthEnd = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1));
      const count = players.filter((p) => {
        const c = p.created_at ? new Date(p.created_at) : null;
        return c && c < monthEnd && isActive(p.membership_status);
      }).length;
      const label = new Date(Date.UTC(monthEnd.getUTCFullYear(), monthEnd.getUTCMonth() - 1, 1))
        .toLocaleString("en-US", { month: "short", timeZone: "UTC" });
      trend.push({ label, value: count });
    }

    return {
      available: true,
      active,
      newThisPeriod,
      lapsedThisPeriod,
      netChange: newThisPeriod - lapsedThisPeriod,
      trend,
    };
  } catch {
    return empty;
  }
}

async function buildParticipation(
  db: SupabaseClient<any, "public", any>,
  directorId: string
): Promise<ParticipationSection> {
  // V1: best-effort real headcount for the cleanly-scopeable program (JTT).
  // De-duplicated cross-program totals require the master-players spine
  // (Phase 2), so totalUniqueParticipants stays null until then.
  const programs: ParticipationSection["programs"] = [];
  try {
    const { data: leagues } = await db
      .from("leagues")
      .select("id")
      .eq("director_id", directorId)
      .eq("format", "team");
    const leagueIds = (leagues ?? []).map((l) => l.id);
    if (leagueIds.length > 0) {
      const { data: divisions } = await db
        .from("league_divisions")
        .select("id")
        .in("league_id", leagueIds);
      const divisionIds = (divisions ?? []).map((d) => d.id);
      if (divisionIds.length > 0) {
        const { data: rosters } = await db
          .from("league_team_rosters")
          .select("id, club_id, status")
          .in("division_id", divisionIds)
          .eq("status", "active");
        if (rosters && rosters.length > 0) {
          const teams = new Set(rosters.map((r) => r.club_id)).size;
          programs.push({
            name: "Junior Team Tennis",
            participants: rosters.length,
            deltaPct: null,
            note: `${teams} team${teams === 1 ? "" : "s"}`,
          });
        }
      }
    }
  } catch {
    /* leave JTT out on any error */
  }

  return {
    available: programs.length > 0,
    totalUniqueParticipants: null,
    programs,
  };
}

async function buildNps(
  db: SupabaseClient<any, "public", any>,
  clubId: string,
  start: Date,
  end: Date,
  surveyUrl: string
): Promise<NpsSection> {
  const empty: NpsSection = {
    available: false,
    score: null,
    responses: 0,
    promoters: 0,
    passives: 0,
    detractors: 0,
    trend: [],
    themes: [],
    surveyUrl,
  };
  try {
    const { data: rows } = await db
      .from("nps_responses")
      .select("score, comment, created_at")
      .eq("club_id", clubId)
      .gte("created_at", new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 6, 1)).toISOString());

    if (!rows || rows.length === 0) return empty;

    const inPeriod = rows.filter((r) => {
      const c = new Date(r.created_at);
      return c >= start && c < end;
    });
    const breakdown = computeNps(inPeriod.map((r) => Number(r.score)));

    // trailing trend
    const trend = [];
    for (let i = 3; i >= 0; i--) {
      const mStart = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i - 1, 1));
      const mEnd = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1));
      const scores = rows
        .filter((r) => {
          const c = new Date(r.created_at);
          return c >= mStart && c < mEnd;
        })
        .map((r) => Number(r.score));
      if (scores.length > 0) {
        const b = computeNps(scores);
        trend.push({
          label: mStart.toLocaleString("en-US", { month: "short", timeZone: "UTC" }),
          value: b.score ?? 0,
        });
      }
    }

    const themes = inPeriod
      .map((r) => (r.comment ?? "").trim())
      .filter((c) => c.length > 0)
      .slice(0, 4);

    return {
      available: breakdown.responses > 0,
      score: breakdown.score,
      responses: breakdown.responses,
      promoters: breakdown.promoters,
      passives: breakdown.passives,
      detractors: breakdown.detractors,
      trend,
      themes,
      surveyUrl,
    };
  } catch {
    return empty;
  }
}

function buildAttention(
  courts: CourtsSection,
  membership: MembershipSection,
  nps: NpsSection
): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (courts.available && courts.peakUtilizationPct >= 90) {
    items.push({
      severity: "opportunity",
      title: "Peak court times are at capacity",
      detail: `${courts.peakWindow} ran at ${courts.peakUtilizationPct}% utilization. Demand may be outstripping supply at prime times — worth a board discussion on access at peak.`,
    });
  }
  if (membership.available && membership.netChange < 0) {
    items.push({
      severity: "watch",
      title: "Membership dipped this period",
      detail: `Net change was ${membership.netChange} (${membership.newThisPeriod} new, ${membership.lapsedThisPeriod} lapsed). Worth understanding why before it compounds.`,
    });
  }
  if (membership.available && membership.netChange > 0) {
    items.push({
      severity: "good",
      title: "Membership is growing",
      detail: `Net +${membership.netChange} members this period (${membership.newThisPeriod} new). The base is trending up.`,
    });
  }
  if (nps.available && nps.score !== null && nps.score < 30) {
    items.push({
      severity: "watch",
      title: "Member satisfaction needs attention",
      detail: `NPS came in at ${nps.score} across ${nps.responses} responses. Reviewing the detractor comments should be a priority.`,
    });
  }
  return items;
}

export interface BoardReportContext {
  clubId: string;
  directorId: string;
  clubName: string;
  logoUrl: string | null;
  timezone: string;
  surveyUrl: string;
  // previous full calendar month boundaries (UTC)
  periodStart: Date;
  periodEnd: Date;
  periodLabel: string;
  generatedAtLabel: string;
}

export function previousMonthRange(now: Date): {
  start: Date;
  end: Date;
  label: string;
} {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const label = start.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return { start, end, label };
}

export async function getBoardReportData(
  db: SupabaseClient<any, "public", any>,
  ctx: BoardReportContext
): Promise<BoardReportData> {
  const [courts, membership, participation, nps] = await Promise.all([
    buildCourts(db, ctx.clubId, ctx.timezone, ctx.periodStart, ctx.periodEnd),
    buildMembership(db, ctx.directorId, ctx.periodStart, ctx.periodEnd),
    buildParticipation(db, ctx.directorId),
    buildNps(db, ctx.clubId, ctx.periodStart, ctx.periodEnd, ctx.surveyUrl),
  ]);

  return {
    isDemo: false,
    clubName: ctx.clubName,
    logoUrl: ctx.logoUrl,
    periodLabel: ctx.periodLabel,
    generatedAtLabel: ctx.generatedAtLabel,
    membership,
    courts,
    participation,
    nps,
    attention: buildAttention(courts, membership, nps),
  };
}

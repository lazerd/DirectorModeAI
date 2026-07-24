/**
 * CalendarMode — the placement brain.
 *
 * Given one event and one candidate date, produce a score and an ITEMIZED
 * explanation. The explanation is not a nicety: a director has to defend the
 * calendar to a board, and "the AI suggested it" is not a defence. Every number
 * here turns into a sentence the UI can show.
 *
 * Deliberately NOT an LLM. Date placement must be deterministic (ask twice, get
 * the same calendar), explainable (why this weekend and not the next one), and
 * cheap enough to re-run on every drag of the year grid. The AI's job is
 * choosing WHICH events belong on a club's calendar and writing the copy; this
 * file decides WHERE they go.
 *
 * Scores are additive around a base of 50. There is no upper bound by design —
 * a perfectly anchored, in-season, conflict-free Saturday should be able to run
 * away from the field rather than saturate against a ceiling.
 */

import {
  daysApart, dayOfWeek, monthOf, weekIndex, addDays, shortLabel, monthName,
} from './dates';
import { resolveAnchor } from './anchors';
import { playability, regionLabel } from './climate';
import { usHolidays, travelDrag } from './holidays';
import { inSeasonWindows, itemDates } from './slots';
import type {
  ISODate, PlanItem, ScoreContext, ScoreReason, ScoredSlot, Slot, Audience,
} from './types';

const BASE = 50;

/** Default minimum gap between two events, in days. */
const DEFAULT_MIN_DAYS_BETWEEN = 10;

/** Audience-collision lookback/lookahead, in days. */
const AUDIENCE_WINDOW_DAYS = 21;

export function scoreSlot(item: PlanItem, slot: Slot, ctx: ScoreContext): ScoredSlot {
  const reasons: ScoreReason[] = [];
  let score = BASE;
  let blocked = false;

  const add = (code: ScoreReason['code'], points: number, detail: string) => {
    reasons.push({ code, points, detail });
    score += points;
  };
  const block = (detail: string) => {
    blocked = true;
    reasons.push({ code: 'blocked', points: 0, detail });
  };

  const date = slot.date;
  const dates = itemDates(date, spanEnd(item, date));
  const lastDate = dates[dates.length - 1];

  // ---- Hard floor: nothing may be planned into the past ----
  if (ctx.notBefore && date < ctx.notBefore) {
    block(`${shortLabel(date)} has already passed.`);
  }

  // ---- Anchor: does this event want a specific date? ----
  const anchor = resolveAnchor(item.anchor_rule, ctx.year);
  const anchoredHere = !!anchor && daysApart(anchor.date, date) <= 2;
  if (anchor) {
    if (anchor.strength === 'exact') {
      if (date === anchor.date) {
        add('anchor', 45, `This is ${anchor.label} — exactly where this event belongs.`);
      } else {
        add('anchor', -55, `${item.title} is tied to ${anchor.label}; ${shortLabel(date)} isn't it.`);
      }
    } else {
      const dist = daysApart(anchor.date, date);
      const inWindow = date >= anchor.start && date <= lastWithin(anchor.end);
      if (dist === 0) {
        // A month preference isn't a date, so it can't "land exactly" on one.
        add('anchor', 40, anchor.kind === 'month'
          ? `${anchor.label} is the right month for this, and this is the strongest weekend in it.`
          : `Lands exactly on ${anchor.label}.`);
      } else if (inWindow) {
        // Decay across the window rather than a cliff at its edge.
        const radius = Math.max(1, Math.max(daysApart(anchor.start, anchor.date), daysApart(anchor.end, anchor.date)));
        const pts = Math.round(35 * (1 - dist / radius));
        add('anchor', pts, anchor.kind === 'month'
          ? `Well inside ${anchor.label}, which is where this event belongs.`
          : `${dist} day${dist === 1 ? '' : 's'} from ${anchor.label} — still reads as the right weekend.`);
      } else {
        add('anchor', -30, `Outside the ${anchor.label} window, which is the point of this event.`);
      }
    }
  }

  // ---- Seasonal identity ----
  const month = monthOf(date);
  if (item.idealMonths.length > 0) {
    if (item.idealMonths.includes(month)) {
      add('season', 15, `${monthName(month)} is a natural month for this event.`);
    } else {
      const list = item.idealMonths.map((m) => monthName(m).slice(0, 3)).join('/');
      add('season', -22, `This event is built for ${list}, not ${monthName(month)}.`);
    }
  }

  // ---- Club operating season ----
  const season = inSeasonWindows(date, ctx.seasonWindows);
  if (!season.inSeason) {
    add('season', -35, `${shortLabel(date)} falls outside the club's operating season.`);
  }

  // ---- Weather ----
  if (item.outdoor && ctx.climateRegion) {
    const p = playability(ctx.climateRegion, month);
    const pts = Math.round((p - 0.65) * 45);
    if (pts >= 8) {
      add('climate', pts, `${monthName(month)} is prime outdoor weather in ${regionLabel(ctx.climateRegion)}.`);
    } else if (pts <= -8) {
      add('climate', pts, `${monthName(month)} outdoors in ${regionLabel(ctx.climateRegion)} is a real risk (${Math.round(p * 100)}% playable).`);
    } else if (pts !== 0) {
      add('climate', pts, `${monthName(month)} weather is workable but not ideal.`);
    }
  }

  // ---- Holiday travel drag ----
  const holidays = usHolidays(ctx.year);
  const { drag, cause } = travelDrag(date, holidays);
  if (drag > 0.15 && cause) {
    if (anchoredHere) {
      add('holiday', 0, `${cause.name} weekend — quieter than usual, but that's deliberate here.`);
    } else {
      const pts = -Math.round(drag * 40);
      add('holiday', pts, `${cause.name} pulls members away — expect roughly ${Math.round(drag * 100)}% of the club to be travelling.`);
    }
  } else if (slot.holiday && !cause) {
    add('holiday', 0, `${slot.holiday}.`);
  }

  // ---- Imported constraints (school calendars, club events, USTA, holidays) ----
  for (const c of ctx.constraints) {
    if (!overlapsAny(dates, c.starts_on, c.ends_on)) continue;
    const relevant = audienceOverlap(c.audience_tags, item.audience);
    switch (c.impact) {
      case 'blocking':
        block(`${c.title} already owns ${shortLabel(date)}.`);
        break;
      case 'heavy':
        add('constraint', relevant ? -28 : -12,
          relevant
            ? `${c.title} competes directly for this event's people.`
            : `${c.title} is on — the club will be busier than usual.`);
        break;
      case 'light':
        add('constraint', -8, `${c.title} overlaps, but only lightly.`);
        break;
      case 'favorable':
        if (relevant) add('constraint', 14, `${c.title} actually helps — this audience is free and looking for something to do.`);
        break;
    }
  }

  // ---- Cadence: don't stack events on top of each other ----
  const minGap = ctx.goals?.min_days_between ?? DEFAULT_MIN_DAYS_BETWEEN;
  const others = ctx.placed.filter((p) => p.id !== item.id && p.target_date);
  let nearestGap = Infinity;
  let nearestTitle = '';
  for (const p of others) {
    const gap = daysApart(p.target_date!, date);
    if (gap < nearestGap) { nearestGap = gap; nearestTitle = p.title; }
  }
  if (nearestGap === 0) {
    add('cadence', -45, `${nearestTitle} is already on this date.`);
  } else if (Number.isFinite(nearestGap) && nearestGap < minGap) {
    const pts = -Math.round((minGap - nearestGap) * 3.5);
    add('cadence', pts, `Only ${nearestGap} day${nearestGap === 1 ? '' : 's'} after ${nearestTitle} — the calendar feels crowded here.`);
  } else if (Number.isFinite(nearestGap) && nearestGap >= minGap * 2) {
    add('cadence', 8, `Good spacing — ${nearestGap} days clear of anything else.`);
  }

  // ---- Audience fatigue ----
  const clashes = others.filter(
    (p) => daysApart(p.target_date!, date) <= AUDIENCE_WINDOW_DAYS && audienceOverlap(p.audience, item.audience),
  );
  if (clashes.length > 0) {
    const pts = Math.max(-30, -12 * clashes.length);
    const who = sharedAudience(clashes[0].audience, item.audience);
    add('audience', pts,
      `${clashes.length} other ${who} event${clashes.length === 1 ? '' : 's'} within three weeks — you're asking the same members twice.`);
  }

  // ---- Staff load ----
  const bigHere = item.effort === 'heavy' || item.effort === 'flagship';
  if (bigHere) {
    const wi = weekIndex(date);
    const adjacentBig = others.filter(
      (p) => Math.abs(weekIndex(p.target_date!) - wi) <= 1 && (p.effort === 'heavy' || p.effort === 'flagship'),
    );
    if (adjacentBig.length > 0) {
      add('staff', -20, `Back-to-back with ${adjacentBig[0].title}, another big lift — that's a hard two weeks on the staff.`);
    }
  }

  // ---- Court capacity, from CourtSheet ----
  const need = item.courts_needed ?? 0;
  if (need > 0 && ctx.courtLoad) {
    const load = ctx.courtLoad[date];
    if (load) {
      const free = Math.max(0, load.total - load.busy);
      if (free === 0) {
        block(`Every court is already committed on ${shortLabel(date)}.`);
      } else if (free < need) {
        add('courts', -32, `Needs ${need} courts but only ${free} are free — something has to move.`);
      } else if (free === need) {
        add('courts', -6, `Exactly enough courts, with nothing spare.`);
      } else {
        add('courts', 6, `${free} courts free, ${need} needed.`);
      }
    }
  }

  // ---- Day of week ----
  const dow = dayOfWeek(date);
  if (slot.holiday && dow === 1) add('dow', 10, `${slot.holiday} Monday plays like a weekend day.`);
  else if (dow === 6) add('dow', 12, 'Saturday — the strongest day for club events.');
  else if (dow === 0) add('dow', 6, 'Sunday works, though families often have other plans.');
  else if (dow === 5) add('dow', 5, 'Friday evening suits a social.');
  else add('dow', -12, `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dow]} is a weekday — expect a smaller turnout.`);

  // ---- Monthly pacing against the plan's goals ----
  const perMonth = ctx.goals?.events_per_month;
  if (perMonth && perMonth > 0) {
    const thisMonth = others.filter((p) => monthOf(p.target_date!) === month).length;
    if (thisMonth >= perMonth) {
      add('revenue', -Math.min(20, 7 * (thisMonth - perMonth + 1)),
        `${monthName(month)} already has ${thisMonth} event${thisMonth === 1 ? '' : 's'}, against a target of ${perMonth}.`);
    } else if (thisMonth === 0) {
      add('revenue', 10, `${monthName(month)} is currently empty.`);
    }
  }

  return {
    date,
    score: Math.round(score),
    blocked,
    reasons: reasons.sort((a, b) => Math.abs(b.points) - Math.abs(a.points)),
  };
}

/** Score every candidate and return them best-first. Blocked slots sort last. */
export function rankSlots(item: PlanItem, slots: Slot[], ctx: ScoreContext): ScoredSlot[] {
  return slots
    .map((s) => scoreSlot(item, s, ctx))
    .sort((a, b) => {
      if (a.blocked !== b.blocked) return a.blocked ? 1 : -1;
      return b.score - a.score;
    });
}

/**
 * The best N non-blocked dates for an event, as the `recommend` API returns
 * them. Falls back to blocked slots only if literally nothing is open, so the
 * UI can explain the problem rather than showing an empty list.
 */
export function recommendDates(
  item: PlanItem,
  slots: Slot[],
  ctx: ScoreContext,
  limit = 5,
): ScoredSlot[] {
  const ranked = rankSlots(item, slots, ctx);
  const open = ranked.filter((r) => !r.blocked);
  return (open.length > 0 ? open : ranked).slice(0, limit);
}

/** One-line summary of why a date won, for compact UI. */
export function topReason(scored: ScoredSlot): string {
  const positive = scored.reasons.find((r) => r.points > 0);
  return positive?.detail ?? scored.reasons[0]?.detail ?? 'No strong signal either way.';
}

// ---------- helpers ----------

/** The last date an item occupies, given a start. */
function spanEnd(item: PlanItem, start: ISODate): ISODate | null {
  if (!item.target_date || !item.target_end_date) return null;
  const span = daysApart(item.target_date, item.target_end_date);
  return span > 0 ? addDays(start, span) : null;
}

/** The anchor window end, inclusive. */
function lastWithin(end: ISODate): ISODate {
  return end;
}

function overlapsAny(dates: ISODate[], start: ISODate, end: ISODate): boolean {
  return dates.some((d) => d >= start && d <= end);
}

/** Empty tags on either side means "everyone", which always overlaps. */
function audienceOverlap(a: Audience[], b: Audience[]): boolean {
  if (a.length === 0 || b.length === 0) return true;
  if (a.includes('all') || b.includes('all')) return true;
  return a.some((x) => b.includes(x));
}

function sharedAudience(a: Audience[], b: Audience[]): string {
  const hit = a.find((x) => b.includes(x));
  return hit && hit !== 'all' ? hit : 'club';
}

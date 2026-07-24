/**
 * CalendarMode — the prompt used to read a calendar PDF or photo.
 *
 * Lives in lib so the route and the tests share one definition. Naming the
 * document type up front is what makes extraction reliable: a model told "this
 * is a swim meet schedule" pulls "Divisionals" off a grid that a model told
 * "this is a calendar" reads as a header.
 */

import type { CalendarKind } from './classify';

const DOC_HINT: Record<CalendarKind, string> = {
  school: 'This is a school or school-district calendar.',
  swim: 'This is a swim team schedule — meets, time trials, and championships.',
  usta: 'This is a tennis league schedule (USTA, junior team tennis, or interclub).',
  club: "This is a private club's event calendar — golf, dining, and member socials.",
  facility: 'This is a facility schedule — closures, maintenance, and private rentals.',
  holiday: 'This is a holiday calendar.',
  clubmode: 'This is a club event calendar.',
  manual: 'This is a calendar of scheduled activities.',
};

const INCLUDE_HINT: Record<CalendarKind, string> = {
  school:
    'breaks and vacations, no-school / no-student and teacher in-service days, early-release, minimum ' +
    'and shortened days, exam and testing periods, graduation, homecoming, prom and other major school ' +
    'socials, the first and last days of school, and parent-teacher conferences. Include federal and ' +
    'school holidays that close the school.',
  swim:
    'every meet (dual, tri, home, away, invitational), time trials, divisionals, all-stars, ' +
    'championship and postseason meets, water polo and diving competitions, and team socials such as ' +
    'the banquet or pasta feed. Record the opponent or meet name in the title where shown.',
  usta:
    'every match date with the flight, level, or team where shown; playoffs, districts, sectionals and ' +
    'other postseason dates; and any stated home/away designation.',
  club:
    'member-guest and championship events, golf outings and shotguns, dining events, galas, holiday ' +
    'parties, junior camps and clinics, and any event that occupies the membership for a day or evening.',
  facility:
    'court and pool closures, resurfacing, maintenance and construction windows, private rentals and ' +
    'buyouts, and anything that makes part of the facility unavailable.',
  holiday: 'every holiday and its observed date.',
  clubmode: 'every scheduled event with its date.',
  manual: 'anything with a date attached that would occupy members, staff, or the facility.',
};

const EXCLUDE_HINT: Record<CalendarKind, string> = {
  school:
    'picture day, book fairs, PTA meetings, report-card dates, and other purely administrative entries.',
  swim: 'routine daily practice times and registration or payment deadlines. Keep the meets.',
  usta: 'registration deadlines, captain meetings, and lineup due dates.',
  club: 'committee and board meetings, and administrative deadlines.',
  facility: 'routine daily opening hours.',
  holiday: 'nothing — keep every holiday.',
  clubmode: 'nothing.',
  manual: 'purely administrative entries with no bearing on availability.',
};

export const DEFAULT_LABEL: Record<CalendarKind, string> = {
  school: 'School calendar',
  swim: 'Swim schedule',
  usta: 'League schedule',
  club: 'Club events',
  facility: 'Facility schedule',
  holiday: 'Holidays',
  clubmode: 'ClubMode events',
  manual: 'Imported calendar',
};

/** The instruction text sent alongside the document. */
export function buildVisionPrompt(kind: CalendarKind, year: number): string {
  return [
    DOC_HINT[kind],
    '',
    'Extract every DATED entry that would affect when a racquets and swim club can schedule events for its members.',
    '',
    `INCLUDE: ${INCLUDE_HINT[kind]}`,
    `EXCLUDE: ${EXCLUDE_HINT[kind]}`,
    '',
    `Unless the document says otherwise, assume dates fall in ${year} or ${year + 1}. Many calendars show ` +
      'only a month and day — infer the year from context (for a school year, August through December is ' +
      'the first year and January through July the second). Return every date as YYYY-MM-DD.',
    '',
    'For a multi-day span (a week-long break, a three-day championship), return ONE entry with the first ' +
      'and last day, not one per day. For a single day, set end equal to start. A break that runs across ' +
      'New Year is ONE entry spanning both years — a winter break listed as Dec 21 to Jan 1 must come ' +
      'back as a single entry, never split at the year boundary.',
    '',
    'Put ONLY the entry text in the title, exactly as written, including abbreviations ("Min. Day", ' +
      '"PD Day", "BTSN"). Do not expand or tidy them, and do not prefix the title with the date — the ' +
      'dates go in the start and end fields.',
    '',
    'Call record_calendar exactly once with everything you found. If the document has no dated entries, ' +
      'call it with an empty list.',
  ].join('\n');
}

/** The forced tool the model must call. */
export const VISION_TOOL = {
  name: 'record_calendar',
  description: 'Record the dated entries found on the calendar.',
  input_schema: {
    type: 'object',
    properties: {
      entries: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description:
                'The entry as written, e.g. "Spring Break", "Dual Meet vs Moraga", "Courts 5-8 Resurfacing"',
            },
            start: { type: 'string', description: 'First day, YYYY-MM-DD' },
            end: {
              type: 'string',
              description: 'Last day inclusive, YYYY-MM-DD. Same as start for a single day.',
            },
          },
          required: ['title', 'start', 'end'],
        },
      },
      documentLabel: {
        type: 'string',
        description:
          'A short name for this calendar, e.g. "Orinda Union SD 2027-28" or "Otters summer meet schedule"',
      },
    },
    required: ['entries'],
  },
} as const;

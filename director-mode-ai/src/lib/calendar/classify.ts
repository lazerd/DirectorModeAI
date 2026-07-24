/**
 * CalendarMode — turning an imported calendar line into a planning constraint.
 *
 * A director doesn't have one calendar to work around, they have a stack of
 * them: the school district's, the swim team's meet schedule, the USTA league
 * grid, the golf and dining calendar, and the facility's closure list. Each has
 * its own vocabulary — "Divisionals" and "Homecoming" and "Aerification" all
 * mean "don't put an event here", and nothing but a lookup will tell you that.
 *
 * So the importer asks WHICH KIND of calendar you're uploading, and this module
 * classifies against that vocabulary. Rules, not an LLM: the vocabulary of
 * these calendars is small, stable, and worth being exactly right about, and a
 * director editing one wrong guess in a review table is far cheaper than a
 * per-row model call. The vision importer still uses Claude to READ a PDF — it
 * just doesn't need it to know that Divisionals empties a swim club.
 */

import type { Audience, ConstraintImpact } from './types';

/** What kind of calendar a file is. Maps 1:1 onto calendar_constraints.source. */
export type CalendarKind =
  | 'school'
  | 'swim'
  | 'usta'
  | 'club'
  | 'facility'
  | 'holiday'
  | 'clubmode'
  | 'manual';

export interface CalendarKindOption {
  value: CalendarKind;
  label: string;
  hint: string;
  /** Shown in the uploader as an example of what belongs here. */
  examples: string;
}

/** The picker offered in the import UI. */
export const CALENDAR_KINDS: CalendarKindOption[] = [
  {
    value: 'school',
    label: 'School / district',
    hint: 'Breaks, no-school days, exams, graduation, homecoming.',
    examples: 'Orinda Union SD 2027-28',
  },
  {
    value: 'swim',
    label: 'Swim team & meets',
    hint: 'Dual meets, time trials, divisionals, all-stars, championships.',
    examples: 'Orinda Aquatics summer meet schedule',
  },
  {
    value: 'usta',
    label: 'League play',
    hint: 'USTA, JTT, interclub — anything that claims courts on a weekend.',
    examples: 'USTA NorCal 3.5 Adult 40+ schedule',
  },
  {
    value: 'club',
    label: 'Club events',
    hint: 'Golf, dining, member socials — the other departments\' calendar.',
    examples: 'Golf member-guest, wine dinners, board meetings',
  },
  {
    value: 'facility',
    label: 'Facility & maintenance',
    hint: 'Court resurfacing, pool closures, private rentals, construction.',
    examples: 'Court 5-8 resurfacing, pool drain week',
  },
  {
    value: 'manual',
    label: 'Something else',
    hint: 'Anything with dates. Guesses will be softer — check the review table.',
    examples: 'A camp schedule, a town calendar',
  },
];

export interface Classification {
  impact: ConstraintImpact;
  audience_tags: Audience[];
  /** Why this guess was made, shown in the review table. */
  note: string;
  /** Rows the director almost certainly doesn't want as constraints. */
  ignore: boolean;
}

interface Rule {
  test: RegExp;
  impact: ConstraintImpact;
  audience: Audience[];
  note: string;
  ignore?: boolean;
  /** Which calendar kinds this rule applies to. Omitted = all of them. */
  kinds?: CalendarKind[];
}

// ============================================================
// Universal noise — real calendar entries that shouldn't shape programming
// ============================================================
const NOISE: Rule[] = [
  {
    test: /\b(picture|photo)\s*day|yearbook|book fair|fundraiser night|pta|pto\s*meeting|report cards?|progress reports?|newsletter|deadline to register|registration opens|dues? due|payment due/i,
    impact: 'light', audience: [], note: 'Administrative — no real effect on court or pool time.', ignore: true,
  },
  {
    test: /\bboard\s*meeting\b|\bcommittee\s*meeting\b|\bagm\b|\bannual\s*meeting\b|\bstaff\s*meeting\b/i,
    impact: 'light', audience: [], note: 'A meeting — occupies a room, not the courts.', ignore: true,
  },
];

// ============================================================
// Aquatics — the swim team's own calendar
// ============================================================
// A swim club's summer is built around meets. On meet day the pool deck, the
// parking, the snack bar and most of the volunteer parents are committed, and
// a tennis social scheduled against Divisionals will not happen.
const SWIM: Rule[] = [
  {
    test: /\b(champs?|championship)s?\b.*\bmeet\b|\bmeet\b.*\bchampionships?\b|\bdivisionals?\b|\bcounty\s*champs?\b|\ball[-\s]?stars?\b|\bsectionals?\b|\bjr\.?\s*olympics?\b|\bjunior\s*olympics?\b|\bfar\s*westerns?\b/i,
    impact: 'blocking', audience: ['family', 'junior', 'all'],
    note: 'A championship meet — the club effectively shuts down around this.',
    kinds: ['swim', 'club', 'facility', 'manual'],
  },
  {
    test: /\b(dual|tri|quad|invitational|home|away|travelling|traveling)\s*meet\b|\bswim\s*meet\b|\bmeet\s*vs?\.?\b|\bmeet\s*@\b|\bpentathlon\b|\brelay\s*carnival\b|\btime\s*trials?\b/i,
    impact: 'blocking', audience: ['family', 'junior'],
    note: 'A swim meet — the pool deck and most swim families are committed all morning.',
    kinds: ['swim', 'club', 'facility', 'manual'],
  },
  {
    test: /\bwater\s*polo\b|\bdiving\s*(meet|competition)\b|\bsynchro\b|\bartistic\s*swimming\b/i,
    impact: 'heavy', audience: ['family', 'junior'],
    note: 'Aquatics competition — pool and families committed.',
    kinds: ['swim', 'club', 'facility', 'manual'],
  },
  {
    test: /\bswim\s*(team\s*)?(practice|workout|training)\b|\bmorning\s*practice\b|\bdryland\b/i,
    impact: 'light', audience: ['junior'],
    note: 'Routine practice — pool time, but the courts are free.',
    kinds: ['swim', 'club', 'manual'],
  },
  {
    test: /\bswim\s*(banquet|awards|picnic|social)\b|\bend[-\s]?of[-\s]?season\s*(party|banquet)\b|\bpasta\s*(feed|party)\b/i,
    impact: 'heavy', audience: ['family', 'junior'],
    note: 'A swim-team social — the same families, the same evening.',
    kinds: ['swim', 'club', 'manual'],
  },
  {
    test: /\b(lifeguard|water\s*safety|cpr)\s*(training|certification|class)\b|\bswim\s*lessons?\b/i,
    impact: 'light', audience: [],
    note: 'Aquatics programming — no effect on court time.',
    kinds: ['swim', 'club', 'facility', 'manual'],
  },
];

// ============================================================
// League play — anything that claims courts
// ============================================================
const LEAGUE: Rule[] = [
  {
    test: /\busta\b|\bleague\s*(match|play|night)\b|\bjtt\b|\bteam\s*tennis\b|\bmatch\s*day\b|\binterclub\b|\bdual\s*match\b|\bhome\s*match\b|\btri[-\s]?level\b|\bmixed\s*40\b|\badult\s*\d\.\d\b/i,
    impact: 'blocking', audience: [],
    note: 'League play already has the courts.',
  },
  {
    test: /\bplayoffs?\b|\bdistricts?\b|\bsectionals?\b|\bnationals?\b|\bnorcal\b|\bregionals?\b|\bstate\s*championships?\b/i,
    impact: 'blocking', audience: [],
    note: 'Postseason play — courts and your strongest players are committed.',
    kinds: ['usta', 'club', 'clubmode', 'manual'],
  },
  {
    test: /\bpractice\s*match\b|\bcaptains?\s*meeting\b|\brostering\b|\bline[-\s]?up\s*due\b/i,
    impact: 'light', audience: ['adult'],
    note: 'League admin — a deadline or a meeting, not court time.',
    ignore: true,
    kinds: ['usta', 'club', 'manual'],
  },
];

// ============================================================
// Facility — the hard stops
// ============================================================
const FACILITY: Rule[] = [
  {
    test: /\b(court|pool|deck|clubhouse)s?\b.*\b(closed|closure|resurfac\w*|repair\w*|maintenance|renovat\w*|construction|painting|repaving|drain\w*)\b|\bresurfac\w*\b|\baerification\b|\bovers(ee)?d\w*\b|\bcourt\s*\d+[-\s]*\d*\s*closed\b/i,
    impact: 'blocking', audience: [],
    note: 'Facility unavailable.',
  },
  {
    test: /\bclosed\b|\bclosure\b|\bshut\s*down\b|\bblackout\b/i,
    impact: 'blocking', audience: [],
    note: 'Closed — nothing can run.',
    kinds: ['facility', 'club', 'swim', 'manual'],
  },
  {
    test: /\bwedding\b|\bprivate\s*(event|party|rental|function)\b|\bbanquet\s*rental\b|\bbuyout\b|\brented\b/i,
    impact: 'blocking', audience: [],
    note: 'The facility is booked for a private function.',
  },
  {
    test: /\bdeep\s*clean\b|\bpest\b|\binspection\b|\bfire\s*drill\b|\bpower\s*(outage|shutoff)\b|\bpsps\b/i,
    impact: 'heavy', audience: [],
    note: 'Facility work — expect disruption.',
    kinds: ['facility', 'club', 'manual'],
  },
];

// ============================================================
// Club events — the other departments
// ============================================================
const CLUB: Rule[] = [
  {
    test: /\bmember[-\s]?guest\b|\bclub\s*championships?\b|\binvitational\b|\bcalcutta\b|\bmember[-\s]?member\b/i,
    impact: 'blocking', audience: [],
    note: 'A flagship club event already owns this date.',
  },
  {
    test: /\bgolf\b|\bshotgun\b|\bscramble\b|\btee\s*times?\b|\bmen'?s\s*day\b|\bladies'?\s*day\b/i,
    impact: 'heavy', audience: ['adult'],
    note: 'Golf has the membership that day.',
    kinds: ['club', 'facility', 'clubmode', 'manual'],
  },
  {
    test: /\b(wine|beer)\s*(dinner|tasting)\b|\bgala\b|\bdinner\s*dance\b|\bnew\s*member\s*(reception|party)\b|\bmember\s*appreciation\b|\bhalloween\s*party\b|\bholiday\s*party\b|\bfireworks\b|\bbbq\b|\bcookout\b|\bluau\b|\btrivia\s*night\b|\bmovie\s*night\b/i,
    impact: 'heavy', audience: ['adult', 'family'],
    note: 'A club social — the same members, the same evening.',
    kinds: ['club', 'swim', 'facility', 'clubmode', 'manual'],
  },
  {
    test: /\bcamp\b|\bclinic\b|\bjunior\s*program\b|\bacademy\b/i,
    impact: 'heavy', audience: ['junior'],
    note: 'Junior programming is running — courts and coaches are committed.',
    kinds: ['club', 'school', 'swim', 'clubmode', 'manual'],
  },
  {
    test: /\btournament\b|\bchampionships?\b/i,
    impact: 'heavy', audience: [],
    note: 'Another event is running.',
  },
];

// ============================================================
// School — breaks, exams, and the social calendar juniors care about
// ============================================================
const SCHOOL: Rule[] = [
  {
    test: /\bspring\s*(break|recess)\b/i,
    impact: 'favorable', audience: ['family', 'junior'],
    note: 'Spring break — juniors and families are free during the day, though some travel.',
  },
  {
    test: /\b(winter|christmas|holiday)\s*(break|recess|vacation)\b/i,
    impact: 'heavy', audience: ['family', 'junior', 'adult'],
    note: 'Winter break — most members are travelling.',
  },
  {
    test: /\bthanksgiving\s*(break|recess|holiday)\b/i,
    impact: 'heavy', audience: ['family', 'junior', 'adult'],
    note: 'Thanksgiving break — heavy travel.',
  },
  {
    test: /\b(summer\s*break|summer\s*vacation|last day of school)\b/i,
    impact: 'favorable', audience: ['junior', 'family'],
    note: 'School is out — peak junior availability.',
  },
  {
    test: /\b(mid[-\s]?winter|february)\s*(break|recess)\b/i,
    impact: 'heavy', audience: ['family', 'junior'],
    note: 'Mid-winter break — a chunk of families travel.',
  },
  {
    test: /\b(fall|autumn)\s*(break|recess)\b/i,
    impact: 'favorable', audience: ['junior', 'family'],
    note: 'Fall break — juniors are free.',
  },
  {
    test: /\bfinals?\b|\bexams?\b|\bmidterms?\b|\bap\s*(testing|exams?)\b|\bstate\s*testing\b|\bsbac\b|\bstaar\b|\bregents\b|\bsat\b|\bact\s*test\b/i,
    impact: 'heavy', audience: ['junior'],
    note: 'Exams — do not schedule junior events against this.',
  },
  {
    test: /\bhomecoming\b|\bprom\b|\bwinter\s*formal\b|\bspirit\s*week\b|\bsenior\s*(night|week)\b|\bsadie\b/i,
    impact: 'blocking', audience: ['junior', 'family'],
    note: 'A major school social event — juniors will not come.',
  },
  {
    test: /\bgraduation\b|\bcommencement\b|\bbaccalaureate\b|\bpromotion\b|\bmoving\s*up\b/i,
    impact: 'blocking', audience: ['junior', 'family'],
    note: 'Graduation — families are committed all day.',
  },
  // These MUST precede the minimum-day rule below.
  //
  // Real entries compound: "Elem Conf.; Elem Min. Days", "Elem. Open House;
  // Elem Min. Day". Both halves are true — the kids get out early AND the
  // parents are at school that evening — but the obligation is what decides
  // whether the club can run something, so the obligation wins. Scoring a
  // conference week as a great clinic opportunity is the expensive mistake.
  {
    // BTSN = Back To School Night, near-universal on district calendars.
    test: /\bback[-\s]?to[-\s]?school\b|\bbtsn\b|\bfirst day of school\b|\bopen house\b|\bcurriculum night\b|\bschool\s*registration\b/i,
    impact: 'heavy', audience: ['junior', 'family'],
    note: 'A school evening — families are at school, not at the club.',
  },
  {
    // "Conf." is how conference weeks are almost always abbreviated.
    test: /\bparent[-\s]?teacher\b|\bconferences?\b|\bconf\.?(?![a-z])/i,
    impact: 'heavy', audience: ['family', 'junior'],
    note: 'Conference week — parents are at school in the afternoons and evenings.',
  },
  // Real district calendars abbreviate relentlessly: "PD Day", "Non-Stu. Day",
  // "Cert. PD", "Min. Day". Matching only the spelled-out forms silently loses
  // the single most valuable category on the whole calendar — the free
  // weekday afternoons that make the best junior clinic dates of the year.
  {
    test: /\bno\s*school\b|\bschool\s*closed\b|\bstudent\s*holiday\b|\bin[-\s]?service\b|\bprofessional\s*development\b|\bteacher\s*work\s*day\b|\bstaff\s*development\b|\bnon[-\s]?stu(dent)?\.?\s*days?\b|\b(cert(ificated)?\.?\s*)?pd\s*days?\b|\bpupil[-\s]?free\b|\binstitute\s*day\b/i,
    impact: 'favorable', audience: ['junior', 'family'],
    note: 'No school — a full day of available juniors. Prime camp or clinic date.',
  },
  {
    test: /\bmin\.?\s*days?\b|\b(minimum|early\s*release|half)\s*days?\b|\bearly\s*dismissal\b|\bshortened\s*days?\b|\bhalf[-\s]?day\b/i,
    impact: 'favorable', audience: ['junior'],
    note: 'Minimum / early-release day — juniors are free from mid-afternoon. Good clinic slot.',
  },
  // A holiday only appears on a district calendar because school is CLOSED, so
  // on this calendar it means a free weekday full of juniors. The scorer
  // applies holiday travel drag separately, so both effects land — which is an
  // honest picture of a long weekend: quieter overall, but whoever is in town
  // has the whole day.
  {
    test: /\bmartin\s*luther\s*king\b|\bmlk\b|\bpresidents?'?s?\s*day\b|\bveterans?'?s?\s*day\b|\blincoln'?s?\s*(birthday|day)\b|\bcesar\s*chavez\b|\bindigenous\s*peoples?\b|\bcolumbus\s*day\b|\bjuneteenth\b|\blabor\s*day\b|\bmemorial\s*day\b/i,
    impact: 'favorable', audience: ['junior', 'family'],
    note: 'School holiday — no school, so juniors are free all day.',
    kinds: ['school'],
  },
];

// ============================================================
// Public holidays
// ============================================================
const HOLIDAYS: Rule[] = [
  {
    test: /\bmemorial\s*day\b|\blabor\s*day\b|\bindependence\s*day\b|\bfourth of july\b|\bjuly\s*4\b|\bthanksgiving\b|\bchristmas\b|\bnew\s*year'?s?\b/i,
    impact: 'light', audience: [],
    note: 'A holiday — the planner already accounts for travel on these.',
  },
  {
    test: /\bholiday\b|\bobserved\b|\bpresidents?\s*day\b|\bmlk\b|\bveterans?\s*day\b|\bindigenous\b|\bcolumbus\s*day\b|\bjuneteenth\b/i,
    impact: 'favorable', audience: ['junior', 'family'],
    note: 'A holiday — juniors and families are free.',
  },
];

/**
 * Rule order per calendar kind. The declared kind decides which vocabulary is
 * consulted FIRST, which is what stops "Championships" on a swim calendar from
 * being read as a tennis tournament.
 */
const ORDER: Record<CalendarKind, Rule[][]> = {
  school:   [NOISE, SCHOOL, HOLIDAYS, FACILITY, LEAGUE, SWIM, CLUB],
  swim:     [NOISE, SWIM, FACILITY, HOLIDAYS, CLUB, LEAGUE, SCHOOL],
  usta:     [NOISE, LEAGUE, FACILITY, CLUB, HOLIDAYS, SWIM, SCHOOL],
  club:     [NOISE, CLUB, FACILITY, LEAGUE, SWIM, HOLIDAYS, SCHOOL],
  facility: [NOISE, FACILITY, CLUB, SWIM, LEAGUE, HOLIDAYS, SCHOOL],
  holiday:  [NOISE, HOLIDAYS, SCHOOL, CLUB, FACILITY, LEAGUE, SWIM],
  clubmode: [NOISE, CLUB, LEAGUE, FACILITY, SWIM, HOLIDAYS, SCHOOL],
  manual:   [NOISE, FACILITY, LEAGUE, SWIM, CLUB, SCHOOL, HOLIDAYS],
};

/**
 * What an UNRECOGNISED dated row probably means, given the calendar it came
 * from. A stray line on a swim meet schedule is far more likely to be a meet
 * than to be nothing, and defaulting it to 'light' quietly loses the conflict.
 * Erring toward 'heavy' on competition calendars is the safer mistake: the
 * director sees it in the review table either way.
 */
const UNKNOWN_DEFAULT: Record<CalendarKind, { impact: ConstraintImpact; audience: Audience[]; note: string }> = {
  school: {
    impact: 'light', audience: [],
    note: 'Unrecognised school entry — kept as a light note. Change the impact if it matters.',
  },
  swim: {
    impact: 'heavy', audience: ['family', 'junior'],
    note: 'Unrecognised entry on a swim calendar — assumed to occupy swim families. Adjust if not.',
  },
  usta: {
    impact: 'blocking', audience: [],
    note: 'Unrecognised entry on a league schedule — assumed to claim courts. Adjust if not.',
  },
  club: {
    impact: 'heavy', audience: [],
    note: 'Unrecognised club event — assumed to compete for members. Adjust if not.',
  },
  facility: {
    impact: 'blocking', audience: [],
    note: 'Unrecognised entry on a facility calendar — assumed to close something. Adjust if not.',
  },
  holiday: {
    impact: 'light', audience: [],
    note: 'Unrecognised holiday entry — kept as a light note.',
  },
  clubmode: {
    impact: 'blocking', audience: [],
    note: 'An event already scheduled in ClubMode.',
  },
  manual: {
    impact: 'light', audience: [],
    note: 'Kept as a light note. Change the impact if it matters.',
  },
};

/**
 * Classify one imported calendar line against the vocabulary of the calendar
 * it came from. Anything unrecognised falls back to a kind-appropriate default
 * — always visible in the review table, never silently dropped.
 */
export function classifyImported(title: string, kind: CalendarKind = 'school'): Classification {
  const t = (title || '').trim();
  if (!t) return { impact: 'light', audience_tags: [], note: 'No title.', ignore: true };

  const groups = ORDER[kind] ?? ORDER.manual;
  for (const group of groups) {
    for (const rule of group) {
      if (rule.kinds && !rule.kinds.includes(kind)) continue;
      if (rule.test.test(t)) {
        return {
          impact: rule.impact,
          audience_tags: rule.audience,
          note: rule.note,
          ignore: rule.ignore ?? false,
        };
      }
    }
  }

  const fallback = UNKNOWN_DEFAULT[kind] ?? UNKNOWN_DEFAULT.manual;
  return {
    impact: fallback.impact,
    audience_tags: fallback.audience,
    note: fallback.note,
    ignore: false,
  };
}

/**
 * A whole-week or longer span is a break or a closure, not an appointment, and
 * should be treated as such even when the title is unhelpful ("Non-Student
 * Days", "Maintenance"). Applied after classification so an explicit rule wins.
 */
export function widenForLongSpans(c: Classification, days: number): Classification {
  if (days < 5 || c.impact === 'blocking' || c.ignore) return c;
  if (c.impact === 'light') {
    return { ...c, impact: 'heavy', note: `${c.note} Spans ${days} days, so treated as a break.` };
  }
  return c;
}

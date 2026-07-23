/**
 * CalendarMode — turning an imported calendar line into a planning constraint.
 *
 * A school district exports ~200 lines a year. Most are noise ("Picture Day"),
 * some are decisive ("Spring Break", "Graduation"), and a handful are actively
 * GOOD for the club ("No School — Teacher In-Service" is a full day of free
 * juniors). Asking a director to hand-classify all of them is exactly the chore
 * CalendarMode exists to remove.
 *
 * So imports run through this classifier first and land as a reviewable table
 * with a sensible guess already filled in. Rules, not an LLM: the vocabulary of
 * school calendars is small and stable, and a director editing a wrong guess in
 * a review table is far cheaper than a per-row model call. The vision importer
 * still uses Claude to READ a PDF — it just doesn't need it to know that
 * "Winter Break" empties the club.
 */

import type { Audience, ConstraintImpact, ConstraintSource } from './types';

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
}

// Order matters — the first match wins, so specific patterns precede general.
const RULES: Rule[] = [
  // ---- Noise: real calendar entries that shouldn't shape club programming ----
  {
    test: /\b(picture|photo)\s*day|yearbook|book fair|fundraiser night|pta|pto\s*meeting|board meeting|report cards?|progress reports?|newsletter/i,
    impact: 'light', audience: [], note: 'Administrative — no real effect on the club.', ignore: true,
  },

  // ---- Breaks: whole families are away, or conspicuously around ----
  {
    test: /\bspring\s*break\b|\bspring\s*recess\b/i,
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

  // ---- No-school days: gold for junior programming ----
  {
    test: /\bno\s*school\b|\bschool\s*closed\b|\bstudent\s*holiday\b|\bin[-\s]?service\b|\bprofessional\s*development\b|\bteacher\s*work\s*day\b|\bstaff\s*development\b/i,
    impact: 'favorable', audience: ['junior', 'family'],
    note: 'No school — a full day of available juniors. Prime camp or clinic date.',
  },
  {
    test: /\b(minimum|early\s*release|half)\s*day\b|\bearly\s*dismissal\b/i,
    impact: 'favorable', audience: ['junior'],
    note: 'Early release — juniors free from mid-afternoon.',
  },

  // ---- Exams and academic crunch: juniors vanish, parents are stressed ----
  {
    test: /\bfinals?\b|\bexams?\b|\bmidterms?\b|\bap\s*(testing|exams?)\b|\bstate\s*testing\b|\bsbac\b|\bstaar\b|\bregents\b/i,
    impact: 'heavy', audience: ['junior'],
    note: 'Exams — do not schedule junior events against this.',
  },

  // ---- School social events: they beat a club event every time ----
  {
    test: /\bhomecoming\b|\bprom\b|\bwinter\s*formal\b|\bspirit\s*week\b|\bsenior\s*(night|week)\b/i,
    impact: 'blocking', audience: ['junior', 'family'],
    note: 'A major school social event — juniors will not come.',
  },
  {
    test: /\bgraduation\b|\bcommencement\b|\bbaccalaureate\b|\bpromotion\s*ceremony\b/i,
    impact: 'blocking', audience: ['junior', 'family'],
    note: 'Graduation — families are committed all day.',
  },
  {
    test: /\bback[-\s]?to[-\s]?school\b|\bfirst day of school\b|\bopen house\b|\bcurriculum night\b|\bregistration\b/i,
    impact: 'heavy', audience: ['junior', 'family'],
    note: 'Back-to-school — families are occupied and schedules are unsettled.',
  },
  {
    test: /\bparent[-\s]?teacher\b|\bconferences?\b/i,
    impact: 'heavy', audience: ['family', 'junior'],
    note: 'Parent-teacher conferences — evenings are spoken for.',
  },

  // ---- Club-side conflicts ----
  {
    test: /\bmember[-\s]?guest\b|\bclub\s*championship\b|\binvitational\b|\bcalcutta\b/i,
    impact: 'blocking', audience: [],
    note: 'A flagship club event already owns this date.',
  },
  {
    test: /\bgolf\b|\bswim\s*meet\b|\bregatta\b|\btournament\b/i,
    impact: 'heavy', audience: [],
    note: 'Another department has a major event running.',
  },
  {
    test: /\bcourt\s*(resurfac|maintenance|closed|repair)|\bconstruction\b|\bclosed for\b|\bpool\s*closed\b/i,
    impact: 'blocking', audience: [],
    note: 'Facility unavailable.',
  },
  {
    test: /\busta\b|\bleague\s*match\b|\bjtt\b|\bteam\s*tennis\b|\bmatch\s*day\b/i,
    impact: 'blocking', audience: [],
    note: 'League play already has the courts.',
  },
  {
    test: /\bwedding\b|\bprivate\s*event\b|\bbanquet\b|\brental\b/i,
    impact: 'blocking', audience: [],
    note: 'The facility is booked for a private function.',
  },

  // ---- Big public holidays that show up on school calendars ----
  {
    test: /\bmemorial\s*day\b|\blabor\s*day\b|\bindependence\s*day\b|\bfourth of july\b|\bjuly\s*4\b/i,
    impact: 'light', audience: [],
    note: 'A holiday — the planner already accounts for travel on these.',
  },
  {
    test: /\bholiday\b|\bobserved\b|\bpresidents?\s*day\b|\bmlk\b|\bveterans?\s*day\b|\bindigenous\b|\bcolumbus\s*day\b/i,
    impact: 'favorable', audience: ['junior', 'family'],
    note: 'A school holiday — juniors are free.',
  },
];

/**
 * Classify one imported calendar line.
 * Anything unrecognised comes back as a mild, unignored 'light' constraint —
 * visible in the review table so the director can promote it, but not silently
 * distorting the plan.
 */
export function classifyImported(
  title: string,
  source: ConstraintSource = 'school',
): Classification {
  const t = (title || '').trim();
  if (!t) {
    return { impact: 'light', audience_tags: [], note: 'No title.', ignore: true };
  }

  for (const rule of RULES) {
    if (rule.test.test(t)) {
      return {
        impact: rule.impact,
        audience_tags: rule.audience,
        note: rule.note,
        ignore: rule.ignore ?? false,
      };
    }
  }

  return {
    impact: 'light',
    audience_tags: [],
    note: source === 'school'
      ? 'Unrecognised school entry — kept as a light note. Change the impact if it matters.'
      : 'Kept as a light note. Change the impact if it matters.',
    ignore: false,
  };
}

/**
 * A whole-week or longer span is a break, not an appointment, and should be
 * treated as such even when the title is unhelpful ("Non-Student Days").
 * Applied after classification so an explicit rule always wins.
 */
export function widenForLongSpans(c: Classification, days: number): Classification {
  if (days < 5 || c.impact === 'blocking' || c.ignore) return c;
  if (c.impact === 'light') {
    return {
      ...c,
      impact: 'heavy',
      note: `${c.note} Spans ${days} days, so treated as a break.`,
    };
  }
  return c;
}

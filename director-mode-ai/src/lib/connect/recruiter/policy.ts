/**
 * ClubMode Recruiting — the RECRUITER policy. Pure (no DB, no I/O), unit tested.
 *
 * Darrin's rule of thumb: "If Congressional is paying a director $250,000, we'd be
 * looking for directors within a 50-mile radius making $180,000." That is, the
 * best prospects for a job are people for whom the job is a RAISE, who live close
 * enough to take it. Every number below is a knob; change it here and the tests
 * tell you what moved.
 *
 * Comp bands are fractions of the job's TARGET COMP (posted comp_max, else the
 * scout's 990-peer estimate est_comp):
 *
 *   step_up  60%–90%   the job is a 10–65% raise for them. Most likely to move. (Darrin's $180k for $250k = 72%.)
 *   lateral  90%–110%  roughly the same money; moves for scope, location or prestige.
 *   stretch  45%–60%   a big jump; plausible for a strong #2 / head pro at a smaller club.
 *   (above 110% they would take a pay cut, below 45% the jump is not credible: excluded.)
 *
 * Radius scales with pay because relocation becomes plausible as the job gets bigger:
 *
 *   target < $120k   50 mi   (local market; nobody moves a family for $95k)
 *   target < $180k  100 mi
 *   target < $300k  250 mi
 *   target ≥ $300k  national (top jobs recruit nationally)
 *
 * Within the max radius, the first PREFERRED_MILES (50) score full marks for
 * distance and the score decays linearly to a floor at the edge, so a local
 * step-up candidate still beats an equal one 240 miles away. Assistant roles never
 * search beyond 50 miles.
 */

export const BANDS = {
  step_up: { min: 0.6, max: 0.9 },
  lateral: { min: 0.9, max: 1.1 },
  stretch: { min: 0.45, max: 0.6 },
} as const;

export type Tier = keyof typeof BANDS;

/** [upper bound on target comp (exclusive), max radius in miles (null = national)] */
export const RADIUS_STEPS: ReadonlyArray<readonly [number, number | null]> = [
  [120_000, 50],
  [180_000, 100],
  [300_000, 250],
  [Number.POSITIVE_INFINITY, null],
];

/** Everyone inside this distance scores full distance points. */
export const PREFERRED_MILES = 50;
/** Assistant / junior roles: local only, whatever the pay. */
export const ASSISTANT_MAX_MILES = 50;

/** A prospect at/above this score is a "strong fit" (admin display only; NEVER counts toward a club pitch). */
export const STRONG_FIT_SCORE = 70;
/**
 * Pitch a club only when at least this many candidates CONFIRMED interest (2+)
 * (a connect_job_interests row: contacted, saw the role, clicked "I'm interested,
 * present me" with consent). Ranked prospects never count. Darrin, 2026-10-22.
 */
export const MIN_CONFIRMED_FOR_PITCH = 2;
/** How many prospects we keep per job. */
export const TOP_N = 25;

export type Band = { min: number; max: number };
export type TargetBands = {
  targetComp: number;
  step_up: Band;
  lateral: Band;
  stretch: Band;
  /** null = national search */
  maxRadiusMiles: number | null;
  preferredMiles: number;
};

export function radiusFor(targetComp: number, roleLevel?: string | null): number | null {
  let r: number | null = null;
  for (const [ceiling, miles] of RADIUS_STEPS) {
    if (targetComp < ceiling) {
      r = miles;
      break;
    }
  }
  if (roleLevel === 'assistant') return r == null ? ASSISTANT_MAX_MILES : Math.min(r, ASSISTANT_MAX_MILES);
  return r;
}

/** The comp bands and search radius for a job paying `targetComp`. */
export function targetBands(targetComp: number, roleLevel?: string | null): TargetBands {
  const t = Math.max(0, Math.round(targetComp));
  const band = (b: { min: number; max: number }): Band => ({ min: Math.round(t * b.min), max: Math.round(t * b.max) });
  const maxRadiusMiles = radiusFor(t, roleLevel);
  return {
    targetComp: t,
    step_up: band(BANDS.step_up),
    lateral: band(BANDS.lateral),
    stretch: band(BANDS.stretch),
    maxRadiusMiles,
    preferredMiles: maxRadiusMiles == null ? PREFERRED_MILES : Math.min(PREFERRED_MILES, maxRadiusMiles),
  };
}

/** Which band a person earning `comp` falls in for this job, or null if outside all bands. */
export function tierFor(comp: number, bands: TargetBands): Tier | null {
  if (!(comp > 0) || !(bands.targetComp > 0)) return null;
  // Boundaries: step_up owns [60%, 90%), lateral [90%, 110%], stretch [45%, 60%).
  if (comp >= bands.step_up.min && comp < bands.step_up.max) return 'step_up';
  if (comp >= bands.lateral.min && comp <= bands.lateral.max) return 'lateral';
  if (comp >= bands.stretch.min && comp < bands.stretch.max) return 'stretch';
  return null;
}

/** Target comp for a job: posted ceiling first, then the scout's 990-peer estimate. */
export function targetCompFor(job: { comp_max?: number | null; comp_min?: number | null; est_comp?: number | null }): {
  comp: number | null;
  source: 'posted' | 'estimated' | 'none';
} {
  if (job.comp_max && job.comp_max > 0) return { comp: job.comp_max, source: 'posted' };
  if (job.est_comp && job.est_comp > 0) return { comp: job.est_comp, source: 'estimated' };
  // A posted floor alone: assume a typical 20% spread above it.
  if (job.comp_min && job.comp_min > 0) return { comp: Math.round(job.comp_min * 1.2), source: 'posted' };
  return { comp: null, source: 'none' };
}

// ---------------------------------------------------------------------------
// Prospect scoring
// ---------------------------------------------------------------------------

/** Points, max 100. */
export const SCORE_WEIGHTS = {
  tier: { step_up: 40, lateral: 28, stretch: 18 } as Record<Tier, number>,
  distanceMax: 30,
  distanceFloor: 10, // at the edge of the max radius
  distanceUnknown: 15,
  size: { smaller: 15, peer: 10, unknown: 7, much_smaller: 5, bigger: 3 },
  roleExact: 10,
  roleRelated: 5,
  optedIn: 5,
} as const;

/** Prospect club revenue ÷ job club revenue → relative size. */
export const SIZE_RATIO = { muchSmaller: 0.3, peerLow: 0.9, peerHigh: 1.5 } as const;

export type SizeRel = keyof typeof SCORE_WEIGHTS.size;

export function sizeRelation(prospectRevenue: number | null | undefined, jobRevenue: number | null | undefined): SizeRel {
  if (!prospectRevenue || !jobRevenue || prospectRevenue <= 0 || jobRevenue <= 0) return 'unknown';
  const r = prospectRevenue / jobRevenue;
  if (r < SIZE_RATIO.muchSmaller) return 'much_smaller';
  if (r < SIZE_RATIO.peerLow) return 'smaller'; // stepping up from a smaller club: ideal
  if (r <= SIZE_RATIO.peerHigh) return 'peer';
  return 'bigger';
}

/** Does a prospect's current title match the job's level? */
export function roleMatch(title: string | null | undefined, roleLevel: string | null | undefined): 'exact' | 'related' {
  const t = (title || '').toLowerCase();
  const lvl = roleLevel || 'director';
  if (lvl === 'gm') return /general manager|\bgm\b|\bcoo\b|chief operating|club manager/.test(t) ? 'exact' : 'related';
  if (lvl === 'head_pro') return /head (tennis |golf )?pro|director/.test(t) ? 'exact' : 'related';
  if (lvl === 'assistant') return /assistant|associate|pro\b/.test(t) ? 'exact' : 'related';
  return /director|head/.test(t) ? 'exact' : 'related';
}

export type ProspectInput = {
  comp: number;
  distanceMiles: number | null;
  revenue: number | null;
  title: string | null;
  optedIn: boolean;
  /** Opted-in candidates: their own relocation radius and comp floor. */
  candidateRadius?: number | null;
  candidateMinComp?: number | null;
};

export type ProspectScore = {
  score: number;
  tier: Tier;
  size: SizeRel;
  role: 'exact' | 'related';
};

/**
 * Score one person against a job. Null = not a prospect for this job at all
 * (outside every comp band, beyond the radius, or beyond their own stated limits).
 */
export function scoreProspect(p: ProspectInput, bands: TargetBands, job: { revenue: number | null; roleLevel: string | null }): ProspectScore | null {
  const tier = tierFor(p.comp, bands);
  if (!tier) return null;
  if (p.optedIn && p.candidateMinComp && p.candidateMinComp > bands.targetComp) return null;

  let dist: number;
  if (p.distanceMiles == null) {
    dist = SCORE_WEIGHTS.distanceUnknown;
  } else {
    if (bands.maxRadiusMiles != null && p.distanceMiles > bands.maxRadiusMiles) return null;
    if (p.optedIn && p.candidateRadius != null && p.distanceMiles > p.candidateRadius) return null;
    if (p.distanceMiles <= bands.preferredMiles) dist = SCORE_WEIGHTS.distanceMax;
    else {
      // National searches decay over 1,500 miles.
      const edge = bands.maxRadiusMiles ?? 1500;
      const frac = Math.min(1, (p.distanceMiles - bands.preferredMiles) / Math.max(1, edge - bands.preferredMiles));
      dist = SCORE_WEIGHTS.distanceMax - frac * (SCORE_WEIGHTS.distanceMax - SCORE_WEIGHTS.distanceFloor);
    }
  }

  const size = sizeRelation(p.revenue, job.revenue);
  const role = roleMatch(p.title, job.roleLevel);
  const score =
    SCORE_WEIGHTS.tier[tier] +
    dist +
    SCORE_WEIGHTS.size[size] +
    (role === 'exact' ? SCORE_WEIGHTS.roleExact : SCORE_WEIGHTS.roleRelated) +
    (p.optedIn ? SCORE_WEIGHTS.optedIn : 0);
  return { score: Math.max(0, Math.min(100, Math.round(score))), tier, size, role };
}

const k = (n: number) => `$${Math.round(n / 1000)}k`;
const TIER_PHRASE: Record<Tier, string> = { step_up: 'a raise', lateral: 'a lateral move', stretch: 'a big step up' };
const SIZE_PHRASE: Record<SizeRel, string> = {
  smaller: 'stepping up from a smaller club',
  peer: 'similar-size club',
  bigger: 'currently at a bigger club',
  much_smaller: 'much smaller club today',
  unknown: '',
};

/** One-line why, e.g. "Earns $180k at Bethesda CC (72% of $250k: a raise), 12 mi away, stepping up from a smaller club." */
export function fitReason(p: { comp: number; club: string | null; distanceMiles: number | null; optedIn: boolean }, s: ProspectScore, bands: TargetBands): string {
  const pct = Math.round((p.comp / bands.targetComp) * 100);
  const where = p.club ? ` at ${p.club}` : '';
  const parts = [
    `${p.optedIn ? 'Open to work; earns' : 'Earns'} ${k(p.comp)}${where} (${pct}% of ${k(bands.targetComp)}: ${TIER_PHRASE[s.tier]})`,
    p.distanceMiles != null ? `${Math.round(p.distanceMiles)} mi away` : 'distance unknown',
  ];
  if (SIZE_PHRASE[s.size]) parts.push(SIZE_PHRASE[s.size]);
  return `${parts.join(', ')}.`;
}

// ---------------------------------------------------------------------------
// Evaluation freshness
// ---------------------------------------------------------------------------

export const EVALUATION_VERSION = 1;
export const EVALUATION_TTL_DAYS = 30;

/** Does this job need a (re-)evaluation? Re-run when stale, on a policy bump, or when the target comp changed. */
export function needsEvaluation(
  job: { evaluation?: { version?: number; target_comp?: number | null } | null; evaluated_at?: string | null; comp_max?: number | null; comp_min?: number | null; est_comp?: number | null },
  now: Date,
): boolean {
  if (!job.evaluation || !job.evaluated_at) return true;
  if (job.evaluation.version !== EVALUATION_VERSION) return true;
  const age = now.getTime() - new Date(job.evaluated_at).getTime();
  if (age > EVALUATION_TTL_DAYS * 86_400_000) return true;
  const t = targetCompFor(job).comp;
  if (t != null && (job.evaluation.target_comp ?? null) !== t) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Club pitch + weekly follow-ups
// ---------------------------------------------------------------------------

/** Darrin's standing rule: no "just checking in". Every touch is a fresh, bigger offer. */
export const MAX_TOUCHES = 3;
export const FOLLOW_UP_MIN_DAYS = 7;

/** Only confirmed interests open the door to a club. Ranked prospects are deliberately not an input. */
export function shouldPitchClub(confirmedInterested: number): boolean {
  return confirmedInterested >= MIN_CONFIRMED_FOR_PITCH;
}

/** Order we approach a club: GM, then the posting's hiring contact, then HR, then board / tennis chair. */
export const CONTACT_PRIORITY: Record<string, number> = {
  gm: 0,
  hiring_contact: 1,
  hr: 2,
  tennis_committee: 3,
  board: 4,
};

export type Offer = 'intro' | 'new_candidates' | 'comp_memo';

export type FollowUpInput = {
  touchesSoFar: number;
  lastContactedAt: string | null;
  now: Date;
  doNotContact: boolean;
  replied: boolean;
  jobOpen: boolean; // active, not claimed, not expired
  /** Confirmed interests right now. Zero means no touch at all. */
  confirmedInterested: number;
  /** NEW confirmed interests since the last touch to this contact (never prospect counts). */
  newConfirmedSinceLast: number;
  /** We can build a comp memo from the club's own 990. */
  hasMemo: boolean;
  /** Offers already used on this contact. */
  usedOffers: Offer[];
};

export type FollowUpPlan =
  | { eligible: true; touch: number; offers: Offer[] }
  | { eligible: false; reason: string };

/**
 * May we send the next club touch, and what new thing does it offer? A follow-up
 * with nothing new is never sent: the only "bigger offers" are new confirmed
 * interests or the free comp memo from the club's own 990.
 */
export function planClubTouch(i: FollowUpInput): FollowUpPlan {
  if (i.doNotContact) return { eligible: false, reason: 'do not contact' };
  if (i.replied) return { eligible: false, reason: 'replied' };
  if (!i.jobOpen) return { eligible: false, reason: 'job closed, claimed or expired' };
  if (!shouldPitchClub(i.confirmedInterested)) return { eligible: false, reason: 'no confirmed interested candidates' };
  if (i.touchesSoFar >= MAX_TOUCHES) return { eligible: false, reason: `max ${MAX_TOUCHES} touches` };
  const touch = i.touchesSoFar + 1;
  if (touch === 1) return { eligible: true, touch, offers: ['intro'] };
  if (i.lastContactedAt) {
    const days = (i.now.getTime() - new Date(i.lastContactedAt).getTime()) / 86_400_000;
    if (days < FOLLOW_UP_MIN_DAYS) return { eligible: false, reason: `last touch ${Math.floor(days)}d ago (< ${FOLLOW_UP_MIN_DAYS})` };
  }
  const offers: Offer[] = [];
  if (i.newConfirmedSinceLast > 0) offers.push('new_candidates');
  if (i.hasMemo && !i.usedOffers.includes('comp_memo')) offers.push('comp_memo');
  if (!offers.length) return { eligible: false, reason: 'nothing new to offer (no reminder emails)' };
  return { eligible: true, touch, offers };
}

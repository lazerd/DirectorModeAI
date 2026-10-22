/**
 * ClubMode Recruiting — "pay only when you hire".
 *
 * The rules every recruiting route shares: the flat placement fee, the terms a
 * club accepts when it posts an opening, and which pipeline moves are allowed.
 * Pure (no DB) so it can be unit tested.
 */

export const PLACEMENT_FEE_USD = 4950;
export const PLACEMENT_FEE_CENTS = PLACEMENT_FEE_USD * 100;
export const PLACEMENT_TERMS_VERSION = '2026-10-22';
/** A hire counts toward the fee if it happens within this many months of the introduction. */
export const ATTRIBUTION_MONTHS = 12;
/** If the hire leaves within this many days of starting, we run one replacement search free. */
export const GUARANTEE_DAYS = 90;

/** Plain-language terms shown (and accepted) when a club posts an opening. */
export const PLACEMENT_TERMS: string[] = [
  `No retainer and no fee to post, search or interview. You pay a flat $${PLACEMENT_FEE_USD.toLocaleString()} only when you hire a candidate ClubMode introduced.`,
  'A candidate is "introduced" when they apply to your opening through ClubMode, with their consent, or when we send you their application.',
  `The fee applies if you hire an introduced candidate into any role within ${ATTRIBUTION_MONTHS} months of the introduction. It is due on their start date.`,
  'No fee for a candidate you can show was already in your process (applied or interviewed) before we introduced them.',
  `If the hire leaves within ${GUARANTEE_DAYS} days of starting, we run one replacement search at no charge.`,
  'You make every hiring decision. ClubMode finds, screens and introduces candidates; you interview, choose and employ.',
];

export const STAGES = [
  'invited',
  'applied',
  'screening',
  'interviewing',
  'offer',
  'hired',
  'declined',
  'withdrawn',
] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  invited: 'Invited',
  applied: 'Applied',
  screening: 'Screening',
  interviewing: 'Interviewing',
  offer: 'Offer',
  hired: 'Hired',
  declined: 'Not moving forward',
  withdrawn: 'Withdrew',
};

/** Stages a club can see. An invited candidate hasn't consented, so the club never sees them. */
export const CLUB_VISIBLE_STAGES: Stage[] = ['applied', 'screening', 'interviewing', 'offer', 'hired', 'declined', 'withdrawn'];

const CLUB_MOVES: Record<Stage, Stage[]> = {
  invited: [],
  applied: ['screening', 'interviewing', 'offer', 'hired', 'declined'],
  screening: ['interviewing', 'offer', 'hired', 'declined'],
  interviewing: ['screening', 'offer', 'hired', 'declined'],
  offer: ['interviewing', 'hired', 'declined'],
  hired: [],
  declined: ['screening', 'interviewing'],
  withdrawn: [],
};

export function isStage(s: unknown): s is Stage {
  return typeof s === 'string' && (STAGES as readonly string[]).includes(s);
}

/** Can the club move an application from `from` to `to`? */
export function clubCanMove(from: Stage, to: Stage): boolean {
  return CLUB_MOVES[from]?.includes(to) ?? false;
}

/** Can the candidate move their own application? They can apply to an invite or withdraw before hire. */
export function candidateCanMove(from: Stage, to: Stage): boolean {
  if (to === 'applied') return from === 'invited';
  if (to === 'withdrawn') return !['hired', 'withdrawn'].includes(from);
  return false;
}

/** Is a hire on `hiredAt` inside the attribution window that started at `introducedAt`? */
export function withinAttribution(introducedAt: Date, hiredAt: Date): boolean {
  const end = new Date(introducedAt);
  end.setMonth(end.getMonth() + ATTRIBUTION_MONTHS);
  return hiredAt >= introducedAt && hiredAt <= end;
}

/** Last day of the replacement guarantee for a hire starting on `startDate` (YYYY-MM-DD). */
export function guaranteeUntil(startDate: string): string {
  const d = new Date(`${startDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + GUARANTEE_DAYS);
  return d.toISOString().slice(0, 10);
}

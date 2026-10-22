/**
 * Which jobs the $4,950 placement fee (and a club pitch) applies to. Pure, so the
 * job board, the claim page and the recruiter all use the same answer.
 *
 * In scope: director-level leadership. Director of Tennis / Racquets / Pickleball
 * / Golf and equivalent department heads ("Head of Racquets", GM / COO), plus a
 * Head Pro who leads the program ("Head Tennis Professional").
 *
 * Out of scope ("Job board only"): assistant / associate roles, teaching and staff
 * pros, instructors, coaches (including "Head Coach"), junior / youth program
 * leads, coordinators and anything else that isn't running the department. These
 * stay on the public board because they bring candidates into the network, but
 * they are never pitched to a club and never claimable for the fee.
 *
 * The title decides when it is clear; the scout's role_level is the fallback.
 * With neither (a club-posted opening with no title: the posting form only offers
 * director-level departments) the job is in scope.
 */

export const JOB_BOARD_ONLY_LABEL = 'Job board only';
export const JOB_BOARD_ONLY_HINT = 'Apply directly on the club’s posting. ClubMode doesn’t present candidates for this role.';

/** Qualifiers that make even a "director" title a non-head role. */
const SUBORDINATE = /\b(assistant|asst|associate|deputy|junior|jr|youth|kids|camp|interim assistant)\b/;
/** Titles that run the department. */
const LEADER = /\b(director|head of|general manager|gm|coo|chief operating)\b/;
/** "Head Pro", "Head Tennis Professional", "Head Racquets Pro", "Head Pickleball Professional". */
const HEAD_PRO = /\bhead\s+(?:(?:tennis|racquets?|racquet sports?|pickleball|padel|paddle|platform tennis|squash|golf)\s+)?(?:pro|professional)\b/;
/** Ordinary coaching / teaching / staff titles. ("Racquets Manager" is ambiguous: falls through to role_level.) */
const STAFF = /\b(pro|professional|coach|coaching|instructor|teaching|teacher|staff|coordinator|stringer|attendant|desk|intern|apprentice|seasonal|part[- ]time)\b/;

const ELIGIBLE_LEVELS = new Set(['director', 'head_pro', 'gm']);

export function feeEligible(roleLevel: string | null | undefined, title: string | null | undefined): boolean {
  const t = (title || '').toLowerCase().replace(/[^a-z0-9/&\s-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (t) {
    if (SUBORDINATE.test(t)) return false;
    if (LEADER.test(t)) return true;
    if (HEAD_PRO.test(t)) return true;
    if (STAFF.test(t)) return false;
  }
  if (!roleLevel) return true;
  return ELIGIBLE_LEVELS.has(roleLevel);
}

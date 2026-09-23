/**
 * The pipeline, in order — the one place stages are named.
 *
 * Pages, API validation and the migration's CHECK all derive from this list.
 * Scattering the strings is how a board ends up with a column nothing can ever
 * land in, so nothing below should be duplicated as a literal anywhere else.
 */

export const STAGES = [
  'researching',
  'contacted',
  'meeting_set',
  'demo_done',
  'pilot',
  'proposal',
  'won',
  'lost',
] as const;

export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  researching: 'Researching',
  contacted: 'Contacted',
  meeting_set: 'Meeting set',
  demo_done: 'Demo done',
  pilot: 'Pilot',
  proposal: 'Proposal',
  won: 'Won',
  lost: 'Lost',
};

/**
 * Won and lost are closed: they leave the pipeline total, and their cards stop
 * nagging about an overdue next step. Everything before them is open.
 */
export const CLOSED_STAGES: Stage[] = ['won', 'lost'];
export const OPEN_STAGES: Stage[] = STAGES.filter((s) => !CLOSED_STAGES.includes(s));

export function isStage(v: unknown): v is Stage {
  return typeof v === 'string' && (STAGES as readonly string[]).includes(v);
}

/** List price, in cents, when a deal carries no target of its own. */
export const DEFAULT_MRR_TARGET_CENTS = 7500;

export const ACTIVITY_KINDS = [
  'note',
  'call',
  'email',
  'reply',
  'meeting',
  'demo',
  'proposal',
  'stage_change',
] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  note: 'Note',
  call: 'Call',
  email: 'Email',
  reply: 'Reply',
  meeting: 'Meeting',
  demo: 'Demo',
  proposal: 'Proposal',
  stage_change: 'Stage change',
};

export function isActivityKind(v: unknown): v is ActivityKind {
  return typeof v === 'string' && (ACTIVITY_KINDS as readonly string[]).includes(v);
}

export const ORG_TYPES = ['club', 'community', 'facility'] as const;
export type OrgType = (typeof ORG_TYPES)[number];

export function isOrgType(v: unknown): v is OrgType {
  return typeof v === 'string' && (ORG_TYPES as readonly string[]).includes(v);
}

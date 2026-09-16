/**
 * Row shapes for the outreach deck. Mirrors supabase/migrations/crm_outreach.sql.
 */

import type { ISODate } from '@/lib/crm/dates';

export type OutreachStatus = 'planned' | 'approved' | 'sent' | 'rejected' | 'snoozed' | 'failed';
export type OutreachKind = 'intro' | 'followup';
export type SuppressReason = 'bounced' | 'complaint' | 'no thanks' | 'swiped left' | 'manual';

export interface QueueRow {
  id: string;
  org_id: string;
  contact_id: string | null;
  rep_email: string;
  send_date: ISODate;
  subject: string;
  body: string;
  why: string | null;
  status: OutreachStatus;
  kind: OutreachKind;
  follow_up_of: string | null;
  generated_by: 'model' | 'template';
  approved_at: string | null;
  sent_at: string | null;
  resend_id: string | null;
  reject_reason: string | null;
  detail: string | null;
  dedupe_key: string;
  created_at: string;
  updated_at: string;
}

export const QUEUE_COLS =
  'id, org_id, contact_id, rep_email, send_date, subject, body, why, status, kind, ' +
  'follow_up_of, generated_by, approved_at, sent_at, resend_id, reject_reason, detail, ' +
  'dedupe_key, created_at, updated_at';

/**
 * The regions the DCA directory uses, plus the bucket everything else lands
 * in. Ordered here rather than sorted at the call site — this array IS the
 * send order, and reading it top to bottom should explain the warmup plan.
 */
export const REGIONS = ['West', 'Central', 'East', 'International'] as const;
export type Region = (typeof REGIONS)[number];

export interface OutreachSettings {
  daily_cap: number;
  send_window_start: string; // HH:MM:SS
  send_window_end: string;
  paused: boolean;
  warmup_start_date: ISODate | null;
  warmup_steps: { days: number; cap: number }[];
  follow_up_days: number;
}

/** What the deck draws for one card. */
export interface DeckCard {
  queue_id: string;
  org_id: string;
  org_name: string;
  org_region: string | null;
  org_website: string | null;
  org_city: string | null;
  org_state: string | null;
  contact_id: string | null;
  contact_name: string;
  contact_email: string;
  contact_title: string | null;
  other_contacts: number;
  kind: OutreachKind;
  subject: string;
  body: string;
  why: string;
  generated_by: 'model' | 'template';
  /** The whole message as the recipient reads it, signature included. */
  preview: string;
  /** Non-empty means this card cannot be approved. */
  blocks: string[];
}

/**
 * Row shapes for the CRM. Mirrors supabase/migrations/crm.sql.
 */

import type { ActivityKind, OrgType, Stage } from './stages';
import type { ISODate } from './dates';

export interface Org {
  id: string;
  name: string;
  slug: string;
  club_id: string | null;
  website: string | null;
  city: string | null;
  state: string | null;
  type: OrgType;
  member_count: number | null;
  stage: Stage;
  owner_email: string | null;
  mrr_target_cents: number;
  source: string | null;
  /**
   * "East" / "Central" / "West" / "International" for the DCA roster, null for
   * everything else. See lib/crm/region.ts — it used to live in `notes`.
   */
  region: string | null;
  /**
   * When a rep put this club in the outreach queue, or null.
   *
   * Written by the cold list's one bulk action and read by the outreach deck
   * (/crm/deck). A flag rather than a join table because it is one fact per
   * club and un-queueing must be as cheap as queueing.
   */
  queued_at: string | null;
  next_step: string | null;
  next_step_at: ISODate | null;
  demo_url: string | null;
  notes: string | null;
  won_at: string | null;
  lost_at: string | null;
  lost_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  org_id: string;
  full_name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  is_primary: boolean;
  do_not_contact: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Activity {
  id: string;
  org_id: string;
  contact_id: string | null;
  kind: ActivityKind;
  body: string;
  occurred_at: string;
  created_by_email: string | null;
  created_at: string;
}

/** An org as the pipeline draws it: the row plus the facts a card shows. */
export interface OrgCard extends Org {
  last_activity_at: string | null;
  /**
   * The newest activity's kind and body, so Today can tell "they replied and
   * nobody did anything about it" from "we sent a demo". Null when nothing has
   * ever been logged.
   */
  last_activity_kind: ActivityKind | null;
  last_activity_body: string | null;
  contact_count: number;
}

/**
 * A cold club as the list draws it.
 *
 * Deliberately NOT an Org. There are 519 of these and they are all sent to the
 * browser at once so search and filtering are instant; shipping `notes` with
 * each one is a quarter of a megabyte of paragraphs nothing on that screen
 * renders. This is every column the table, the filters and the sort actually
 * read, and nothing else.
 */
export interface ColdRow {
  id: string;
  name: string;
  region: string | null;
  state: string | null;
  stage: Stage;
  contact_count: number;
  /** The first contact's name and email, for the search box to match on. */
  contact_names: string;
  last_activity_at: string | null;
  queued_at: string | null;
}

export const ORG_COLS =
  'id, name, slug, club_id, website, city, state, type, member_count, stage, owner_email, ' +
  'mrr_target_cents, source, region, queued_at, next_step, next_step_at, demo_url, notes, ' +
  'won_at, lost_at, lost_reason, created_at, updated_at';

export const CONTACT_COLS =
  'id, org_id, full_name, title, email, phone, role, is_primary, do_not_contact, notes, created_at, updated_at';

export const ACTIVITY_COLS =
  'id, org_id, contact_id, kind, body, occurred_at, created_by_email, created_at';

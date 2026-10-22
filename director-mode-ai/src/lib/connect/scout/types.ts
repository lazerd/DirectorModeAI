/** Scout — shared types. */

/** One posting found on a source's list page / feed. */
export type ListItem = {
  source: string;
  /** The original posting (what we link to). */
  url: string;
  externalId?: string | null;
  title: string;
  club?: string | null;
  location?: string | null;
  postedAt?: string | null; // YYYY-MM-DD
  deadline?: string | null; // YYYY-MM-DD
  /** Posting body if the feed already carries it (saves a detail fetch). Used for extraction only, never stored. */
  text?: string | null;
  /** True when only the list row is public (detail page is blocked) — build the job from row facts, no model call. */
  listingOnly?: boolean;
};

export type SourceAdapter = {
  id: string;
  label: string;
  /** Public page a human would browse. */
  homeUrl: string;
  /** Max postings to process per run. */
  cap: number;
  list: () => Promise<{ items: ListItem[]; errors: string[] }>;
};

export type RoleLevel = 'director' | 'head_pro' | 'assistant' | 'gm' | 'other';

/** What the extractor returns (our words + facts; never the poster's full text). */
export type ExtractedJob = {
  keep: boolean;
  reject_reason: string | null;
  club_name: string | null;
  title: string | null;
  role_level: RoleLevel;
  city: string | null;
  state: string | null;
  zip: string | null;
  comp_min: number | null;
  comp_max: number | null;
  comp_text: string | null;
  requirements: string[];
  summary: string | null;
  apply_url: string | null;
  apply_email: string | null;
  contact_name: string | null;
  club_website: string | null;
  posted_at: string | null;
  deadline: string | null;
};

/** A row ready for connect_sourced_jobs. */
export type SourcedJobRow = {
  source: string;
  source_url: string;
  external_id: string | null;
  fingerprint: string;
  club_name: string | null;
  title: string | null;
  dept: string;
  role_level: RoleLevel;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  comp_min: number | null;
  comp_max: number | null;
  comp_text: string | null;
  summary: string | null;
  requirements: string | null;
  apply_url: string | null;
  apply_email: string | null;
  contact_name: string | null;
  posted_at: string | null;
  deadline: string | null;
  club_ein: string | null;
  club_revenue: number | null;
  est_comp: number | null;
};

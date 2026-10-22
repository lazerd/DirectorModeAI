/** Source id → display name. Pure so client pages can import it. */
export const SOURCE_LABEL: Record<string, string> = {
  rspa: 'RSPA Career Center',
  ptr: 'PTR Job Bulletin',
  kkandw: 'Kopplin, Kuebler & Wallace',
  mycoachingtree: 'MyCoachingTree',
  hospitalityonline: 'Hospitality Online',
};

export const sourceLabel = (id: string | null | undefined) => (id && SOURCE_LABEL[id]) || 'a public job board';

/**
 * Columns of connect_sourced_jobs that public endpoints may return: facts, our
 * own summary and the link to the original. Never contacts, apply emails,
 * 990 matches, the evaluator's notes or the linked opening.
 */
export const SOURCED_PUBLIC_COLS =
  'id, source, source_url, club_name, title, dept, role_level, city, state, comp_min, comp_max, comp_text, est_comp, summary, requirements, apply_url, posted_at, deadline, first_seen_at';

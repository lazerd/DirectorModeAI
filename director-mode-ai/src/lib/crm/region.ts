/**
 * The region a cold club sits in.
 *
 * The Directors Club of America divides its roster into four regions, and
 * scripts/import-dca.mjs originally recorded that only in the first sentence
 * of crm_orgs.notes: "DCA East region. From the members-only directory…".
 *
 * crm_orgs.region is now the column the app reads (supabase/migrations/
 * crm_region.sql). This file is the other half of that move: the same pattern,
 * in TypeScript, used to backfill a row whose column is still null and to
 * check that the migration and the app agree about what "East" means.
 *
 * The notes sentence is deliberately left in place. It reads well on the org
 * page, it says where the club came from and when, and deleting prose to
 * avoid duplicating a five-letter word would be the wrong trade.
 */

/**
 * The four the DCA actually uses. Not an enum on the column: a rep typing
 * "Pacific Northwest" into a region field should get "Pacific Northwest", not
 * a constraint violation. This list is what the filter chips are built from,
 * plus whatever else turns up in the data.
 */
export const DCA_REGIONS = ['East', 'Central', 'West', 'International'] as const;
export type DcaRegion = (typeof DCA_REGIONS)[number];

/**
 * Pull "East" out of "DCA East region. From the members-only directory…".
 *
 * Returns null for anything else, including the 117 clubs whose note says
 * "DCA member club (region not recorded)." — those have no region, and
 * guessing one from the state would put a club in a bucket a rep would then
 * trust. Title-cased so a stray "DCA east region." and the migration's
 * initcap() land on the same string.
 */
export function regionFromNotes(notes: string | null | undefined): string | null {
  const m = /DCA ([A-Za-z]+) region\./.exec(notes ?? '');
  if (!m) return null;
  const word = m[1];
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * The region to display, preferring the column and falling back to the prose.
 *
 * The fallback is not dead code: a row inserted between this deploy and the
 * next run of the migration has a note and no column, and a cold list that
 * showed it as region-less would quietly under-count "East".
 */
export function regionOf(org: { region?: string | null; notes?: string | null }): string | null {
  const explicit = (org.region ?? '').trim();
  if (explicit) return explicit;
  return regionFromNotes(org.notes);
}

/**
 * Every region present in a set of clubs, in DCA order with anything unexpected
 * appended alphabetically. Drives the filter dropdown, so it never offers a
 * region that would return nothing.
 */
export function regionsPresent(orgs: { region?: string | null; notes?: string | null }[]): string[] {
  const seen = new Set<string>();
  for (const o of orgs) {
    const r = regionOf(o);
    if (r) seen.add(r);
  }
  const known = DCA_REGIONS.filter((r) => seen.has(r));
  const rest = [...seen].filter((r) => !(DCA_REGIONS as readonly string[]).includes(r)).sort();
  return [...known, ...rest];
}

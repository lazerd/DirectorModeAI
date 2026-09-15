/**
 * Which website builder a club is on today, from its own links.
 *
 * The tour says "replaces your old Wild Apricot pages" only when the club's
 * links actually point at Wild Apricot. Product names, not club facts: the
 * club's rows decide which one (if any) applies.
 */

const SITE_BUILDERS: [RegExp, string][] = [
  [/(^|\.)wildapricot\.(org|com)$/i, 'Wild Apricot'],
  [/(^|\.)squarespace\.com$/i, 'Squarespace'],
  [/(^|\.)wixsite\.com$|(^|\.)wix\.com$/i, 'Wix'],
  [/(^|\.)weebly\.com$/i, 'Weebly'],
  [/(^|\.)clubexpress\.com$/i, 'ClubExpress'],
  [/(^|\.)godaddysites\.com$/i, 'GoDaddy'],
];

export function siteBuilderFrom(urls: (string | null | undefined)[]): string | null {
  for (const raw of urls) {
    if (!raw) continue;
    let host: string;
    try {
      host = new URL(raw).hostname;
    } catch {
      continue;
    }
    const hit = SITE_BUILDERS.find(([re]) => re.test(host));
    if (hit) return hit[1];
  }
  return null;
}

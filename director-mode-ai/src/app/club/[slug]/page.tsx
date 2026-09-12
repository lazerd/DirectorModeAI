import { permanentRedirect } from 'next/navigation';

/**
 * The old club microsite lived here. It now lives at /c/[slug].
 *
 * Kept as a redirect rather than deleted: this URL was handed out by the
 * "copy your public page link" button on /courtconnect/club, so it is sitting
 * in directors' emails and texts. A 308 also consolidates whatever search
 * ranking it had onto the new page.
 *
 * Moved because the old page was client-rendered (invisible to crawlers, a
 * spinner on first paint) and queried the dead legacy cc_events table, so real
 * club programming never appeared on it — and because this path collides with
 * the director surfaces /club/members and /club/people, where a club whose
 * slug was "members" would have shadowed a real page.
 */
export default async function LegacyClubPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  permanentRedirect(`/c/${slug}`);
}

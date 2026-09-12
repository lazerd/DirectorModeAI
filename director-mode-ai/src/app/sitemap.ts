import type { MetadataRoute } from 'next';
import { absoluteUrl } from '@/lib/appUrl';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

/**
 * /sitemap.xml — the public marketing pages, plus every published club site.
 *
 * Tokenized player links and director tools are deliberately absent: the first
 * are private by URL, the second sit behind a login.
 *
 * Club sites ARE listed, because a club's own website being findable is half of
 * what it is for. Only published sites at public clubs, and only published
 * programs — a draft is a club still writing, and putting it in a sitemap
 * invites Google to index a half-finished page.
 */
const PAGES: { path: string; priority: number }[] = [
  { path: '/', priority: 1 },
  { path: '/pricing', priority: 0.9 },
  { path: '/captainmode', priority: 0.8 },
  { path: '/find-coach', priority: 0.5 },
  { path: '/register', priority: 0.5 },
  { path: '/login', priority: 0.3 },
  { path: '/terms', priority: 0.2 },
  { path: '/privacy', priority: 0.2 },
];

type ClubRow = { id: string; slug: string };
type ProgramRow = { club_id: string; slug: string; updated_at: string | null };

/**
 * Never let a database hiccup take the sitemap down with it. A 500 here tells
 * Google the whole site has no sitemap; an empty club list just means the
 * marketing pages are all it sees this crawl.
 */
async function clubEntries(): Promise<MetadataRoute.Sitemap> {
  try {
    const db = getSupabaseAdmin();
    const { data: siteRows } = await db
      .from('club_site')
      .select('club_id, updated_at')
      .eq('status', 'published')
      .limit(500);

    const siteIds = ((siteRows as { club_id: string; updated_at: string | null }[] | null) ?? []).map(
      (r) => r.club_id,
    );
    if (siteIds.length === 0) return [];

    const updatedByClub = new Map(
      ((siteRows as { club_id: string; updated_at: string | null }[] | null) ?? []).map((r) => [
        r.club_id,
        r.updated_at,
      ]),
    );

    const [{ data: clubRows }, { data: programRows }] = await Promise.all([
      db.from('cc_clubs').select('id, slug').in('id', siteIds).eq('is_public', true),
      db
        .from('club_programs')
        .select('club_id, slug, updated_at')
        .in('club_id', siteIds)
        .eq('status', 'published')
        .limit(2000),
    ]);

    const clubs = (clubRows as ClubRow[] | null) ?? [];
    const slugById = new Map(clubs.map((c) => [c.id, c.slug]));

    const entries: MetadataRoute.Sitemap = clubs.flatMap((c) => [
      {
        url: absoluteUrl(`/c/${c.slug}`),
        changeFrequency: 'weekly' as const,
        priority: 0.7,
        lastModified: updatedByClub.get(c.id) ?? undefined,
      },
      {
        url: absoluteUrl(`/c/${c.slug}/programs`),
        changeFrequency: 'weekly' as const,
        priority: 0.6,
      },
    ]);

    for (const p of (programRows as ProgramRow[] | null) ?? []) {
      const clubSlug = slugById.get(p.club_id);
      // A program whose club is not public must not leak in through this join.
      if (!clubSlug) continue;
      entries.push({
        url: absoluteUrl(`/c/${clubSlug}/programs/${p.slug}`),
        changeFrequency: 'weekly',
        priority: 0.5,
        lastModified: p.updated_at ?? undefined,
      });
    }

    return entries;
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const statics: MetadataRoute.Sitemap = PAGES.map(({ path, priority }) => ({
    url: absoluteUrl(path),
    changeFrequency: 'weekly',
    priority,
  }));
  return [...statics, ...(await clubEntries())];
}

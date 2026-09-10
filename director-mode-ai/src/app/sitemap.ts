import type { MetadataRoute } from 'next';
import { absoluteUrl } from '@/lib/appUrl';

/**
 * /sitemap.xml — the public marketing pages only. Tokenized player links and
 * director tools are deliberately absent: the first are private by URL, the
 * second sit behind a login.
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

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map(({ path, priority }) => ({
    url: absoluteUrl(path),
    changeFrequency: 'weekly',
    priority,
  }));
}

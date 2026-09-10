import type { MetadataRoute } from 'next';
import { APP_URL } from '@/lib/appUrl';

/** /robots.txt — crawl the public site, stay out of the API and admin. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/admin'] },
    sitemap: `${APP_URL}/sitemap.xml`,
  };
}

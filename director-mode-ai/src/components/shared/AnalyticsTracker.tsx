'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { trackEvent, getProductFromPath } from '@/lib/analytics';

const EXCLUDED_PATHS = ['/admin'];

function isExcluded(path: string): boolean {
  return EXCLUDED_PATHS.some((p) => path.startsWith(p));
}

export default function AnalyticsTracker() {
  const pathname = usePathname();
  const mountTime = useRef(Date.now());
  const lastPathname = useRef<string | null>(null);

  // Session start on mount
  useEffect(() => {
    if (isExcluded(window.location.pathname)) return;

    mountTime.current = Date.now();
    trackEvent('session_start', 'session_start', null, {
      referrer: document.referrer || null,
      screen_width: window.innerWidth,
      screen_height: window.innerHeight,
    });

    const handleBeforeUnload = () => {
      if (isExcluded(window.location.pathname)) return;
      const durationMs = Date.now() - mountTime.current;
      trackEvent('session_end', 'session_end', null, { duration_ms: durationMs });
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Page view on route change
  useEffect(() => {
    if (pathname && pathname !== lastPathname.current) {
      lastPathname.current = pathname;
      if (!isExcluded(pathname)) {
        trackEvent('page_view', pathname, getProductFromPath(pathname));
      }
    }
  }, [pathname]);

  return null;
}

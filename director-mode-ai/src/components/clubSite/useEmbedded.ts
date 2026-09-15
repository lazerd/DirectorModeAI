'use client';

import { useEffect, useState } from 'react';
import { isEmbedParam } from '@/lib/clubSite/embed';

/**
 * Is this page embedded in a club's website (`?embed=1`)?
 *
 * Read from the address after mount rather than useSearchParams, which would
 * demand a Suspense boundary around every client component that asks. False
 * for the first paint, which is the right way round: the only things this
 * changes are wording ("opens in a new window") and cross-sells hidden inside
 * someone else's site, never whether something works.
 */
export function useEmbedded(): boolean {
  const [embedded, setEmbedded] = useState(false);
  useEffect(() => {
    setEmbedded(isEmbedParam(new URLSearchParams(window.location.search).get('embed')));
  }, []);
  return embedded;
}

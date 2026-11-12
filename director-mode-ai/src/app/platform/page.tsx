import type { Metadata } from 'next';
import PlatformHome from '@/components/home/PlatformHome';

/**
 * /platform — the full ClubMode homepage (every tool), reachable signed out.
 * Signed-in users already get this at "/". Signed-out visitors get the simple
 * three-door page there instead, and this is where "See everything" points.
 */
export const metadata: Metadata = {
  title: 'Everything in ClubMode',
  alternates: { canonical: '/platform' },
};

export default function PlatformPage() {
  return <PlatformHome />;
}

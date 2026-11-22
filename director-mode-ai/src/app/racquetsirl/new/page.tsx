import type { Metadata } from 'next';
import Landing from '@/components/play/landing/Landing';

/**
 * The redesigned Racquets IRL landing page, side by side with the live one (/racquetsirl)
 * so it can be compared on the real site (Darrin, 11/22/26). Kept out of search until it's
 * chosen. To make it the front door, render <Landing /> in app/racquetsirl/page.tsx and
 * app/(home)/page.tsx, then delete this route.
 */
const title = 'Racquets IRL: More playing. Less planning.';
const description = 'Create a tennis, pickleball or padel game, fill it with one link, and let Racquets IRL run the courts, partners and scores. No app, no login. First game free.';

export const metadata: Metadata = {
  title, description,
  alternates: { canonical: '/racquetsirl' },
  robots: { index: false, follow: true },
  openGraph: { title, description, url: '/racquetsirl/new' },
};

export default function RacquetsIRLNewPage() {
  return <Landing />;
}

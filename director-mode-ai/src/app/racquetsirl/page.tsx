import type { Metadata } from 'next';
import Landing from '@/components/play/landing/Landing';

/** The Racquets IRL front door (Kevin + Darrin, 11/23/26): the redesigned landing page, also
 *  served on signed-out clubmode.ai/ and reached from /play. The old self-running tour lives on at /play/demo. */
const title = 'Racquets IRL: More playing. Less planning.';
const description = 'Create a tennis, pickleball or padel game, fill it with one link, and let Racquets IRL run the courts, partners and scores. No app, no login. Free at launch.';

export const metadata: Metadata = {
  title, description,
  alternates: { canonical: 'https://racquetsirl.com' },
  openGraph: { title, description, url: 'https://racquetsirl.com' },
};

export default function RacquetsIRLPage() {
  return <Landing />;
}

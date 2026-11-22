import type { Metadata } from 'next';
import Landing from '@/components/play/landing/Landing';

const title = 'Racquets IRL: Racquet Sports. Together. In Real Life.';
const description = 'More playing. Less planning. Create a tennis, pickleball or padel game, fill it with one link, and let Racquets IRL run the courts, partners and scores. No app, no login. First game free.';

export const metadata: Metadata = {
  title, description,
  alternates: { canonical: '/' },
  openGraph: { title, description, url: '/racquetsirl' },
};

export default function RacquetsIRLPage() {
  return <Landing />;
}

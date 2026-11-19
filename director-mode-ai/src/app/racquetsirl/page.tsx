import type { Metadata } from 'next';
import DemoTour from '@/components/play/DemoTour';

const title = 'RacquetsIRL: Racquet Sports. Together. In Real Life.';
const description = 'Watch a Friday night run itself. Tennis, pickleball, padel. One sentence. One link. Everybody plays. No app, no account.';

export const metadata: Metadata = {
  title, description,
  alternates: { canonical: '/racquetsirl' },
  openGraph: { title, description, url: '/racquetsirl' },
};

export default function RacquetsIRLPage() {
  return <DemoTour />;
}

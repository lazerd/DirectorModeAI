import type { Metadata } from 'next';
import DemoTour from '@/components/play/DemoTour';

const title = 'RacquetsAIRL: watch a Friday night run itself';
const description = 'Tennis, pickleball, padel. One sentence. One link. Everybody plays. No app, no account.';

export const metadata: Metadata = {
  title, description,
  alternates: { canonical: '/racquetsairl' },
  openGraph: { title, description, url: '/racquetsairl' },
};

export default function RacquetsAIRLPage() {
  return <DemoTour />;
}

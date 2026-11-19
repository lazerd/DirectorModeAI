import type { Metadata } from 'next';
import DemoTour from '@/components/play/DemoTour';

/** TennisIRL's front door: the self-running demo. /play/demo serves the same thing. */
export const metadata: Metadata = {
  title: 'TennisIRL: watch a Friday night run itself',
  description: 'One sentence, one link, every phone on the right court, and a recap people share. Watch the real app run a whole tennis night on three phones.',
  alternates: { canonical: '/tennisirl' },
  openGraph: { title: 'TennisIRL: watch a Friday night run itself', description: 'One sentence. One link. Everybody plays. No app, no account.', url: '/tennisirl' },
};

export default function TennisIRLPage() {
  return <DemoTour />;
}

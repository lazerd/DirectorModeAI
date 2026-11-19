import type { Metadata } from 'next';
import DemoTour from '@/components/play/DemoTour';

export const metadata: Metadata = {
  title: 'TennisIRL live demo: watch a Friday night run itself',
  description: 'One sentence, one link, every phone on the right court, and a recap people share. Watch the real app run a whole tennis night on three phones.',
  alternates: { canonical: '/play/demo' },
  openGraph: { title: 'Watch a Friday night run itself', description: 'One sentence. One link. Everybody plays. The real app, running a whole night on three phones.' },
};

export default function DemoPage() {
  return <DemoTour />;
}

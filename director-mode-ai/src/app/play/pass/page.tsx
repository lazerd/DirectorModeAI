import type { Metadata } from 'next';
import PassClient from '@/components/play/PassClient';

export const metadata: Metadata = { title: 'Racquets IRL · Hosting pass', robots: { index: false, follow: false } };

export default function PassPage() {
  return <PassClient />;
}

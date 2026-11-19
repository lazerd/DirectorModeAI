import type { Metadata } from 'next';
import NearClient from '@/components/play/NearClient';

export const metadata: Metadata = {
  title: 'Games near me: tennis, pickleball, padel',
  description: 'Open games near you that need a player, at your level. Tap in. No app, no account.',
  alternates: { canonical: '/play/near' },
};

export default function NearPage() {
  return <NearClient />;
}

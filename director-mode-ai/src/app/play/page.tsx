import type { Metadata } from 'next';
import HostClient from '@/components/play/HostClient';

export const metadata: Metadata = {
  title: 'Pickleball mixer, tennis round robin & padel social organizer, free | Racquets IRL',
  description: 'Set up a pickleball mixer, tennis round robin or padel social in under 60 seconds. One link for the group chat fills it, assigns courts, rotates partners and posts a recap. Free, no signup, no app.',
  keywords: ['pickleball mixer', 'tennis round robin', 'round robin generator', 'pickleball round robin', 'padel social', 'tennis mixer', 'doubles rotation', 'court assignments'],
  alternates: { canonical: '/play' },
};

export default function PlayPage({ searchParams }: { searchParams: { q?: string; club?: string; resume?: string } }) {
  const q = typeof searchParams.q === 'string' ? searchParams.q.slice(0, 300) : undefined;
  const club = typeof searchParams.club === 'string' ? searchParams.club.toLowerCase().slice(0, 20) : undefined;
  return <HostClient initial={q} club={club} resume={searchParams.resume === '1'} />;
}

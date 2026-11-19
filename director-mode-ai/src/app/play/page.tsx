import type { Metadata } from 'next';
import HostClient from '@/components/play/HostClient';

export const metadata: Metadata = {
  title: 'CourtConnect — Get a game together',
  description: 'Say what you want. One link fills it, runs it on everyone’s phone, and wraps it with a recap. Tennis and pickleball. No app, no account.',
  alternates: { canonical: '/play' },
};

export default function PlayPage({ searchParams }: { searchParams: { q?: string; club?: string; resume?: string } }) {
  const q = typeof searchParams.q === 'string' ? searchParams.q.slice(0, 300) : undefined;
  const club = typeof searchParams.club === 'string' ? searchParams.club.toLowerCase().slice(0, 20) : undefined;
  return <HostClient initial={q} club={club} resume={searchParams.resume === '1'} />;
}

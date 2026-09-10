import type { Metadata } from 'next';

/** page.tsx is a client component, so its title has to come from a layout. */
export const metadata: Metadata = {
  title: 'Find a Coach — ClubMode AI',
  description: 'Find your tennis coach and book a lesson.',
  alternates: { canonical: '/find-coach' },
};

export default function FindCoachLayout({ children }: { children: React.ReactNode }) {
  return children;
}

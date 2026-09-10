import type { Metadata } from 'next';

/** page.tsx is a client component, so its title has to come from a layout. */
export const metadata: Metadata = {
  title: 'Sign in — ClubMode AI',
  description: 'Sign in to ClubMode AI to run your club: courts, leagues, programs, lessons and more.',
  alternates: { canonical: '/login' },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}

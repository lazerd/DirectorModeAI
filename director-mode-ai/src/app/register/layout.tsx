import type { Metadata } from 'next';

/** page.tsx is a client component, so its title has to come from a layout. */
export const metadata: Metadata = {
  title: 'Create your account — ClubMode AI',
  description: 'Start running your club on ClubMode AI. Free to start, no card needed.',
  alternates: { canonical: '/register' },
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}

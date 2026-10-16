import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Director Pulse by ClubMode — What they make. What they charge.',
  description:
    'Share your pay, private rates and clinic pricing anonymously and see how they compare with other racquet pros. No account, no name, no club.',
  alternates: { canonical: '/pulse' },
};

export default function PulseLayout({ children }: { children: React.ReactNode }) {
  return children;
}

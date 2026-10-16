import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'MixerMode by ClubMode — More play. Less planning.',
  description:
    "Turn a list of players into your club's next mixer: doubles, mixed doubles or singles rounds that rotate partners. Free, no account needed.",
  alternates: { canonical: '/mixermode' },
};

export default function MixerModeLayout({ children }: { children: React.ReactNode }) {
  return children;
}

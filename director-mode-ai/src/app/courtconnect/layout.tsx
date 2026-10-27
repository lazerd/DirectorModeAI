import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'CourtConnect by ClubMode — Need a fourth? Find one in minutes.',
  description:
    'Post a game and CourtConnect emails the members at your level. They tap "I\'m in" and you have your game. The first 1,000 emails are free, then a penny each, never more than $30 a month for the whole club.',
  alternates: { canonical: '/courtconnect' },
};

export default function CourtConnectLayout({ children }: { children: React.ReactNode }) {
  return children;
}

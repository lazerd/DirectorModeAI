import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Free mixer — MixerMode by ClubMode',
  description:
    'Turn a list of players into a doubles, mixed doubles or singles mixer in a minute. Free, no account, no email.',
  alternates: { canonical: '/try' },
};

export default function TryLayout({ children }: { children: React.ReactNode }) {
  return children;
}

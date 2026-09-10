import type { Metadata } from 'next';

/**
 * page.tsx owns the title and description; this only adds the canonical, which
 * page.tsx doesn't set. Metadata merges per key, so both survive.
 */
export const metadata: Metadata = {
  alternates: { canonical: '/captainmode' },
};

export default function CaptainModeLayout({ children }: { children: React.ReactNode }) {
  return children;
}

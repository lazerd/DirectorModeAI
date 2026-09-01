import type { Metadata } from 'next';

/**
 * page.tsx is a client component, so a `metadata` export there is silently
 * ignored — which is why /pricing was inheriting the homepage's title. A layout
 * is the only place a client page can get its own.
 */
export const metadata: Metadata = {
  title: 'Pricing — ClubMode AI',
  description:
    'Free to run your club. $49/mo when you want texting and AI. No card to start.',
  alternates: { canonical: '/pricing' },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}

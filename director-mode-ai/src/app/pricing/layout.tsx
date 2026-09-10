import type { Metadata } from 'next';
import { FOUNDING_PRICE_USD, FOUNDING_LOCK_MONTHS } from '@/config/pricing';

/**
 * page.tsx is a client component, so a `metadata` export there is silently
 * ignored — which is why /pricing was inheriting the homepage's title. A layout
 * is the only place a client page can get its own.
 */
export const metadata: Metadata = {
  title: 'Pricing — ClubMode AI',
  description: `Founding clubs get every ClubMode tool free during beta — your whole staff, no card, no trial clock. $${FOUNDING_PRICE_USD}/month locked for ${FOUNDING_LOCK_MONTHS} months when paid plans launch.`,
  alternates: { canonical: '/pricing' },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}

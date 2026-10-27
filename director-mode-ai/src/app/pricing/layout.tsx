import type { Metadata } from 'next';
import { EMAIL_MONTHLY_CAP_CENTS, EMAIL_PRICE_CENTS, TEXT_PRICE_CENTS } from '@/config/pricing';

/**
 * page.tsx is a client component, so a `metadata` export there is silently
 * ignored — which is why /pricing was inheriting the homepage's title. A layout
 * is the only place a client page can get its own.
 */
export const metadata: Metadata = {
  title: 'Pricing — ClubMode AI',
  description: `ClubMode is free: every tool, unlimited staff, members always free. Pay only for what you send — ${EMAIL_PRICE_CENTS}¢ per email (max $${EMAIL_MONTHLY_CAP_CENTS / 100}/mo), ${TEXT_PRICE_CENTS}¢ per text, Ask Claude metered. No card to start.`,
  alternates: { canonical: '/pricing' },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}

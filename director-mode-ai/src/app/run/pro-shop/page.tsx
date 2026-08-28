import type { Metadata } from 'next';
import SectionLanding from '@/components/shared/SectionLanding';
import { findSection } from '@/config/nav';

// "Pro shop" section landing — grouping only. Every card links to the tool's
// existing URL; nothing moved. See src/config/nav.ts.
export const metadata: Metadata = { title: 'Pro shop — ClubMode AI' };

export default function ProShopSectionPage() {
  return <SectionLanding section={findSection('pro-shop')!} />;
}

import type { Metadata } from 'next';
import SectionLanding from '@/components/shared/SectionLanding';
import { findSection } from '@/config/nav';

// "Facilities" section landing — grouping only. Every card links to the tool's
// existing URL; nothing moved. See src/config/nav.ts.
export const metadata: Metadata = { title: 'Facilities — ClubMode AI' };

export default function FacilitiesSectionPage() {
  return <SectionLanding section={findSection('facilities')!} />;
}

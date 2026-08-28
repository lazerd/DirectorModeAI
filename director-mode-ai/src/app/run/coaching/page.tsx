import type { Metadata } from 'next';
import SectionLanding from '@/components/shared/SectionLanding';
import { findSection } from '@/config/nav';

// "Coaching" section landing — grouping only. Every card links to the tool's
// existing URL; nothing moved. See src/config/nav.ts.
export const metadata: Metadata = { title: 'Coaching — ClubMode AI' };

export default function CoachingSectionPage() {
  return <SectionLanding section={findSection('coaching')!} />;
}

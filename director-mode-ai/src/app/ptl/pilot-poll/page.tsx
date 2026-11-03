/**
 * Public pilot-planning poll for the USTA NorCal 5.0+ task force.
 * Unlisted (noindex); the link goes out by email.
 */

import PilotPollForm from '@/components/ptl/PilotPollForm';
import { PILOT_POLL, PILOT_POLL_INTRO, PILOT_POLL_TITLE } from '@/lib/ptl/pilotPoll';

export const metadata = {
  title: 'Pilot planning — Premier Tennis League',
  robots: { index: false, follow: false },
};

export default function PilotPollPage() {
  return <PilotPollForm title={PILOT_POLL_TITLE} intro={PILOT_POLL_INTRO} questions={PILOT_POLL} />;
}

/**
 * Where a demo login lands when it opens something the demo keeps closed
 * (the admin console). API routes answer the same words as JSON.
 */
import { getLiveDemoLink, readDemoCookie, DEMO_BLOCKED_MESSAGE } from '@/lib/demo/server';
import DemoExpired from '../DemoExpired';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Not available in the demo — ClubMode', robots: { index: false } };

export default async function DemoUnavailablePage() {
  const link = await getLiveDemoLink(await readDemoCookie());
  return (
    <DemoExpired
      title={DEMO_BLOCKED_MESSAGE}
      body="This part is kept closed so the demo stays the same for everyone."
      back={link ? { href: `/demo/${link.token}`, label: 'Back to the tour' } : { href: '/', label: 'Home' }}
    />
  );
}

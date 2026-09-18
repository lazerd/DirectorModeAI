/**
 * Match-night scoring, by night token.
 *
 * Public and tokenless on purpose: the person running the evening is standing
 * on a court with a phone, and making them log in is making them not use it.
 */

import { notFound } from 'next/navigation';
import NightConsole from '@/components/ptl/NightConsole';
import { DemoRibbon } from '@/components/ptl/DemoRibbon';
import { getNightByToken } from '@/lib/ptl/scoring';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function NightPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const night = await getNightByToken(token);
  if (!night) notFound();

  const h = await headers();
  const host = h.get('x-forwarded-host') || h.get('host') || '';
  const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https');

  return (
    <>
      {night.isDemo && <DemoRibbon note={night.demoNote} />}
      <NightConsole night={night} origin={host ? `${proto}://${host}` : ''} />
    </>
  );
}

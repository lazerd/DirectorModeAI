import type { Metadata } from 'next';
import BoardClient from './BoardClient';

// /checkin/[clubSlug]/board — public court board for the kiosk tablet or the
// clubhouse TV. Its own route rather than a mode of the public court sheet:
// that page is a day grid of bookings; this is "who is on, who is next".

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Court board',
  robots: { index: false, follow: false },
};

export default async function BoardPage({ params }: { params: Promise<{ clubSlug: string }> }) {
  const { clubSlug } = await params;
  return <BoardClient slug={clubSlug} />;
}

import type { Metadata } from 'next';
import GroupClient from './GroupClient';

// /q/s/[groupToken] — a group's running timer or place in line. The token in
// the URL is the only thing that authorises its buttons.

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your court',
  robots: { index: false, follow: false },
};

export default async function GroupPage({ params }: { params: Promise<{ groupToken: string }> }) {
  const { groupToken } = await params;
  return <GroupClient token={groupToken} />;
}

import type { Metadata } from 'next';
import { signedInPlayer } from '@/lib/checkin/http';
import { spaceByToken } from '@/lib/checkin/server';
import ScanClient from './ScanClient';

/*
 * /q/[token] — where every printed check-in QR points.
 *
 * Short on purpose: the URL is printed under the QR as the fallback for a
 * phone whose camera will not read it ("clubmode.ai/q/k7m2q9xdpa"). Public,
 * and not under any middleware-protected prefix.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Court check-in',
  robots: { index: false, follow: false },
};

export default async function ScanPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await spaceByToken(token);
  // A signed-in member gets their name filled in and linked to their record.
  const me = found ? await signedInPlayer(found.club.id) : null;
  return (
    <ScanClient
      token={token}
      clubSlug={found?.club.slug ?? ''}
      me={me?.member && me.name ? { name: me.name } : null}
    />
  );
}

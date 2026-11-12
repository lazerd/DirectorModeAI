import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import PlatformHome from '@/components/home/PlatformHome';
import GuestHome from '@/components/home/GuestHome';

/**
 * clubmode.ai/ — two front doors on one URL.
 *
 *   signed in  → PlatformHome, the full 18-tool homepage, exactly as before.
 *                Sleepy Hollow and every club run on it; nothing about it changes.
 *   signed out → GuestHome, the three-door page (Players / Captains / Directors)
 *                from Kevin Carey's 11/11/26 prototype.
 *
 * The full homepage stays reachable signed out at /platform, so a prospect can
 * still be shown everything.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'ClubMode — More time on court.',
  description: 'Find your game. Bring your team. Run a great mixer.',
  alternates: { canonical: '/' },
};

export default async function HomePage() {
  let signedIn = false;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    signedIn = !!user;
  } catch {
    // An auth hiccup must never blank the front page: show the guest door.
  }
  return signedIn ? <PlatformHome /> : <GuestHome />;
}

import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import PlatformHome from '@/components/home/PlatformHome';
import DemoTour from '@/components/play/DemoTour';

/**
 * clubmode.ai/ — two front doors on one URL.
 *
 *   signed in  → PlatformHome, the full 18-tool homepage, exactly as before.
 *                Sleepy Hollow and every club run on it; nothing about it changes.
 *   signed out → Racquets IRL (11/20/26, Darrin): the same self-running demo as
 *                /racquetsirl, with a small footer link to /platform for the suite.
 *                (Kevin's three-door GuestHome was the signed-out page before.)
 *
 * The full homepage stays reachable signed out at /platform, so a prospect can
 * still be shown everything.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Racquets IRL: Racquet Sports. Together. In Real Life.',
  description: 'Watch a Friday night run itself. Tennis, pickleball, padel. One sentence. One link. Everybody plays. No app, no account.',
  alternates: { canonical: '/' },
  openGraph: { title: 'Racquets IRL: Racquet Sports. Together. In Real Life.', url: '/' },
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
  return signedIn ? <PlatformHome fallbackToGuest /> : <DemoTour />;
}

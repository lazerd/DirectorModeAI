import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import PlatformHome from '@/components/home/PlatformHome';
import Landing from '@/components/play/landing/Landing';

/**
 * clubmode.ai/ — two front doors on one URL.
 *
 *   signed in  → PlatformHome, the full 18-tool homepage, exactly as before.
 *                Sleepy Hollow and every club run on it; nothing about it changes.
 *   signed out → the Racquets IRL landing page (11/23/26, Kevin + Darrin), the same
 *                page as /racquetsirl. Its footer links to /platform for the suite.
 *                (Before: the self-running tour, now at /play/demo; before that, Kevin's GuestHome.)
 *
 * The full homepage stays reachable signed out at /platform, so a prospect can
 * still be shown everything.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Racquets IRL: More playing. Less planning.',
  description: 'Create a tennis, pickleball or padel game, fill it with one link, and let Racquets IRL run the courts, partners and scores. No app, no login. First game free.',
  alternates: { canonical: '/' },
  openGraph: { title: 'Racquets IRL: More playing. Less planning.', description: 'Create a tennis, pickleball or padel game, fill it with one link, and let Racquets IRL run the courts, partners and scores. No app, no login. First game free.', url: '/' },
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
  return signedIn ? <PlatformHome fallbackToGuest /> : <Landing />;
}

import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import MembersGate from '@/components/home/MembersGate';
import Clubhouse from '@/components/home/Clubhouse';
import { PASS_COOKIE, verifyPass } from '@/lib/members/pass';

/**
 * clubmode.ai/ — members only (Darrin, 11/25/26).
 *
 *   signed in        → the Clubhouse (member): the staff, texts, and every tool ("the rooms")
 *   a member code    → the Clubhouse (insider): what's inside, and how to claim a membership
 *   anyone else      → the gate: one line and a box for a code
 *
 * Racquets IRL moved to its own front door, racquetsirl.com (middleware rewrites its "/").
 * The old 18-tool homepage is still at /platform, for members.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'ClubMode · Members only',
  description: 'A private club for the people who run racquet clubs. By invitation.',
  alternates: { canonical: '/' },
  openGraph: { title: 'ClubMode · Members only', description: 'A private club for the people who run racquet clubs. By invitation.', url: '/' },
};

export default async function HomePage() {
  let signedIn = false;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    signedIn = !!user;
  } catch {
    // An auth hiccup must never blank the front page: show the door.
  }
  if (signedIn) return <Clubhouse mode="member" />;
  const pass = verifyPass((await cookies()).get(PASS_COOKIE)?.value);
  return pass ? <Clubhouse mode="insider" /> : <MembersGate />;
}

import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import PlatformHome from '@/components/home/PlatformHome';
import { createClient } from '@/lib/supabase/server';
import { PASS_COOKIE, verifyPass } from '@/lib/members/pass';

/**
 * /platform — the full 18-tool ClubMode page. Members only since 11/25/26: a signed-in
 * member or a browser that entered a member code. Everyone else goes to the door at "/".
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Everything in ClubMode',
  alternates: { canonical: '/platform' },
  robots: { index: false },
};

export default async function PlatformPage() {
  let signedIn = false;
  try {
    const { data: { user } } = await (await createClient()).auth.getUser();
    signedIn = !!user;
  } catch {}
  if (!signedIn && !verifyPass((await cookies()).get(PASS_COOKIE)?.value)) redirect('/');
  return <PlatformHome />;
}

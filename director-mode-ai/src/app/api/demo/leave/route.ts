/**
 * POST /api/demo/leave — sign out of the demo account and go back to the tour.
 *
 * Only signs out a session that belongs to the demo link in the cookie. If
 * someone has since signed in as themselves, leaving the demo must not sign
 * them out of their own account; it just forgets the cookie.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient as createSsrClient } from '@/lib/supabase/server';
import { ACTIVE_CLUB_COOKIE } from '@/lib/clubs/activeClub';
import { DEMO_COOKIE, findDemoLink, readDemoCookie, roleOf } from '@/lib/demo/server';

export const dynamic = 'force-dynamic';

export async function POST() {
  const token = await readDemoCookie();
  const link = await findDemoLink(token);

  const supabase = await createSsrClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const wasDemo = !!link && !!roleOf(link, user?.id);
  if (wasDemo) await supabase.auth.signOut();

  const store = await cookies();
  store.set(DEMO_COOKIE, '', { path: '/', maxAge: 0 });
  if (wasDemo) store.set(ACTIVE_CLUB_COOKIE, '', { path: '/', maxAge: 0 });

  return NextResponse.json({ ok: true, to: link ? `/demo/${link.token}` : '/' });
}

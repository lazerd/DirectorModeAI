/**
 * GET /api/demo/state — is this browser inside a demo, and as whom?
 *
 * The banner asks on mount (only when a cm_demo cookie is present) rather than
 * the root layout reading cookies, which would turn every static page dynamic.
 *
 * "Inside" needs BOTH the cookie and a session that belongs to that link. A
 * stale cookie on a browser someone has since signed into normally shows
 * nothing, so a real director is never told they are exploring a demo.
 */

import { NextResponse } from 'next/server';
import { createClient as createSsrClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { findDemoLink, readDemoCookie, roleOf } from '@/lib/demo/server';

export const dynamic = 'force-dynamic';

const NONE = () => NextResponse.json({ demo: false }, { headers: { 'Cache-Control': 'no-store' } });

export async function GET() {
  const token = await readDemoCookie();
  if (!token) return NONE();
  const link = await findDemoLink(token);
  if (!link) return NONE();

  const supabase = await createSsrClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const role = roleOf(link, user?.id);
  if (!user || !role) return NONE();

  const db = getSupabaseAdmin();
  const [{ data: profile }, { data: club }] = await Promise.all([
    db.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
    db.from('cc_clubs').select('name').eq('id', link.club_id).maybeSingle(),
  ]);
  const fullName = (profile as { full_name?: string | null } | null)?.full_name || '';

  return NextResponse.json(
    {
      demo: true,
      token: link.token,
      role,
      firstName: fullName.trim().split(/\s+/)[0] || null,
      label: link.label || (club as { name?: string } | null)?.name || null,
      directorLabel: link.director_label || 'tennis director',
      hasOther: role === 'member' ? !!link.director_user_id : !!link.member_user_id,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

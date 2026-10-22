import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isPlatformOwnerEmail } from '@/lib/platformOwner';

/** Platform-owner gate for /api/admin/recruiting/*. Returns the user, or a 401/404 response. */
export async function requireOwner(): Promise<{ user: { id: string; email?: string | null } } | { response: NextResponse }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  if (!isPlatformOwnerEmail(user.email)) return { response: NextResponse.json({ error: 'not found' }, { status: 404 }) };
  return { user };
}

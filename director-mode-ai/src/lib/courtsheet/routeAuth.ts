/**
 * Shared auth + club resolution for CourtSheet API routes.
 *
 * Pattern: every staff-side route calls requireStaffForClub() at the top.
 * It returns either { user, club, db } on success or { error } with a
 * NextResponse to return immediately.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { hasFeature } from '@/lib/billing';
import type { Club } from './types';

export type StaffRole = 'owner' | 'director' | 'coach' | 'front_desk';

export interface StaffContext {
  user: { id: string; email: string };
  club: Club;
  role: StaffRole | 'member';
  db: ReturnType<typeof getSupabaseAdmin>;
}

export interface RouteError {
  error: NextResponse;
}

/**
 * Resolves the user's "primary" club — the cc_clubs row they own. If
 * they own none, auto-bootstraps one (with the user as owner_id + owner
 * membership). If they own several, returns the alphabetically-first
 * (a club switcher UI lands in Phase 5).
 *
 * Set { requireWrite: true } to require Pro AND a staff role. Set
 * { requireWrite: false } to allow Free tier read-only.
 */
export async function requireStaffForClub(
  opts: { requireWrite?: boolean } = {}
): Promise<StaffContext | RouteError> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const db = getSupabaseAdmin();

  // Find an owned club, or bootstrap one.
  let { data: club } = await db
    .from('cc_clubs')
    .select('id, slug, name, timezone, operating_hours, is_public, owner_id')
    .eq('owner_id', user.id)
    .order('name', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!club) {
    const slug = await generateUniqueSlug(
      db,
      (user.email ?? 'club').split('@')[0].toLowerCase().replace(/[^a-z0-9-]/g, '-')
    );
    const display = (user.email ?? 'My Club').split('@')[0];
    const { data: created, error: createErr } = await db
      .from('cc_clubs')
      .insert({
        owner_id: user.id,
        name: `${display}'s Club`,
        slug,
        sports: ['tennis'],
        is_public: false,
        timezone: 'America/Los_Angeles',
        operating_hours: {},
      })
      .select('id, slug, name, timezone, operating_hours, is_public, owner_id')
      .single();
    if (createErr || !created) {
      return {
        error: NextResponse.json(
          { error: 'Could not initialize club', detail: createErr?.message },
          { status: 500 }
        ),
      };
    }
    club = created;
    await db
      .from('cc_club_members')
      .insert({ club_id: club!.id, user_id: user.id, role: 'owner' });
  }

  const { data: membership } = await db
    .from('cc_club_members')
    .select('role')
    .eq('club_id', club!.id)
    .eq('user_id', user.id)
    .maybeSingle();

  const role = ((membership?.role as StaffRole | 'member') ??
    (club!.owner_id === user.id ? 'owner' : 'member')) as StaffRole | 'member';

  // Pro gate for write actions.
  if (opts.requireWrite) {
    const writeRoles: Array<StaffRole | 'member'> = ['owner', 'director', 'coach', 'front_desk'];
    if (!writeRoles.includes(role)) {
      return {
        error: NextResponse.json({ error: 'Insufficient role' }, { status: 403 }),
      };
    }
    const planAllowsCourtSheet = await hasFeature(user.id, 'court_sheet');
    if (!planAllowsCourtSheet) {
      return {
        error: NextResponse.json(
          {
            error: 'Pro required',
            detail: 'CourtSheet editing is a Pro feature. Free tier is view-only.',
            upgrade_url: '/pricing',
          },
          { status: 402 }
        ),
      };
    }
  }

  return {
    user: { id: user.id, email: user.email ?? '' },
    club: club as Club,
    role,
    db,
  };
}

async function generateUniqueSlug(
  db: ReturnType<typeof getSupabaseAdmin>,
  base: string
): Promise<string> {
  const cleanBase = base || 'club';
  let candidate = cleanBase;
  let n = 1;
  while (true) {
    const { data } = await db
      .from('cc_clubs')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle();
    if (!data) return candidate;
    n += 1;
    candidate = `${cleanBase}-${n}`;
    if (n > 50) return `${cleanBase}-${Date.now()}`;
  }
}

/**
 * Public route resolver — looks up a club by slug, requires it to be
 * is_public=true. No auth needed.
 */
export async function resolvePublicClub(slug: string): Promise<Club | null> {
  const db = getSupabaseAdmin();
  const { data } = await db
    .from('cc_clubs')
    .select('id, slug, name, timezone, operating_hours, is_public, owner_id')
    .eq('slug', slug)
    .eq('is_public', true)
    .maybeSingle();
  return (data as Club) ?? null;
}

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
  const CLUB_COLS = 'id, slug, name, timezone, operating_hours, is_public, owner_id';

  // Resolve the club this user runs, in order of authority. The order matters —
  // a plain MEMBER must never fall through to the bootstrap branch, or a player
  // poking at a director URL spawns a phantom club under their name.
  let role: StaffRole | 'member' = 'member';

  // 1. A club they own.
  let { data: club } = await db
    .from('cc_clubs')
    .select(CLUB_COLS)
    .eq('owner_id', user.id)
    .order('name', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (club) role = 'owner';

  // 2. Else a club where they're STAFF (director / coach / front desk) — this
  //    is what makes "one subscription, whole team" reach CourtSheet & calendar.
  if (!club) {
    const { data: staffMem } = await db
      .from('cc_club_members')
      .select('club_id, role')
      .eq('user_id', user.id)
      .in('role', ['owner', 'director', 'coach', 'front_desk'])
      .limit(1)
      .maybeSingle();
    if (staffMem) {
      const { data: staffClub } = await db.from('cc_clubs').select(CLUB_COLS).eq('id', staffMem.club_id).maybeSingle();
      if (staffClub) { club = staffClub; role = staffMem.role as StaffRole; }
    }
  }

  // 3. Else, do they belong to a club as a plain MEMBER? If so they're a player,
  //    not staff — deny, and send them to their member home. Never bootstrap.
  if (!club) {
    const { count: memberships } = await db
      .from('cc_club_members')
      .select('club_id', { count: 'exact', head: true })
      .eq('user_id', user.id);
    if ((memberships ?? 0) > 0) {
      return {
        error: NextResponse.json(
          { error: 'Members-only account', detail: 'This is a staff area.', memberHome: '/client/dashboard' },
          { status: 403 },
        ),
      };
    }
  }

  // 4. Else a genuinely new user with no club at all → bootstrap one (the
  //    first-run onboarding for a new director).
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
      .select(CLUB_COLS)
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
    role = 'owner';
    await db
      .from('cc_club_members')
      .insert({ club_id: club!.id, user_id: user.id, role: 'owner' });
  }

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

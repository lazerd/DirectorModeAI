/**
 * MaintenanceMode — who is asking, and for which club.
 *
 * Every MaintenanceMode page and API route resolves its caller here, so they
 * all agree on the club and the permissions.
 *
 * Differs from requireStaffForClub (CourtSheet / CalendarMode) in two ways:
 *   - the maintenance crew is let in (that helper refuses them, correctly —
 *     the crew must see nothing else);
 *   - it NEVER creates a club. A stranger poking at /maintenance gets a
 *     refusal, not a phantom club under their name.
 *
 * Data goes through the service-role client, and every query a route makes
 * must filter by `club.id` — the maint_* tables have RLS on with no client
 * policies, so the route IS the access check.
 */
import { NextResponse } from 'next/server';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { normalizeTimeZone } from '@/lib/captain/clubTime';
import {
  MAINTENANCE_ACCESS_ROLES,
  MAINTENANCE_MANAGER_ROLES,
  pickPrimaryClub,
  type Membership,
} from '@/lib/clubRoles';
import { clubNowHHMM, clubToday } from './dates';
import type { ISODate } from './types';

export type MaintenanceRole = 'owner' | 'director' | 'coach' | 'front_desk' | 'maintenance';

export interface MaintenanceContext {
  user: { id: string; email: string };
  club: { id: string; name: string; slug: string; timezone: string; owner_id: string };
  role: MaintenanceRole;
  /** Owner / director: routine, projects, digest. */
  canManage: boolean;
  /** The maintenance crew. */
  isCrew: boolean;
  /** Club-local date and wall-clock time for this request. */
  today: ISODate;
  nowHHMM: string;
  db: ReturnType<typeof getSupabaseAdmin>;
}

export type MaintenanceAuth = MaintenanceContext | { error: NextResponse; reason: 'signed_out' | 'member' | 'no_club' };

export function isAuthError(v: MaintenanceAuth): v is { error: NextResponse; reason: 'signed_out' | 'member' | 'no_club' } {
  return (v as { error?: unknown }).error !== undefined;
}

const CLUB_COLS = 'id, name, slug, timezone, owner_id';

export async function requireMaintenanceContext(opts: { manage?: boolean } = {}): Promise<MaintenanceAuth> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: 'Sign in first.' }, { status: 401 }), reason: 'signed_out' };
  }

  const db = getSupabaseAdmin();
  let club: MaintenanceContext['club'] | null = null;
  let role: MaintenanceRole | null = null;

  // 1. A club they own — same order as requireStaffForClub, so every surface
  //    picks the same club for the same person.
  const { data: owned } = await db
    .from('cc_clubs')
    .select(CLUB_COLS)
    .eq('owner_id', user.id)
    .order('name', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (owned) {
    club = owned as MaintenanceContext['club'];
    role = 'owner';
  }

  // 2. A club where they're staff or crew.
  if (!club) {
    const { data: mems } = await db
      .from('cc_club_members')
      .select('club_id, role, created_at')
      .eq('user_id', user.id)
      .in('role', MAINTENANCE_ACCESS_ROLES as string[]);
    const clubId = pickPrimaryClub((mems as Membership[]) || []);
    if (clubId) {
      const { data: row } = await db.from('cc_clubs').select(CLUB_COLS).eq('id', clubId).maybeSingle();
      if (row) {
        club = row as MaintenanceContext['club'];
        role = ((mems as Membership[]).find((m) => m.club_id === clubId)?.role ?? null) as MaintenanceRole | null;
      }
    }
  }

  // 3. Anyone else is refused. Never bootstrap a club here.
  if (!club || !role) {
    const { count } = await db
      .from('cc_club_members')
      .select('club_id', { count: 'exact', head: true })
      .eq('user_id', user.id);
    return (count ?? 0) > 0
      ? {
          error: NextResponse.json({ error: 'MaintenanceMode is for club staff and the maintenance crew.' }, { status: 403 }),
          reason: 'member',
        }
      : { error: NextResponse.json({ error: 'You are not part of a club yet.' }, { status: 403 }), reason: 'no_club' };
  }

  const canManage = (MAINTENANCE_MANAGER_ROLES as string[]).includes(role);
  if (opts.manage && !canManage) {
    return {
      error: NextResponse.json({ error: 'Only the owner or a director can change this.' }, { status: 403 }),
      reason: 'member',
    };
  }

  const timezone = normalizeTimeZone(club.timezone);
  const now = new Date();
  return {
    user: { id: user.id, email: user.email ?? '' },
    club: { ...club, timezone },
    role,
    canManage,
    isCrew: role === 'maintenance',
    today: clubToday(now, timezone),
    nowHHMM: clubNowHHMM(now, timezone),
    db,
  };
}

/** Page variant: redirects instead of returning JSON. */
export async function getMaintenanceContextForPage(path = '/maintenance'): Promise<MaintenanceContext> {
  const ctx = await requireMaintenanceContext();
  if (isAuthError(ctx)) {
    if (ctx.reason === 'signed_out') redirect(`/login?redirect=${encodeURIComponent(path)}`);
    if (ctx.reason === 'member') redirect('/member');
    redirect('/welcome');
  }
  return ctx;
}

/** 400 with a plain message. */
export function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** Trimmed text or null; `max` caps runaway pastes. */
export function text(v: unknown, max = 2000): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

/** A photo path is only accepted if it lives under this club's folder. */
export function ownPhoto(
  db: MaintenanceContext['db'],
  clubId: string,
  path: unknown,
): { photo_url: string; photo_path: string } | null {
  if (typeof path !== 'string' || !path.startsWith(`${clubId}/`) || path.includes('..')) return null;
  const { data } = db.storage.from(PHOTO_BUCKET).getPublicUrl(path);
  return { photo_url: data.publicUrl, photo_path: path };
}

export const PHOTO_BUCKET = 'maintenance-photos';

/**
 * Demo links — reading them, and knowing who is a demo account.
 *
 * Service role throughout. demo_links has RLS on and no policies, and the
 * token IS the credential, so it is never read through a visitor's session.
 * (createServiceClient forwards the user's cookie and is RLS-scoped; this uses
 * getSupabaseAdmin on purpose.)
 */

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { createClient as createSsrClient } from '@/lib/supabase/server';
import type { DemoRole } from './nextPath';

/** Set on entering a demo. Readable by script so the banner only asks when it is there. */
export const DEMO_COOKIE = 'cm_demo';
export const DEMO_COOKIE_MAX_AGE = 60 * 60 * 12;

export const DEMO_BLOCKED_MESSAGE = 'Not available in the demo.';

export type DemoLink = {
  token: string;
  club_id: string;
  label: string | null;
  member_user_id: string | null;
  director_user_id: string | null;
  /** What the staff login is called on this club's tour: "tennis director", "board member". */
  director_label: string;
  active: boolean;
  expires_at: string | null;
  created_at: string;
  last_used_at: string | null;
  use_count: number;
};

/** Tokens are base64url, 24+ chars. Anything else is not worth a query. */
export const isDemoTokenShape = (t: string | null | undefined): t is string =>
  !!t && /^[A-Za-z0-9_-]{24,128}$/.test(t);

const LINK_COLS =
  'token, club_id, label, member_user_id, director_user_id, director_label, active, expires_at, created_at, last_used_at, use_count';
/** The row, whatever its state. */
export async function findDemoLink(token: string | null | undefined): Promise<DemoLink | null> {
  if (!isDemoTokenShape(token)) return null;
  const { data } = await getSupabaseAdmin().from('demo_links').select(LINK_COLS).eq('token', token).maybeSingle();
  return (data as DemoLink | null) ?? null;
}

export function isLinkLive(link: DemoLink | null, now = Date.now()): link is DemoLink {
  if (!link || !link.active) return false;
  if (link.expires_at && Date.parse(link.expires_at) <= now) return false;
  return true;
}

/** A link that may be used right now, or null. */
export async function getLiveDemoLink(token: string | null | undefined): Promise<DemoLink | null> {
  const link = await findDemoLink(token);
  return isLinkLive(link) ? link : null;
}

export function accountFor(link: DemoLink, role: DemoRole): string | null {
  return role === 'member' ? link.member_user_id : link.director_user_id;
}

export function roleOf(link: DemoLink, userId: string | null | undefined): DemoRole | null {
  if (!userId) return null;
  if (link.member_user_id === userId) return 'member';
  if (link.director_user_id === userId) return 'director';
  return null;
}

export async function touchDemoLink(link: DemoLink): Promise<void> {
  await getSupabaseAdmin()
    .from('demo_links')
    .update({ use_count: (link.use_count ?? 0) + 1, last_used_at: new Date().toISOString() })
    .eq('token', link.token);
}

/**
 * Is this account attached to ANY demo link, live or not?
 *
 * Deliberately not "a live link": a revoked link must not turn its demo
 * director back into someone who can start a billing checkout.
 */
export async function isDemoUser(userId: string | null | undefined): Promise<boolean> {
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) return false;
  const { data } = await getSupabaseAdmin()
    .from('demo_links')
    .select('token')
    .or(`member_user_id.eq.${userId},director_user_id.eq.${userId}`)
    .limit(1);
  return !!(data && data.length);
}

/* ------------------------------------------------------------ guardrails */

export function demoBlockedResponse(): NextResponse {
  return NextResponse.json({ error: DEMO_BLOCKED_MESSAGE, demo: true }, { status: 403 });
}

/**
 * The few things a demo board member may not do: what cannot be undone, or
 * what reaches the outside world. Call at the top of those routes; returns
 * the response to send, or null to carry on. Pass the user id when the route
 * already has it, to save a round trip.
 */
export async function blockIfDemo(userId?: string | null): Promise<NextResponse | null> {
  let id = userId;
  if (id === undefined) {
    const supabase = await createSsrClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    id = user?.id ?? null;
  }
  return (await isDemoUser(id)) ? demoBlockedResponse() : null;
}

/* ------------------------------------------------------- email snapshot */

export type DemoSnapshot = {
  userIds: Set<string>;
  tokens: Set<string>;
  clubIds: Set<string>;
  clubSlugs: Set<string>;
  /** Demo logins and the contact addresses of demo clubs, lower-cased. */
  emails: Set<string>;
};

const SNAPSHOT_TTL_MS = 60_000;
let snapshot: { at: number; value: DemoSnapshot } | null = null;
const empty = (): DemoSnapshot => ({
  userIds: new Set(),
  tokens: new Set(),
  clubIds: new Set(),
  clubSlugs: new Set(),
  emails: new Set(),
});

/**
 * Everything the email guard needs, cached for a minute.
 *
 * A failed read keeps the last good snapshot rather than blanking it. The
 * guard's example.com rule does not depend on this at all, so a database blip
 * can never mail an invented resident.
 */
export async function demoSnapshot(): Promise<DemoSnapshot> {
  if (snapshot && Date.now() - snapshot.at < SNAPSHOT_TTL_MS) return snapshot.value;
  try {
    const db = getSupabaseAdmin();
    const [{ data: links, error: linkErr }, { data: clubs, error: clubErr }] = await Promise.all([
      db.from('demo_links').select('token, member_user_id, director_user_id'),
      db.from('cc_clubs').select('id, slug, email').eq('demo_mode', true),
    ]);
    if (linkErr || clubErr) throw new Error(linkErr?.message || clubErr?.message);
    const value = empty();
    for (const l of (links as Pick<DemoLink, 'token' | 'member_user_id' | 'director_user_id'>[] | null) ?? []) {
      value.tokens.add(l.token);
      if (l.member_user_id) value.userIds.add(l.member_user_id);
      if (l.director_user_id) value.userIds.add(l.director_user_id);
    }
    for (const c of (clubs as { id: string; slug: string; email: string | null }[] | null) ?? []) {
      value.clubIds.add(c.id);
      value.clubSlugs.add(c.slug);
      if (c.email) value.emails.add(c.email.trim().toLowerCase());
    }
    const users = await Promise.all([...value.userIds].map((id) => db.auth.admin.getUserById(id)));
    for (const u of users) {
      const email = u.data?.user?.email;
      if (email) value.emails.add(email.toLowerCase());
    }
    snapshot = { at: Date.now(), value };
    return value;
  } catch (err) {
    console.error('[demo] snapshot failed', err);
    return snapshot?.value ?? empty();
  }
}

export async function isDemoClub(clubId: string | null | undefined): Promise<boolean> {
  if (!clubId) return false;
  return (await demoSnapshot()).clubIds.has(clubId);
}

/** The demo token in this browser's cookie, if any. Null outside a request. */
export async function readDemoCookie(): Promise<string | null> {
  try {
    return (await cookies()).get(DEMO_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}

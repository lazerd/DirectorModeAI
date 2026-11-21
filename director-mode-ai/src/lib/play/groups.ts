/**
 * Racquets IRL Groups: the pure parts (no database, no network), so they can be tested.
 *
 *  - monthly email quota (Host Pass = 1,000 emails a month)
 *  - who in a group may be emailed (gave an email, opted in, never unsubscribed)
 *  - building / updating a group from a game's players
 *  - the signed unsubscribe token
 */
import { createHmac, timingSafeEqual } from 'crypto';

export const MONTHLY_EMAIL_LIMIT = 1000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const cleanEmail = (v: unknown): string | null => {
  const e = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return e && e.length <= 200 && EMAIL_RE.test(e) ? e : null;
};

/* ---------- quota ---------- */

/** First instant of the calendar month (UTC) that `now` is in. */
export function monthStartUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export type QuotaResult = { ok: boolean; used: number; limit: number; remaining: number; enforced: boolean };

/**
 * May `wanted` more emails go out this month? Usage is always counted; it only
 * blocks when `enforce` is on (the paywall is live). All-or-nothing: a blast that
 * would cross the limit is refused whole, never half-sent.
 */
export function checkQuota(used: number, wanted: number, opts: { limit?: number; enforce: boolean }): QuotaResult {
  const limit = opts.limit ?? MONTHLY_EMAIL_LIMIT;
  const u = Math.max(0, Math.floor(used || 0));
  const w = Math.max(0, Math.floor(wanted || 0));
  const remaining = Math.max(0, limit - u);
  return { ok: !opts.enforce || w <= remaining, used: u, limit, remaining, enforced: opts.enforce };
}

/* ---------- recipients ---------- */

export type GroupMember = {
  id?: string;
  name: string;
  email: string | null;
  opted_in: boolean;
  unsubscribed_at: string | null;
  source_rsvp_id?: string | null;
};
export type OptOut = { email: string; owner_user_id: string | null; group_id: string | null };

/** Does any opt-out cover this address for this host's group? */
export function isOptedOut(email: string, optouts: OptOut[], ownerId: string, groupId: string): boolean {
  const e = email.toLowerCase();
  return optouts.some((o) => o.email.toLowerCase() === e
    && (o.owner_user_id == null || o.owner_user_id === ownerId)
    && (o.group_id == null || o.group_id === groupId));
}

/** The members who may get a blast: a valid email, opted in, not unsubscribed, no opt-out. One per address. */
export function emailableMembers<M extends GroupMember>(members: M[], optouts: OptOut[], ownerId: string, groupId: string): M[] {
  const seen = new Set<string>();
  const out: M[] = [];
  for (const m of members) {
    const e = cleanEmail(m.email);
    if (!e || !m.opted_in || m.unsubscribed_at) continue;
    if (isOptedOut(e, optouts, ownerId, groupId)) continue;
    if (seen.has(e)) continue;
    seen.add(e);
    out.push(m);
  }
  return out;
}

/* ---------- group from a game's players ---------- */

export type RsvpLike = { id: string; name: string; status: string; is_host?: boolean; email?: string | null; email_opt_in?: boolean | null };
export type MergePlan = {
  inserts: Omit<GroupMember, 'id'>[];
  updates: { id: string; email: string; opted_in: true }[];
};

/**
 * Who to add or update when a host saves a game's players into a group.
 * Matching is by lowercased name (the table's unique key). The host is skipped,
 * as is anyone who left. Existing members keep their email and their
 * unsubscribe; an opted-in player's email only fills in a member who has no
 * opted-in email yet. Emails are only taken from players who opted in.
 */
export function planGroupFromRsvps(existing: GroupMember[], rsvps: RsvpLike[]): MergePlan {
  const byName = new Map(existing.map((m) => [m.name.trim().toLowerCase(), m]));
  const plan: MergePlan = { inserts: [], updates: [] };
  const added = new Set<string>();
  for (const r of rsvps) {
    if (r.is_host || r.status === 'out') continue;
    const name = r.name.trim().slice(0, 40);
    const k = name.toLowerCase();
    if (!k || added.has(k)) continue;
    added.add(k);
    const email = r.email_opt_in ? cleanEmail(r.email) : null;
    const have = byName.get(k);
    if (!have) {
      plan.inserts.push({ name, email, opted_in: !!email, unsubscribed_at: null, source_rsvp_id: r.id });
      continue;
    }
    const keeps = have.opted_in && cleanEmail(have.email);
    if (!keeps && email && have.id) plan.updates.push({ id: have.id, email, opted_in: true });
  }
  return plan;
}

/* ---------- unsubscribe token ---------- */

export type UnsubToken = { email: string; ownerId: string; groupId: string | null };

const sig = (secret: string, payload: string) => createHmac('sha256', secret).update(`play-unsub:${payload}`).digest('base64url').slice(0, 32);

/** A link token for one address, one host and (optionally) one group. Never expires. */
export function signUnsub(t: UnsubToken, secret: string): string {
  const payload = Buffer.from(JSON.stringify([t.email.toLowerCase(), t.ownerId, t.groupId ?? '']), 'utf8').toString('base64url');
  return `${payload}.${sig(secret, payload)}`;
}

export function verifyUnsub(token: string | null | undefined, secret: string): UnsubToken | null {
  if (!token || typeof token !== 'string' || token.length > 1000) return null;
  const [payload, s, extra] = token.split('.');
  if (!payload || !s || extra !== undefined) return null;
  const want = sig(secret, payload);
  if (s.length !== want.length || !timingSafeEqual(Buffer.from(s), Buffer.from(want))) return null;
  try {
    const [email, ownerId, groupId] = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as string[];
    if (!cleanEmail(email) || !ownerId) return null;
    return { email, ownerId, groupId: groupId || null };
  } catch { return null; }
}

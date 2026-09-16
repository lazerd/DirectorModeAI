/**
 * Who is asking, on the server, for every CRM page and route.
 *
 * Reads through getSupabaseAdmin(), NOT createServiceClient(): that one
 * forwards the caller's cookie, so PostgREST still applies RLS as them. For
 * the CRM the difference is invisible until Kevin is added to the allowlist
 * but has not signed in yet — is_crm_user() would say no while this helper
 * says yes, and the page would render empty instead of working. The route IS
 * the access check here; the RLS policies are the second lock.
 *
 * A caller who is not a CRM user is told the page does not exist. Not
 * "Forbidden" — a 403 on /crm tells a club owner poking at URLs that there is
 * a sales pipeline to go looking for. notFound() and a bare 404 body say
 * nothing. That is the whole reason this helper exists rather than each route
 * writing its own check.
 */

import { NextResponse } from 'next/server';
import { notFound } from 'next/navigation';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { crmAccessFor, type CrmAccess, type CrmUserRow } from './access';
import { crmToday, type ISODate } from './dates';

export interface CrmContext {
  user: { id: string; email: string };
  access: CrmAccess;
  /** Lower-cased email of the rep — what activities and sends are stamped with. */
  repEmail: string;
  repName: string;
  /** Today where the reps are. */
  today: ISODate;
  db: ReturnType<typeof getSupabaseAdmin>;
}

export type CrmAuth = CrmContext | { error: NextResponse; reason: 'signed_out' | 'denied' };

export function isCrmAuthError(v: CrmAuth): v is { error: NextResponse; reason: 'signed_out' | 'denied' } {
  return (v as { error?: unknown }).error !== undefined;
}

/** Every allowlist row. Tiny table — two rows — so it is never worth filtering. */
async function allowlist(db: ReturnType<typeof getSupabaseAdmin>): Promise<CrmUserRow[]> {
  const { data } = await db.from('crm_users').select('email, user_id, full_name, initials, active');
  return ((data as CrmUserRow[] | null) || []).filter(Boolean);
}

/**
 * The 404 a stranger gets. Deliberately the same shape and status as a route
 * that does not exist, with no hint in the body.
 */
export function crmNotFound() {
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

export async function requireCrm(): Promise<CrmAuth> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Signed out is still a 404 on the API. Middleware sends a browser to
  // /login; a bare fetch gets nothing to learn from.
  if (!user) return { error: crmNotFound(), reason: 'signed_out' };

  const db = getSupabaseAdmin();
  const access = crmAccessFor({ userId: user.id, email: user.email ?? null }, await allowlist(db));
  if (!access.allowed) return { error: crmNotFound(), reason: 'denied' };

  /*
   * Link the row to the account the first time they sign in, so the allowlist
   * keeps working if they later change their email. Best-effort: a failure
   * here must not block the request, and the email match still gets them in.
   */
  if (access.row && !access.row.user_id) {
    await db
      .from('crm_users')
      .update({ user_id: user.id })
      .eq('email', access.row.email)
      .is('user_id', null);
  }

  const repEmail = access.email || (user.email ?? '').toLowerCase();
  return {
    user: { id: user.id, email: user.email ?? '' },
    access,
    repEmail,
    repName: access.row?.full_name || repEmail,
    today: crmToday(),
    db,
  };
}

/**
 * Page variant. A signed-out visitor is sent to log in — middleware does this
 * too, but a page must not depend on the matcher to be safe. Everyone else who
 * is not a rep gets the app's own not-found page.
 */
export async function requireCrmForPage(path = '/crm'): Promise<CrmContext> {
  const ctx = await requireCrm();
  if (isCrmAuthError(ctx)) {
    if (ctx.reason === 'signed_out') redirect(`/login?redirect=${encodeURIComponent(path)}`);
    notFound();
  }
  return ctx;
}

/** 400 with a plain message. */
export function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** Trimmed text or null; `max` caps a runaway paste. */
export function text(v: unknown, max = 4000): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

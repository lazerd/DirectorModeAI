/**
 * POST /api/crm/queue — put clubs in (or take them out of) the outreach queue.
 *
 *   { org_ids: string[], unqueue?: boolean }
 *
 * The one bulk action on the cold list. It sets crm_orgs.queued_at and nothing
 * else: no email is composed, nothing is scheduled, nobody is written to. The
 * outreach deck (/crm/deck) reads the flag to decide what to draft; until that
 * exists it is a rep's own shortlist, which is a useful thing on its own and
 * an honest one to leave behind if the deck never ships.
 *
 * Capped at 500 ids per call — the whole cold list is 519, so "select every
 * West club" works in one press, and a runaway loop still cannot walk the
 * table in a single request.
 */

import { NextResponse } from 'next/server';
import { bad, isCrmAuthError, requireCrm } from '@/lib/crm/server';

export const dynamic = 'force-dynamic';

const MAX_IDS = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const ctx = await requireCrm();
  if (isCrmAuthError(ctx)) return ctx.error;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const raw = Array.isArray(body.org_ids) ? body.org_ids : [];
  const ids = [...new Set(raw.filter((v): v is string => typeof v === 'string' && UUID_RE.test(v)))];
  if (!ids.length) return bad('Pick some clubs first.');
  if (ids.length > MAX_IDS) return bad(`${MAX_IDS} at a time at most.`);

  const unqueue = body.unqueue === true;
  const queuedAt = unqueue ? null : new Date().toISOString();

  const { data, error } = await ctx.db
    .from('crm_orgs')
    .update({ queued_at: queuedAt })
    .in('id', ids)
    .select('id');
  if (error) return bad(error.message, 500);

  const changed = (data as { id: string }[] | null)?.length ?? 0;
  return NextResponse.json({
    ok: true,
    changed,
    queued_at: queuedAt,
    message: unqueue
      ? `${changed} club${changed === 1 ? '' : 's'} taken out of the queue.`
      : `${changed} club${changed === 1 ? '' : 's'} queued for outreach.`,
  });
}

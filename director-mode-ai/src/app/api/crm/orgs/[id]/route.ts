/**
 * GET   /api/crm/orgs/[id] — the org, its contacts and its timeline.
 * PATCH /api/crm/orgs/[id] — one field at a time, as the rep tabs out of it.
 *
 * A stage change writes its own activity row. That is not bookkeeping for its
 * own sake: "moved to Proposal" with a date is the thing that makes a timeline
 * readable six weeks later, and neither rep will ever type it by hand.
 */
import { NextResponse } from 'next/server';
import { bad, isCrmAuthError, requireCrm, text } from '@/lib/crm/server';
import { loadOrg } from '@/lib/crm/load';
import { isISODate } from '@/lib/crm/dates';
import { isOrgType, isStage, STAGE_LABEL, type Stage } from '@/lib/crm/stages';
import { ORG_COLS, type Org } from '@/lib/crm/types';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireCrm();
  if (isCrmAuthError(ctx)) return ctx.error;
  const bundle = await loadOrg(ctx.db, params.id);
  if (!bundle) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(bundle);
}

/** Free-text columns, all treated the same: trim, cap, null when blank. */
const TEXT_FIELDS: Record<string, number> = {
  name: 160,
  website: 300,
  city: 80,
  state: 40,
  owner_email: 200,
  source: 200,
  next_step: 300,
  demo_url: 400,
  notes: 8000,
  lost_reason: 400,
};

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireCrm();
  if (isCrmAuthError(ctx)) return ctx.error;

  const bundle = await loadOrg(ctx.db, params.id);
  if (!bundle) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const before = bundle.org;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  for (const [key, max] of Object.entries(TEXT_FIELDS)) {
    if (!(key in body)) continue;
    const v = text(body[key], max);
    if (key === 'name' && !v) return bad('A club needs a name.');
    patch[key] = v;
  }
  if ('type' in body) {
    if (!isOrgType(body.type)) return bad('Pick a type.');
    patch.type = body.type;
  }
  if ('member_count' in body) {
    const raw = body.member_count;
    if (raw === null || raw === '') patch.member_count = null;
    else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) return bad('Members should be a number.');
      patch.member_count = Math.round(n);
    }
  }
  if ('mrr_target_cents' in body) {
    const n = Number(body.mrr_target_cents);
    if (!Number.isFinite(n) || n < 0) return bad('That target is not a number.');
    patch.mrr_target_cents = Math.round(n);
  }
  if ('next_step_at' in body) {
    const raw = body.next_step_at ? String(body.next_step_at) : null;
    if (raw && !isISODate(raw)) return bad('That date is not a date.');
    patch.next_step_at = raw;
  }

  let stageChange: { from: Stage; to: Stage } | null = null;
  if ('stage' in body) {
    if (!isStage(body.stage)) return bad('That is not a stage.');
    if (body.stage !== before.stage) {
      stageChange = { from: before.stage, to: body.stage };
      patch.stage = body.stage;
      /*
       * Won and lost get stamped when the card lands there, and un-stamped if
       * a rep moves it back out — a stale won_at on a live deal would quietly
       * poison any "how long did that take" question later.
       */
      patch.won_at = body.stage === 'won' ? new Date().toISOString() : null;
      patch.lost_at = body.stage === 'lost' ? new Date().toISOString() : null;
      if (body.stage !== 'lost' && !('lost_reason' in body)) patch.lost_reason = null;
    }
  }

  if (!Object.keys(patch).length) return NextResponse.json({ org: before });

  const { data, error } = await ctx.db
    .from('crm_orgs')
    .update(patch)
    .eq('id', params.id)
    .select(ORG_COLS)
    .single();
  if (error) return bad(error.message, 500);

  if (stageChange) {
    const reason = typeof patch.lost_reason === 'string' && patch.lost_reason ? ` — ${patch.lost_reason}` : '';
    await ctx.db.from('crm_activities').insert({
      org_id: params.id,
      kind: 'stage_change',
      body: `${STAGE_LABEL[stageChange.from]} → ${STAGE_LABEL[stageChange.to]}${reason}`,
      created_by_email: ctx.repEmail,
    });
  }

  return NextResponse.json({ org: data as unknown as Org });
}

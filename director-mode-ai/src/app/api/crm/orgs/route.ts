/**
 * POST /api/crm/orgs — add a prospect club.
 *
 * Only the name is required. Everything else is editable inline on the org
 * page the moment it exists, which is the point: a rep who hears about a club
 * on a Tuesday should be able to get it into the pipeline in one field.
 */
import { NextResponse } from 'next/server';
import { bad, isCrmAuthError, requireCrm, text } from '@/lib/crm/server';
import { uniqueSlug } from '@/lib/crm/load';
import { isISODate } from '@/lib/crm/dates';
import { DEFAULT_MRR_TARGET_CENTS, isOrgType, isStage } from '@/lib/crm/stages';
import { ORG_COLS } from '@/lib/crm/types';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const ctx = await requireCrm();
  if (isCrmAuthError(ctx)) return ctx.error;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const name = text(body.name, 160);
  if (!name) return bad('What is the club called?');
  const stage = body.stage ?? 'researching';
  if (!isStage(stage)) return bad('Pick a stage.');
  const type = body.type ?? 'club';
  if (!isOrgType(type)) return bad('Pick a type.');
  const nextStepAt = body.next_step_at ? String(body.next_step_at) : null;
  if (nextStepAt && !isISODate(nextStepAt)) return bad('The next step date should be a date.');

  const members = Number(body.member_count);
  const mrr = Number(body.mrr_target_cents);

  const { data, error } = await ctx.db
    .from('crm_orgs')
    .insert({
      name,
      slug: await uniqueSlug(ctx.db, name),
      website: text(body.website, 300),
      city: text(body.city, 80),
      state: text(body.state, 40),
      type,
      member_count: Number.isFinite(members) && members >= 0 ? Math.round(members) : null,
      stage,
      // Whoever adds it owns it until someone says otherwise.
      owner_email: text(body.owner_email, 200) ?? ctx.repEmail,
      mrr_target_cents: Number.isFinite(mrr) && mrr >= 0 ? Math.round(mrr) : DEFAULT_MRR_TARGET_CENTS,
      source: text(body.source, 200),
      region: text(body.region, 40),
      next_step: text(body.next_step, 300),
      next_step_at: nextStepAt,
      demo_url: text(body.demo_url, 400),
      notes: text(body.notes, 8000),
    })
    .select(ORG_COLS)
    .single();
  if (error) return bad(error.message, 500);

  await ctx.db.from('crm_activities').insert({
    org_id: (data as unknown as { id: string }).id,
    kind: 'note',
    body: `Added to the pipeline by ${ctx.repName}.`,
    created_by_email: ctx.repEmail,
  });

  return NextResponse.json({ org: data });
}

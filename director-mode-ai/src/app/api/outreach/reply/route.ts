/**
 * POST /api/outreach/reply — a human wrote back.
 *
 *   { org_id, note, kind?: 'reply' | 'no thanks' | 'bounced' }
 *
 * Two things happen, and the second is the point: the reply goes on the club's
 * timeline as an activity, AND the club is suppressed. Once a person has
 * replied, a human owns that conversation — the deck must never propose them
 * again and the follow-up must never fire. There is no "pause" flag to
 * remember to set, because the suppression table is already consulted by the
 * planner, the deck and the sender.
 */
import { NextResponse } from 'next/server';
import { bad, isCrmAuthError, requireCrm, text } from '@/lib/crm/server';

export const dynamic = 'force-dynamic';

const REASONS: Record<string, 'no thanks' | 'bounced' | 'manual'> = {
  reply: 'manual',
  'no thanks': 'no thanks',
  bounced: 'bounced',
};

export async function POST(req: Request) {
  const ctx = await requireCrm();
  if (isCrmAuthError(ctx)) return ctx.error;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const orgId = typeof body.org_id === 'string' ? body.org_id : '';
  const note = text(body.note, 4000);
  if (!orgId) return bad('Which club?');
  if (!note) return bad('What did they say?');

  const { data: org } = await ctx.db.from('crm_orgs').select('id, name, stage').eq('id', orgId).maybeSingle();
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const kind = typeof body.kind === 'string' ? body.kind : 'reply';
  const reason = REASONS[kind] ?? 'manual';

  await ctx.db.from('crm_activities').insert({
    org_id: orgId,
    kind: 'email',
    body: `Reply logged by ${ctx.repName}: ${note}`,
    created_by_email: ctx.repEmail,
  });
  await ctx.db.from('crm_outreach_suppression').insert({
    org_id: orgId,
    reason,
    note: `Replied — handled by a person. ${note}`.slice(0, 500),
    created_by_email: ctx.repEmail,
  });

  // A club that replied is not researching any more, whatever they said.
  await ctx.db.from('crm_orgs').update({ stage: 'contacted' }).eq('id', orgId).eq('stage', 'researching');

  return NextResponse.json({
    ok: true,
    message: `Logged. ${(org as { name: string }).name} is off the outreach list — no follow-up will go out.`,
  });
}

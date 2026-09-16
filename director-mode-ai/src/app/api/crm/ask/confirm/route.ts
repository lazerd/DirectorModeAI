/**
 * POST /api/crm/ask/confirm — apply a proposal the rep pressed Confirm on.
 *
 *   { proposal, org_id? }
 *
 * Separate from /api/crm/ask on purpose. The model has no way to reach this
 * route: it returns a proposal, the page draws it with Confirm and Cancel, and
 * only the click posts here. Every field is re-validated in lib/crm/ask/
 * apply.ts before anything is written, so a mangled or forged proposal fails
 * the same way a bad PATCH does rather than being trusted because a model
 * produced it.
 *
 * A `draft_email` proposal writes nothing at all — it hands the draft back for
 * the compose panel, which still requires the usual preview and Send.
 */

import { NextResponse } from 'next/server';
import { bad, isCrmAuthError, requireCrm } from '@/lib/crm/server';
import { applyProposal, isProposal, type ApplyContext } from '@/lib/crm/ask/apply';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const ctx = await requireCrm();
  if (isCrmAuthError(ctx)) return ctx.error;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!isProposal(body.proposal)) return bad('There is nothing to confirm.');

  let orgId: string | null = null;
  const wanted = typeof body.org_id === 'string' ? body.org_id : '';
  if (/^[0-9a-f-]{36}$/i.test(wanted)) {
    const { data } = await ctx.db.from('crm_orgs').select('id').eq('id', wanted).maybeSingle();
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    orgId = wanted;
  }

  const applyCtx: ApplyContext = {
    allowed: true,
    db: ctx.db,
    repEmail: ctx.repEmail,
    repName: ctx.repName,
    today: ctx.today,
    orgId,
  };

  const result = await applyProposal(body.proposal, applyCtx);
  if (!result.ok) return bad(result.error);
  return NextResponse.json(result);
}

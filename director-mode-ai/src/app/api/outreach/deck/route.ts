/**
 * GET /api/outreach/deck — today's cards, in order.
 *
 * Behind requireCrm() like everything else in the CRM: a stranger gets a bare
 * 404, not a 403 that tells them a sales deck exists to go looking for.
 */
import { NextResponse } from 'next/server';
import { isCrmAuthError, requireCrm } from '@/lib/crm/server';
import { loadDeck } from '@/lib/outreach/deck';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await requireCrm();
  if (isCrmAuthError(ctx)) return ctx.error;
  const payload = await loadDeck(ctx.db, ctx.repEmail);
  return NextResponse.json(payload, { headers: { 'cache-control': 'no-store' } });
}

/**
 * GET /api/crm/access — "may I see the CRM?", for the nav rail.
 *
 * Answers `{ allowed: false }` with a 200 rather than a 404, the same shape
 * /api/admin/view-as uses: a boolean is all the rail needs, and every signed-in
 * user calls it on every page. It reveals that this endpoint exists and
 * nothing else — no org, no name, no count. Everything that carries data is a
 * 404 to the same caller.
 */
import { NextResponse } from 'next/server';
import { isCrmAuthError, requireCrm } from '@/lib/crm/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await requireCrm();
  if (isCrmAuthError(ctx)) return NextResponse.json({ allowed: false });
  return NextResponse.json({ allowed: true });
}

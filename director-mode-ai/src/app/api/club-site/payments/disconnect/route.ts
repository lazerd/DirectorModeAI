/**
 * POST /api/club-site/payments/disconnect — stop taking cards through the
 * club's Square. Revokes ClubMode's access at Square and forgets the tokens.
 * Bookings already paid stay paid; the club's payment link (if any) takes over.
 */
import { NextResponse } from 'next/server';
import { requireStaffForClub } from '@/lib/courtsheet/routeAuth';
import { blockIfDemo } from '@/lib/demo/server';
import { revokeClub } from '@/lib/squareConnect';

export const dynamic = 'force-dynamic';

export async function POST() {
  const ctx = await requireStaffForClub({ requireWrite: true });
  if ('error' in ctx) return ctx.error;
  const demo = await blockIfDemo(ctx.user.id);
  if (demo) return demo;
  await revokeClub(ctx.club.id);
  return NextResponse.json({ ok: true });
}

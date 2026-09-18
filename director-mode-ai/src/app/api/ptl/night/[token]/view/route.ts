/**
 * The night as the console needs it, refetched after every write.
 *
 * Exists because a single score can change a meeting's entire shape — a
 * tiebreak appears, or a result does — and patching that client-side is how the
 * screen and the database start disagreeing. Cheaper to re-read the truth.
 */

import { NextResponse } from 'next/server';
import { getNightByToken } from '@/lib/ptl/scoring';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const night = await getNightByToken(token);
  if (!night) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ night });
}

import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/adminAuth';
import { getFlexState, currentRound } from '@/lib/flexLeague';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const state = await getFlexState();
  const round = currentRound();
  return NextResponse.json({ state, round });
}

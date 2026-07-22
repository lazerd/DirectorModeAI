import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/adminAuth';
import { getFlexState, currentRound } from '@/lib/flexLeague';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const state = await getFlexState();
  const round = currentRound();
  return NextResponse.json({ state, round });
}

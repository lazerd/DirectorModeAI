import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/adminAuth';
import { playScorecard } from '@/lib/play/scorecard';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const days = Math.min(90, Math.max(1, Number(new URL(request.url).searchParams.get('days')) || 30));
  return NextResponse.json(await playScorecard(days));
}

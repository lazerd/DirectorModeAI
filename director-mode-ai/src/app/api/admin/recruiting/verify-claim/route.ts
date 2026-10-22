import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/connect/recruiter/adminAuth';
import { moveInterests } from '@/lib/connect/recruiter/claim';

export const dynamic = 'force-dynamic';

// POST { sourcedJobId } — the platform owner confirms an unverified claimer speaks for
// the club; the confirmed-interest candidates then move into their pipeline.
export async function POST(req: Request) {
  const gate = await requireOwner();
  if ('response' in gate) return gate.response;
  const body = await req.json().catch(() => ({}));
  if (typeof body.sourcedJobId !== 'string') return NextResponse.json({ error: 'sourcedJobId required' }, { status: 400 });
  try {
    const moved = await moveInterests(body.sourcedJobId);
    return NextResponse.json({ ok: true, moved });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

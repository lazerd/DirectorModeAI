/**
 * PATCH { status: 'approved' | 'declined' } → the director's Yes or Skip on a staff proposal.
 * Only a proposal can be decided, only once, and only by an owner or director.
 */
import { NextResponse } from 'next/server';
import { proshopCaller, canDecide, taskOut } from '@/lib/proshop/server';
import { blockIfDemo } from '@/lib/demo/server';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await proshopCaller();
  if (!c.ok) return NextResponse.json({ error: c.error }, { status: c.status });
  const demo = await blockIfDemo(c.ctx.userId);
  if (demo) return demo;
  if (!canDecide(c.ctx)) {
    return NextResponse.json({ error: 'Only the club owner or director can say yes.' }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const status = body?.status;
  if (status !== 'approved' && status !== 'declined') {
    return NextResponse.json({ error: 'Yes or Skip only.' }, { status: 400 });
  }
  const { data, error } = await c.ctx.db
    .from('proshop_tasks')
    .update({ status, decided_at: new Date().toISOString(), decided_by: c.ctx.userId, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('club_id', c.ctx.clubId)
    .eq('status', 'proposed')
    .select('*')
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Couldn't save that. Try again." }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'That one was already decided.' }, { status: 409 });
  return NextResponse.json({ task: taskOut(data) });
}

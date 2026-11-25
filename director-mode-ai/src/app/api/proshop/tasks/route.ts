/**
 * POST { agent, text, play?, run? } → put an order on the club's board (status 'waiting').
 * An order never sends, books or charges by itself: staff prepare it and bring it back
 * as a proposal for the director's yes.
 */
import { NextResponse } from 'next/server';
import { proshopCaller, addOrder } from '@/lib/proshop/server';
import { blockIfDemo } from '@/lib/demo/server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const c = await proshopCaller();
  if (!c.ok) return NextResponse.json({ error: c.error }, { status: c.status });
  const demo = await blockIfDemo(c.ctx.userId);
  if (demo) return demo;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.text !== 'string' || !body.text.trim()) {
    return NextResponse.json({ error: 'Tell your staff what you need.' }, { status: 400 });
  }
  try {
    const task = await addOrder(c.ctx, { agent: String(body.agent ?? ''), text: body.text, play: body.play, run: body.run });
    return NextResponse.json({ task });
  } catch (e: any) {
    console.error('proshop order failed:', e);
    return NextResponse.json({ error: "Couldn't put that on the board. Try again." }, { status: 500 });
  }
}

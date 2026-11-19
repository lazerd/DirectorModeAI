import { NextResponse } from 'next/server';
import { act, PlayError, view } from '@/lib/play/server';

export const dynamic = 'force-dynamic';
const keyOf = (req: Request) => req.headers.get('x-play-key');

export async function GET(req: Request, { params }: { params: { code: string } }) {
  const e = await view(params.code, keyOf(req));
  if (!e) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(e, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request, { params }: { params: { code: string } }) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const out = await act(params.code, keyOf(req), body);
    const key = out.playerKey ?? keyOf(req);
    const e = await view(out.code && body.action !== 'runback' ? out.code : params.code, key);
    return NextResponse.json({ ...out, event: e });
  } catch (e) {
    const err = e instanceof PlayError ? e : new PlayError(e instanceof Error ? e.message : 'Something went wrong', 500);
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
}

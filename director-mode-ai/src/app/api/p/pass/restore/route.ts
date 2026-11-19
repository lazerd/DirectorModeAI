import { NextResponse } from 'next/server';
import { confirmRestoreCode, sendRestoreCode } from '@/lib/play/notify';

/** Move a hosting pass to this phone: {email} → emails a code; {email, code} → adds this phone. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { email?: string; code?: string; hostId?: string };
  const hostId = typeof b.hostId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(b.hostId) ? b.hostId : null;
  if (!hostId || !b.email) return NextResponse.json({ error: 'Missing email' }, { status: 400 });
  if (b.code) return NextResponse.json({ ok: await confirmRestoreCode(b.email, hostId, b.code) });
  const r = await sendRestoreCode(b.email, hostId);
  // Same answer either way so this can't be used to test which emails have passes.
  void r;
  return NextResponse.json({ sent: true });
}

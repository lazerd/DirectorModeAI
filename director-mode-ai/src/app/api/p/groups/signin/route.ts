import { NextResponse } from 'next/server';
import { PlayError } from '@/lib/play/server';
import { sendSignInLink } from '@/lib/play/groupsServer';

/** Email a passwordless sign-in link that returns to `next` (a /p or /play page). */
export async function POST(req: Request) {
  try {
    const b = (await req.json()) as { email?: string; next?: string };
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
    await sendSignInLink(b.email, b.next, ip);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const err = e instanceof PlayError ? e : new PlayError('Could not send the link. Try again.', 500);
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
}

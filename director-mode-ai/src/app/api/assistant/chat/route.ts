import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { aiConfigured, meterFor, runChat, type ChatTurn } from '@/lib/assistant/runChat';

export const dynamic = 'force-dynamic';
// A confirmed member email goes out at ~2/sec (comms pack caps a send at 300).
export const maxDuration = 300;

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const b = rateBuckets.get(key);
  if (!b || b.resetAt < now) { rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS }); return true; }
  if (b.count >= RATE_LIMIT_MAX) return false;
  b.count++; return true;
}

/** The meter, for the widget to show before the first message is sent. */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ meter: null }, { status: 401 });
  const { meter, paygUrl } = await meterFor(user);
  return NextResponse.json({ meter, entitled: true, paygUrl });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ kind: 'error', message: 'Please log in to use the assistant.' }, { status: 401 });
  if (!checkRateLimit(user.id)) return NextResponse.json({ kind: 'error', message: 'You are sending messages too fast — give it a moment.' }, { status: 429 });
  if (!aiConfigured()) return NextResponse.json({ kind: 'error', message: 'Assistant not configured (missing ANTHROPIC_API_KEY).' }, { status: 503 });

  const body = await req.json().catch(() => null);
  const message = (body?.message as string | undefined)?.trim();
  if (!message) return NextResponse.json({ kind: 'error', message: 'Missing message' }, { status: 400 });
  const history = (body?.history as ChatTurn[] | undefined) ?? [];
  const page = (body?.page as string | undefined)?.trim();

  const r = await runChat({ user, message, history, page, channel: 'web' });
  if (!r.ok) {
    return NextResponse.json(
      { kind: 'error', message: r.message, meter: r.meter ?? undefined, ...(r.paygUrl !== undefined ? { paygUrl: r.paygUrl } : {}) },
      { status: r.status },
    );
  }
  return NextResponse.json({ kind: 'message', text: r.text, meter: r.meter });
}

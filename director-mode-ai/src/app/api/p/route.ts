import { NextResponse } from 'next/server';
import { createEvent, PlayError } from '@/lib/play/server';
import type { PlayDraft } from '@/lib/play/core';

/** Make an event. No account: the response's hostKey is the host's only credential. */
export async function POST(req: Request) {
  try {
    const b = (await req.json()) as { draft?: Partial<PlayDraft>; host?: { name?: string; playing?: boolean; gender?: 'male' | 'female' | null }; source?: string };
    const made = await createEvent(b.draft ?? {}, b.host ?? {}, { source: b.source });
    return NextResponse.json(made);
  } catch (e) {
    const err = e instanceof PlayError ? e : new PlayError('Something went wrong', 500);
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
}

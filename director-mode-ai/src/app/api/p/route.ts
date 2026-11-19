import { NextResponse } from 'next/server';
import { createEvent, PlayError } from '@/lib/play/server';
import { nearbyNeedOne } from '@/lib/play/notify';
import { hostingAllowed, passCheckoutUrl, PASS_PRICES } from '@/lib/play/passes';
import type { PlayDraft } from '@/lib/play/core';

/**
 * Make an event. No account: the response's hostKey is the host's only credential.
 * A device's first event is free; after that it needs a Host or Club Pass (402 + checkout links).
 */
export async function POST(req: Request) {
  try {
    const b = (await req.json()) as { draft?: Partial<PlayDraft>; host?: { name?: string; playing?: boolean; gender?: 'male' | 'female' | null }; source?: string; hostId?: string; clubCode?: string; clubName?: string };
    const hostId = typeof b.hostId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(b.hostId) ? b.hostId : null;
    const clubCode = typeof b.clubCode === 'string' && /^[a-z0-9]{4,20}$/.test(b.clubCode) ? b.clubCode : null;
    const gate = await hostingAllowed(hostId, clubCode);
    // Until the LemonSqueezy buy links are configured nobody is blocked.
    if (!gate.ok && hostId && passCheckoutUrl('host', hostId)) {
      return NextResponse.json({
        error: 'PAYWALL',
        paywall: { prices: PASS_PRICES, host: passCheckoutUrl('host', hostId), club: passCheckoutUrl('club', hostId, b.clubName) },
      }, { status: 402 });
    }
    const made = await createEvent(b.draft ?? {}, b.host ?? {}, { source: b.source, hostId, clubCode });
    if (b.draft?.listed) await nearbyNeedOne(made.code).catch(() => {});
    return NextResponse.json(made);
  } catch (e) {
    const err = e instanceof PlayError ? e : new PlayError('Something went wrong', 500);
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
}

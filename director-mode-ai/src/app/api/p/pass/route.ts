import { NextResponse } from 'next/server';
import { activePass, freeEventsUsed, passCheckoutUrl, PASS_PRICES } from '@/lib/play/passes';

export const dynamic = 'force-dynamic';

/** This device's hosting status: free event used? pass? club link? and checkout links. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const hostId = u.searchParams.get('host_id');
  const club = u.searchParams.get('club');
  const id = hostId && /^[A-Za-z0-9_-]{8,64}$/.test(hostId) ? hostId : null;
  const code = club && /^[a-z0-9]{4,20}$/.test(club) ? club : null;
  const pass = await activePass(id, code);
  return NextResponse.json({
    pass: pass ? { kind: pass.kind, club_code: pass.club_code, club_name: pass.club_name, ends_at: pass.ends_at } : null,
    freeUsed: id ? (await freeEventsUsed(id)) > 0 : false,
    prices: PASS_PRICES,
    checkout: id ? { host: passCheckoutUrl('host', id), club: passCheckoutUrl('club', id) } : null,
  }, { headers: { 'Cache-Control': 'no-store' } });
}

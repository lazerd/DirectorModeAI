/**
 * /api/checkin/q/[token] — a printed sign.
 *
 * Public, no login. The token IS the authorisation: it names one space at one
 * club, it is unguessable, and reprinting a sign rotates it so an old one
 * stops working. A bad or rotated token is a plain 404 with nothing in it.
 *
 *   GET   what the phone should show: is the court free, who is on it, the line
 *   POST  { action: 'start' | 'wait', play_type, names[], email?, guests?,
 *           guest_names?, first_is_me?, wait_token?, lat?, lng? }
 */

import { NextResponse } from 'next/server';
import { joinWait, startCourt, startVisit } from '@/lib/checkin/actions';
import {
  clamp,
  deviceHash,
  geofenceError,
  parseEmail,
  parseNames,
  parsePlayType,
  playersFrom,
  rateLimit,
  signedInPlayer,
} from '@/lib/checkin/http';
import { getSettings, isGroupToken, reconcileClub, spaceByToken } from '@/lib/checkin/server';
import { scanView } from '@/lib/checkin/views';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const notFound = () =>
  NextResponse.json({ error: 'This sign is no longer active. Look for a newer sign, or ask at the front desk.' }, { status: 404 });

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const limited = rateLimit(req, 'read');
  if (limited) return limited;
  const { token } = await params;
  const found = await spaceByToken(token);
  if (!found) return notFound();

  const g = new URL(req.url).searchParams.get('g');
  const state = await reconcileClub(found.club);
  return NextResponse.json(scanView(state, found.space, g && isGroupToken(g) ? g : null), {
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const limited = rateLimit(req, 'write');
  if (limited) return limited;
  try {
    const { token } = await params;
    const found = await spaceByToken(token);
    if (!found) return notFound();
    const { club, space } = found;
    if (!space.active) return NextResponse.json({ error: `${space.name} is closed right now.` }, { status: 409 });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const settings = await getSettings(club.id);
    const geo = geofenceError(settings, body);
    if (geo) return NextResponse.json({ error: geo, code: 'geofence' }, { status: 403 });

    const names = parseNames(body.names);
    if (names.length === 0) return NextResponse.json({ error: 'Type your name to check in.' }, { status: 400 });
    const { email, error: emailError } = parseEmail(body.email);
    if (emailError) return NextResponse.json({ error: emailError }, { status: 400 });

    const me = await signedInPlayer(club.id);
    const players = playersFrom(names, me, body.first_is_me === true);
    const userId = me?.member ? me.userId : null;
    const device = deviceHash(req);
    const action = body.action === 'wait' ? 'wait' : 'start';

    let result;
    if (space.kind === 'court' || space.kind === 'kiosk') {
      const playType = parsePlayType(body.play_type);
      if (!playType) return NextResponse.json({ error: 'Pick singles or doubles.' }, { status: 400 });
      if (action === 'wait' || space.kind === 'kiosk') {
        result = await joinWait({ club, viaSpace: space, playType, players, email, userId, device });
      } else {
        const waitToken = clamp(body.wait_token, 64);
        result = await startCourt({
          club,
          space,
          playType,
          players,
          email,
          userId,
          device,
          waitToken: waitToken && isGroupToken(waitToken) ? waitToken : null,
        });
      }
    } else {
      const guests = Math.max(0, Math.min(20, Math.floor(Number(body.guests) || 0)));
      result = await startVisit({
        club,
        space,
        names,
        players,
        guestCount: guests,
        guestNames: parseNames(body.guest_names, 20),
        email,
        userId,
        device,
      });
    }

    if (!result.ok) {
      return NextResponse.json({ error: result.error, code: result.code, until: result.until }, { status: result.status });
    }
    return NextResponse.json({ ok: true, group_token: result.groupToken, url: `/q/s/${result.groupToken}` });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Something went wrong.' }, { status: 500 });
  }
}

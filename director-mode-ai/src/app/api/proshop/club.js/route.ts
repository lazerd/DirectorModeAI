/**
 * GET /api/proshop/club.js → `window.CLUB = {...}` for the signed-in director's club.
 *
 * The /proshop page (public/proshop/index.html) loads this as a plain script before its
 * own code runs, so the page can render synchronously with the club's name, staff and
 * plays. Live board data (orders, proposals) comes from /api/proshop/state afterward.
 * Not signed in, or no club: `window.CLUB = { signin: true, ... }` and the page shows
 * a sign-in card instead of the shop.
 */
import { proshopCaller } from '@/lib/proshop/server';
import { STAFF, PLAYS, HINTS } from '@/lib/proshop/staff';

export const dynamic = 'force-dynamic';

const js = (obj: unknown) =>
  new Response(`window.CLUB=${JSON.stringify(obj).replace(/</g, '\\u003c')};`, {
    headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' },
  });

const shortName = (club: string) =>
  club.replace(/\s+(country club|racquet club|tennis club|swim (&|and) tennis club|athletic club|club)$/i, '').trim();

export async function GET() {
  const c = await proshopCaller();
  const base = {
    agents: STAFF.map((s) => ({ ...s, now: ['Ready when you are.'] })),
    plays: PLAYS,
    hints: HINTS,
    pills: [],
    huddle: [],
    huddleTotal: '',
    letter: null,
    score: [],
    clubmode: true,
  };
  if (!c.ok) {
    return js({ ...base, signin: true, needsClub: c.status === 403, signinMessage: c.error, name: 'Pro Shop', club: 'ClubMode', place: '', director: 'you', software: 'your club software' });
  }
  const { ctx } = c;
  return js({
    ...base,
    name: `${shortName(ctx.clubName) || ctx.clubName} Pro Shop`,
    club: ctx.clubName,
    place: '',
    director: 'you',
    software: 'your club software',
    role: ctx.role,
  });
}

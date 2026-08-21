/**
 * One tap. The "Yes — I'll be there" button in the lineup email points straight
 * here, this records the confirmation, and the player lands on a page that
 * already says they're confirmed. No second tap, no JavaScript.
 *
 * A GET that mutates is normally wrong, but an email button cannot POST, and a
 * player who has to tap twice — once in the email, once on a page that needs to
 * hydrate before its button does anything — is a player who gives up. The
 * scanner guard in isRealNavigation() is what makes the GET safe enough.
 *
 * Declining deliberately does NOT get this treatment: it stays a POST behind a
 * real form, because a mis-tap that pulls someone out of a match and pages the
 * captain is far worse than a mis-tap that says "I'm in".
 */
import { NextResponse } from 'next/server';
import { applyAnswer, isRealNavigation } from '@/lib/captain/confirmAnswer';

type Ctx = { params: { token: string; matchId: string } };

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: Ctx) {
  const to = new URL(req.url);
  to.pathname = `/captain/confirm/${params.token}/${params.matchId}`;
  to.search = '';

  if (isRealNavigation(req)) {
    const result = await applyAnswer(params.token, params.matchId, 'in');
    if (!result.ok) to.searchParams.set('e', result.error);
  } else {
    // A scanner, a prefetch, or a client too old to say. Show the page with a
    // working button rather than recording an answer nobody gave.
    to.searchParams.set('a', 'in');
  }

  // 303 so a reload of the destination never replays the confirm.
  return NextResponse.redirect(to, 303);
}

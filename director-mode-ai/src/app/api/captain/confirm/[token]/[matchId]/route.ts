/**
 * Records "I'll be there" / "I can't play".
 *
 * Two body shapes, because two very different clients post here:
 *   - a plain <form> on the confirm page (urlencoded) -> 303 back to the page,
 *     so the whole flow works with JavaScript switched off. This is the one
 *     that matters: players open these links inside mail-app webviews, and a
 *     button that needs React to hydrate before it does anything is a button
 *     that sometimes does nothing.
 *   - JSON -> JSON, kept for lineup emails already sitting in inboxes.
 *
 * No auth: the player token is the credential.
 */
import { NextResponse } from 'next/server';
import { applyAnswer, type Answer } from '@/lib/captain/confirmAnswer';

type Ctx = { params: { token: string; matchId: string } };

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: Ctx) {
  const type = req.headers.get('content-type') || '';
  const isForm =
    type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data');

  let action: Answer = 'in';
  let note: string | null = null;

  if (isForm) {
    const form = await req.formData();
    action = form.get('action') === 'out' ? 'out' : 'in';
    note = (form.get('note') as string) || null;
  } else {
    // Lineup emails sent before the form rewrite POST with no body at all, and
    // that has always meant "I'm in".
    const body = ((await req.json().catch(() => ({}))) || {}) as { action?: string; note?: string };
    action = body.action === 'out' ? 'out' : 'in';
    note = body.note || null;
  }

  const result = await applyAnswer(params.token, params.matchId, action, note);

  if (!isForm) {
    return result.ok
      ? NextResponse.json({ ok: true, name: result.name, action: result.action, court: result.court })
      : NextResponse.json({ error: result.error }, { status: result.status });
  }

  const to = new URL(req.url);
  to.pathname = `/captain/confirm/${params.token}/${params.matchId}`;
  to.search = '';
  if (!result.ok) to.searchParams.set('e', result.error);
  return NextResponse.redirect(to, 303);
}

import { NextResponse } from 'next/server';
import { unsubscribe } from '@/lib/play/groupsServer';

/**
 * POST ?t=<token>[&scope=host|all]. The unsubscribe page's "stop all" buttons post here
 * (a form, so it works without JavaScript), and a mail client's one-click POST lands
 * here too. A GET of the page itself already unsubscribed the token's group.
 */
export async function POST(req: Request) {
  const u = new URL(req.url);
  let t = u.searchParams.get('t');
  let scope = u.searchParams.get('scope');
  const ct = req.headers.get('content-type') || '';
  if (ct.includes('form')) {
    const f = await req.formData().catch(() => null);
    t = (f?.get('t') as string | null) ?? t;
    scope = (f?.get('scope') as string | null) ?? scope;
  }
  const s = scope === 'host' || scope === 'all' ? scope : 'token';
  const r = await unsubscribe(t, s);
  if (ct.includes('form')) {
    const to = new URL('/play/unsubscribe', u.origin);
    to.searchParams.set('done', r ? s : 'bad');
    if (t) to.searchParams.set('t', t);
    return NextResponse.redirect(to, 303);
  }
  return NextResponse.json({ ok: !!r }, { status: r ? 200 : 400 });
}

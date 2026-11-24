import { checkAuthorize, issueAuthCode, originOf, verifyLoginCode, type AuthorizeParams } from '@/lib/play/mcpAuth';
import { json, oauthFail } from '@/lib/play/oauthHttp';

/** Step 2: a correct code signs the organizer in and sends them back to Claude / ChatGPT. */
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  try {
    const b = (await req.json()) as { params: AuthorizeParams; email: string; code: string };
    await checkAuthorize(b.params);
    const org = await verifyLoginCode(String(b.email ?? ''), String(b.code ?? ''));
    const code = await issueAuthCode(b.params, org.id);
    const back = new URL(b.params.redirect_uri);
    back.searchParams.set('code', code);
    if (b.params.state) back.searchParams.set('state', b.params.state);
    back.searchParams.set('iss', originOf(req));
    return json({ redirect: back.toString() });
  } catch (e) { return oauthFail(e); }
}

import { checkAuthorize, sendLoginCode, type AuthorizeParams } from '@/lib/play/mcpAuth';
import { clientIp, json, oauthFail } from '@/lib/play/oauthHttp';

/** Step 1 of the sign-in page: email a 6-digit code (only for a valid authorize request). */
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  try {
    const b = (await req.json()) as { params: AuthorizeParams; email: string };
    const { clientName } = await checkAuthorize(b.params);
    await sendLoginCode(String(b.email ?? ''), clientIp(req), clientName);
    return json({ ok: true });
  } catch (e) { return oauthFail(e); }
}

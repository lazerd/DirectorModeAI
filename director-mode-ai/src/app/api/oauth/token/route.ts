import { exchangeCode, OAuthError, refreshTokens } from '@/lib/play/mcpAuth';
import { json, oauthFail, preflight, readBody } from '@/lib/play/oauthHttp';

export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  try {
    const f = await readBody(req);
    if (f.grant_type === 'authorization_code') return json(await exchangeCode(f));
    if (f.grant_type === 'refresh_token') return json(await refreshTokens(f));
    throw new OAuthError('unsupported_grant_type', 'Use authorization_code or refresh_token.');
  } catch (e) { return oauthFail(e); }
}
export const OPTIONS = preflight;

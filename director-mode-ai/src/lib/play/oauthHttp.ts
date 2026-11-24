import 'server-only';
import { OAuthError } from './mcpAuth';

/** Shared bits for the OAuth endpoints: CORS (browser-based clients) and RFC 6749 error bodies. */
export const OAUTH_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization, mcp-protocol-version',
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...OAUTH_CORS } });

export function oauthFail(e: unknown) {
  if (e instanceof OAuthError) return json({ error: e.code, error_description: e.message }, e.status);
  console.error('[rirl-oauth]', e);
  return json({ error: 'server_error', error_description: 'Something went wrong. Try again.' }, 500);
}

export const preflight = () => new Response(null, { status: 204, headers: OAUTH_CORS });

/** Token endpoints take form bodies (RFC 6749); accept JSON too. */
export async function readBody(req: Request): Promise<Record<string, string>> {
  const t = req.headers.get('content-type') ?? '';
  if (t.includes('application/json')) {
    const j = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(j).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  }
  return Object.fromEntries(new URLSearchParams(await req.text()));
}

export const clientIp = (req: Request) => (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null;

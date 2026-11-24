import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { buildRirlServer } from '@/lib/play/mcp';
import { organizerFor, originOf, SCOPE } from '@/lib/play/mcpAuth';

/**
 * Racquets IRL MCP server (Streamable HTTP), for Claude and ChatGPT connectors:
 * https://clubmode.ai/api/mcp
 *
 * Stateless: a fresh server per request, JSON replies, no SSE stream held open
 * (keeps Vercel CPU to the work itself). The organizer signs in once (OAuth with an emailed
 * code, lib/play/mcpAuth); every request carries their bearer token. Game pages stay no-login.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // end_game writes the AI recap

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, accept, authorization, mcp-session-id, mcp-protocol-version, last-event-id',
  'Access-Control-Expose-Headers': 'mcp-session-id, mcp-protocol-version',
};

async function handle(req: Request): Promise<Response> {
  const org = await organizerFor(req);
  if (!org) {
    // RFC 9728: point the client (Claude, ChatGPT) at our sign-in. Only AI connections sign in;
    // the game pages themselves never do.
    const meta = `${originOf(req)}/.well-known/oauth-protected-resource`;
    return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Sign in to connect Racquets IRL.' }, id: null }), {
      status: 401,
      headers: { 'content-type': 'application/json', 'WWW-Authenticate': `Bearer resource_metadata="${meta}", scope="${SCOPE}"`, ...CORS },
    });
  }
  const server = buildRirlServer(org);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    const res = await transport.handleRequest(req);
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
    return new Response(res.body, { status: res.status, headers });
  } finally {
    // JSON mode: the reply is complete once handleRequest returns.
    void server.close().catch(() => {});
  }
}

export const POST = handle;
export const DELETE = handle;
/** Stateless server: no standalone SSE stream to offer. A person opening the URL in a browser gets the setup page. */
export async function GET(req: Request) {
  if ((req.headers.get('accept') ?? '').includes('text/html')) return Response.redirect(new URL('/play/ai', req.url), 307);
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed. POST JSON-RPC to this endpoint.' }, id: null }), {
    status: 405, headers: { 'content-type': 'application/json', Allow: 'POST, DELETE, OPTIONS', ...CORS },
  });
}
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

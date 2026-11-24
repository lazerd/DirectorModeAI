import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { buildRirlServer } from '@/lib/play/mcp';

/**
 * Racquets IRL MCP server (Streamable HTTP), for Claude and ChatGPT connectors:
 * https://clubmode.ai/api/mcp
 *
 * Stateless: a fresh server per request, JSON replies, no SSE stream held open
 * (keeps Vercel CPU to the work itself). No login: each game's host key is the credential.
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
  const server = buildRirlServer();
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
/** Stateless server: no standalone SSE stream to offer. */
export async function GET() {
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed. POST JSON-RPC to this endpoint.' }, id: null }), {
    status: 405, headers: { 'content-type': 'application/json', Allow: 'POST, DELETE, OPTIONS', ...CORS },
  });
}
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

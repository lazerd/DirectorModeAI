/**
 * OpenAI app directory domain verification for the Racquets IRL MCP server (clubmode.ai/api/mcp).
 * The portal shows a token; set it as OPENAI_APPS_CHALLENGE in Vercel. This returns exactly that
 * token as plain text (no JSON, no newline), as OpenAI requires. 404 until it's set.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  const token = (process.env.OPENAI_APPS_CHALLENGE ?? '').trim();
  if (!token) return new Response('Not found', { status: 404 });
  return new Response(token, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}

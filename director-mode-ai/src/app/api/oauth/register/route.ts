import { registerClient } from '@/lib/play/mcpAuth';
import { json, oauthFail, preflight } from '@/lib/play/oauthHttp';

/** RFC 7591 dynamic client registration (Claude, ChatGPT). Public clients with PKCE. */
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  try { return json(await registerClient((await req.json().catch(() => ({}))) as Record<string, unknown>), 201); } catch (e) { return oauthFail(e); }
}
export const OPTIONS = preflight;

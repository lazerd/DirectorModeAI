import { originOf, protectedResourceMetadata } from '@/lib/play/mcpAuth';
import { json, preflight } from '@/lib/play/oauthHttp';

/** RFC 9728: /api/mcp is protected by clubmode.ai's own sign-in. */
export const dynamic = 'force-dynamic';
export const GET = (req: Request) => json(protectedResourceMetadata(originOf(req)));
export const OPTIONS = preflight;

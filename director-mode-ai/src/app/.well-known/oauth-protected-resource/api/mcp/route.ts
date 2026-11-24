import { originOf, protectedResourceMetadata } from '@/lib/play/mcpAuth';
import { json, preflight } from '@/lib/play/oauthHttp';

export const dynamic = 'force-dynamic';
export const GET = (req: Request) => json(protectedResourceMetadata(originOf(req)));
export const OPTIONS = preflight;

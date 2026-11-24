import { authServerMetadata, originOf } from '@/lib/play/mcpAuth';
import { json, preflight } from '@/lib/play/oauthHttp';

/** RFC 8414 metadata for the Racquets IRL AI connector sign-in. */
export const dynamic = 'force-dynamic';
export const GET = (req: Request) => json(authServerMetadata(originOf(req)));
export const OPTIONS = preflight;

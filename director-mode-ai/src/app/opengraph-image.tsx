import { ImageResponse } from 'next/og';
import { ShareCard, SHARE_CARD_ALT, SHARE_CARD_SIZE } from '@/lib/brandImage';

/**
 * The link-preview image Gmail, iMessage and Slack show when someone pastes a
 * clubmode.ai link. Lives at the app root, so every route inherits it unless a
 * segment ships its own opengraph-image.
 */
// Edge, not Node: the Node build of @vercel/og resolves its bundled font through
// fileURLToPath, which throws ERR_INVALID_URL on Windows. Edge loads it as an asset.
export const runtime = 'edge';
export const alt = SHARE_CARD_ALT;
export const size = SHARE_CARD_SIZE;
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(<ShareCard />, size);
}

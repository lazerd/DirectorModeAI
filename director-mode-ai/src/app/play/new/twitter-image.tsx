import { ImageResponse } from 'next/og';
import { RirlShareCard, RIRL_CARD_ALT, RIRL_CARD_SIZE } from '@/lib/play/rirlShareCard';

// Racquets IRL link preview (Edge: the Node build of @vercel/og breaks on Windows paths).
export const runtime = 'edge';
export const alt = RIRL_CARD_ALT;
export const size = RIRL_CARD_SIZE;
export const contentType = 'image/png';

export default function Image() {
  return new ImageResponse(<RirlShareCard />, size);
}

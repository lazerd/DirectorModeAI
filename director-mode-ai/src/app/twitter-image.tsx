import { ImageResponse } from 'next/og';
import { ShareCard, SHARE_CARD_ALT, SHARE_CARD_SIZE } from '@/lib/brandImage';

/** Same card as opengraph-image; X/Twitter reads its own tag. */
export const runtime = 'edge'; // see opengraph-image.tsx
export const alt = SHARE_CARD_ALT;
export const size = SHARE_CARD_SIZE;
export const contentType = 'image/png';

export default function TwitterImage() {
  return new ImageResponse(<ShareCard />, size);
}

import { ImageResponse } from 'next/og';
import { MixerShareCard, MIXER_SHARE_CARD_ALT, SHARE_CARD_SIZE } from '@/lib/brandImage';

// Edge for the same Windows font-path reason as app/opengraph-image.tsx.
export const runtime = 'edge';
export const alt = MIXER_SHARE_CARD_ALT;
export const size = SHARE_CARD_SIZE;
export const contentType = 'image/png';

export default function Image() {
  return new ImageResponse(<MixerShareCard />, size);
}

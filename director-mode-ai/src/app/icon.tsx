import { ImageResponse } from 'next/og';
import { BrandMark } from '@/lib/brandImage';

/** Browser-tab favicon: the lime square + bolt. */
export const runtime = 'edge'; // see opengraph-image.tsx
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(<BrandMark size={32} />, size);
}

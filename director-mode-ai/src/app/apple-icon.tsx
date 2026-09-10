import { ImageResponse } from 'next/og';
import { BRAND, BrandMark } from '@/lib/brandImage';

/**
 * Home-screen icon for iOS. iOS rounds the corners itself, so the mark sits on a
 * full-bleed lime square rather than a pre-rounded one.
 */
export const runtime = 'edge'; // see opengraph-image.tsx
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: BRAND.lime }}>
        <BrandMark size={180} />
      </div>
    ),
    size,
  );
}

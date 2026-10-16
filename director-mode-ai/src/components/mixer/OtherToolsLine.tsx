import Link from 'next/link';
import { PRODUCT_COUNT } from '@/config/nav';

/**
 * The one bridge from the free MixerMode pages to the rest of ClubMode.
 * Points at the homepage tool grid, not /tools — /tools is behind login and
 * a campaign visitor has no account. "Other" = every product but MixerMode.
 */
export default function OtherToolsLine({ className = '', product = 'MixerMode' }: { className?: string; product?: string }) {
  return (
    <p className={`text-sm text-white/50 text-center ${className}`}>
      Enjoying {product}? We have {PRODUCT_COUNT - 1} other tools you might like.{' '}
      <Link href="/#tools" className="text-[#D3FB52] hover:underline whitespace-nowrap">
        Check them out
      </Link>
    </p>
  );
}

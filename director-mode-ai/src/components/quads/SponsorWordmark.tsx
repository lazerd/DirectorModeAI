import type { Sponsor } from '@/config/sponsors';

/**
 * Sponsor wordmark. Uses the sponsor's approved logo asset when one has been
 * supplied (`logoUrl`), otherwise renders a typographic mark in their colors —
 * we don't ship third-party trademarked artwork we weren't given.
 */
export default function SponsorWordmark({
  sponsor,
  size = 'md',
  onDark = false,
}: {
  sponsor: Sponsor;
  size?: 'sm' | 'md' | 'lg';
  onDark?: boolean;
}) {
  const px = size === 'lg' ? 40 : size === 'sm' ? 18 : 26;

  if (sponsor.logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={sponsor.logoUrl}
        alt={sponsor.name}
        style={{ height: px, width: 'auto' }}
        className="object-contain"
      />
    );
  }

  const [head, ...rest] = sponsor.name.split("'");
  const hasApostrophe = rest.length > 0;

  return (
    <span
      aria-label={sponsor.name}
      style={{
        fontSize: px,
        lineHeight: 1,
        fontWeight: 800,
        letterSpacing: '-0.02em',
        color: onDark ? '#FFFFFF' : sponsor.colors.primary,
        fontFamily:
          'ui-rounded, "SF Pro Rounded", "Segoe UI", system-ui, -apple-system, sans-serif',
      }}
    >
      {head}
      {hasApostrophe && (
        <span style={{ color: onDark ? '#FFFFFF' : sponsor.colors.secondary }}>
          &rsquo;{rest.join("'")}
        </span>
      )}
    </span>
  );
}

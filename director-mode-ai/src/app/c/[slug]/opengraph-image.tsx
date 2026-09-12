import { ImageResponse } from 'next/og';
import { getClubSite } from '@/lib/clubSite/server';
import { readableOn } from '@/lib/clubSite/theme';
import { SHARE_CARD_SIZE } from '@/lib/brandImage';

/**
 * The link preview for a club's own site.
 *
 * Without this, a club texting its new website to its members gets ClubMode's
 * card — our name and our colors on their link. This renders the club's, from
 * its own palette, so a second club's card differs with no code change.
 *
 * Two Satori rules, learned the hard way in lib/brandImage.tsx:
 *   - No external images. A club's logo_url lives on Supabase storage and
 *     fetching it here either fails or blocks the render, so the mark is
 *     typographic — the wordmark branch of SponsorWordmark's fallback.
 *   - Any element with more than one child must be display:flex.
 */
// Edge, not Node: the Node build of @vercel/og resolves its bundled font
// through fileURLToPath, which throws ERR_INVALID_URL on Windows.
export const runtime = 'edge';
export const size = SHARE_CARD_SIZE;
export const contentType = 'image/png';

export const alt = 'Club website';

export default async function ClubOpengraphImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const bundle = await getClubSite(slug);

  // No club, no bespoke card — an ImageResponse must still be returned, or the
  // route 500s and every share of the link shows a broken image.
  if (!bundle) {
    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#001820',
            color: '#D3FB52',
            fontSize: 56,
            fontWeight: 700,
          }}
        >
          ClubMode
        </div>
      ),
      size,
    );
  }

  const { club, site, theme } = bundle;
  const onPrimary = readableOn(theme.primary);
  const where = [club.city, club.state].filter(Boolean).join(', ');
  const sports = (club.sports || []).slice(0, 3).join(' · ');
  const tagline = site.hero_subhead || club.description || '';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: theme.primary,
          color: onPrimary,
          padding: 72,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              fontSize: 22,
              letterSpacing: 6,
              textTransform: 'uppercase',
              color: theme.secondary,
              fontWeight: 700,
            }}
          >
            {where || 'Racquet Club'}
          </div>
          <div
            style={{
              fontSize: club.name.length > 28 ? 68 : 88,
              fontWeight: 800,
              lineHeight: 1.05,
              marginTop: 18,
              display: 'flex',
            }}
          >
            {club.name}
          </div>
          {tagline ? (
            <div
              style={{
                fontSize: 30,
                marginTop: 22,
                opacity: 0.82,
                display: 'flex',
                maxWidth: 940,
              }}
            >
              {tagline.length > 120 ? `${tagline.slice(0, 117)}…` : tagline}
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {sports ? (
              <div style={{ fontSize: 26, textTransform: 'capitalize', opacity: 0.85 }}>
                {sports}
              </div>
            ) : null}
            {club.phone ? (
              <div style={{ fontSize: 26, opacity: 0.7, marginTop: 6 }}>{club.phone}</div>
            ) : null}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              background: theme.secondary,
              color: readableOn(theme.secondary),
              borderRadius: 12,
              padding: '12px 22px',
              fontSize: 24,
              fontWeight: 700,
            }}
          >
            {`clubmode.ai/c/${club.slug}`}
          </div>
        </div>
      </div>
    ),
    size,
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getClubSite } from '@/lib/clubSite/server';
import { readableOn, tint } from '@/lib/clubSite/theme';
import BookCourt from './BookCourt';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const bundle = await getClubSite(slug);
  if (!bundle) return { title: 'Not found' };
  return {
    title: `Book a court — ${bundle.club.name}`,
    description: `Reserve a court at ${bundle.club.name}.`,
    alternates: { canonical: `/c/${bundle.club.slug}/courts/book` },
  };
}

export default async function BookCourtPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bundle = await getClubSite(slug);
  if (!bundle) notFound();
  const { club, theme } = bundle;

  return (
    <div className="mx-auto max-w-3xl px-5 py-12">
      <Link
        href={`/c/${club.slug}/courts`}
        className="text-sm font-semibold"
        style={{ color: theme.primary }}
      >
        ← Court time
      </Link>
      <h1
        className="mt-4 text-3xl font-bold sm:text-4xl"
        style={{ fontFamily: theme.headingFamily }}
      >
        Book a court
      </h1>
      {/*
        "No account needed" on its own was the wrong half of the truth. It is
        right for a guest, and it talked a MEMBER out of signing in — which is
        the only way to be charged the member rate.
      */}
      <p className="mt-2 text-base" style={{ color: tint(theme.ink, 0.65) }}>
        Pick a time and it&apos;s yours. Guests can book without an account; members sign in for
        member rates.
      </p>

      <div className="mt-8">
        <BookCourt
          clubSlug={club.slug}
          theme={{
            primary: theme.primary,
            onPrimary: readableOn(theme.primary),
            secondary: theme.secondary,
            ink: theme.ink,
            surface: theme.surface,
            border: tint(theme.ink, 0.16),
            muted: tint(theme.ink, 0.6),
          }}
        />
      </div>
    </div>
  );
}

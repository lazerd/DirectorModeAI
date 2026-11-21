import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { view } from '@/lib/play/server';
import { awards, drawAwards, spotsLine, whenLine } from '@/lib/play/core';
import EventClient from '@/components/play/EventClient';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { code: string } }): Promise<Metadata> {
  const e = await view(params.code);
  if (!e) return { title: 'Racquets IRL' };
  const tz = 'America/Los_Angeles';
  const champ = e.status !== 'done' ? null : e.state.mixer ? awards(e.state.mixer)[0] : e.state.draw ? drawAwards(e.state.draw).find((x) => x.title === 'Champion') ?? null : null;
  const desc = champ ? `🏆 ${champ.who} took it. See the recap and awards.`
    : [whenLine(e, tz), e.location, e.status === 'open' ? spotsLine(e) + ' · tap to join' : 'Live now'].filter(Boolean).join(' · ');
  return { title: e.title, description: desc, robots: { index: false, follow: false }, openGraph: { title: e.title, description: desc }, twitter: { card: 'summary_large_image', title: e.title, description: desc } };
}

export default async function EventPage({ params }: { params: { code: string } }) {
  const e = await view(params.code);
  if (!e) notFound();
  return <EventClient code={e.code} initial={e} />;
}

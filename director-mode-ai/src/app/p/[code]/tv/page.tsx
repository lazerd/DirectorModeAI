import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { view } from '@/lib/play/server';
import TvBoard from '@/components/play/TvBoard';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { code: string } }): Promise<Metadata> {
  const e = await view(params.code);
  return { title: e ? `${e.title} · TV board` : 'Racquets IRL', robots: { index: false, follow: false } };
}

/** The TV / projector board: public and read-only (never sees a host key). */
export default async function TvPage({ params }: { params: { code: string } }) {
  const e = await view(params.code);
  if (!e) notFound();
  return <TvBoard code={e.code} initial={e} />;
}

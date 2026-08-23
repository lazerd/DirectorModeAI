import WaitBoardClient from './WaitBoardClient';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Order of play',
  description: 'Live court times and waits.',
};

export default async function WaitPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <WaitBoardClient slug={slug} />;
}

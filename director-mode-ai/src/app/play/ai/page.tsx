import type { Metadata } from 'next';
import AiConnectClient from '@/components/play/AiConnectClient';

export const metadata: Metadata = {
  title: 'Run your games from ChatGPT or Claude · Racquets IRL',
  description: 'Connect Racquets IRL to ChatGPT or Claude and set up tennis, pickleball and padel games by just asking. Players still just tap the link.',
  alternates: { canonical: '/play/ai' },
};

export default function PlayAiPage() {
  return <AiConnectClient />;
}

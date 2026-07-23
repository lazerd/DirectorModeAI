import { Suspense } from 'react';
import type { Metadata } from 'next';
import BoardPacket from './BoardPacket';

export const metadata: Metadata = {
  title: 'Board packet — CalendarMode',
  description: 'A printable year-at-a-glance for board review.',
};

// BoardPacket reads ?year= via useSearchParams, which Next requires be behind a
// Suspense boundary or the whole page opts out of static rendering.
export default function BoardPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
      <BoardPacket />
    </Suspense>
  );
}

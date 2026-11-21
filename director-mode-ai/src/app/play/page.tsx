import { redirect } from 'next/navigation';

/**
 * clubmode.ai/play lands on the Racquets IRL page (Darrin, 11/21/26).
 * The "host a game" screen lives at /play/new; old links that carry a game
 * (/play?q=…, ?club=…, ?resume=1) still go straight to it.
 */
export default function PlayPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) if (typeof v === 'string') q.set(k, v);
  if (q.has('q') || q.has('club') || q.has('resume')) redirect(`/play/new?${q.toString()}`);
  redirect('/racquetsirl');
}

/**
 * Public support page: the support URL for app directory listings (Claude, ChatGPT)
 * and anyone who needs help with ClubMode or Racquets IRL. Must stay public (not in protectedPaths).
 */
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Support — ClubMode AI · Racquets IRL',
  description: 'Get help with Racquets IRL and ClubMode, including connecting ChatGPT or Claude.',
  alternates: { canonical: '/support' },
};

const CONTACT = 'hello@clubmode.ai';

export default function SupportPage() {
  return (
    <div className="min-h-screen bg-[#001820]">
      <div className="max-w-2xl mx-auto px-6 py-14 text-white/70 text-[15px] leading-relaxed">
        <Link href="/" className="text-white/40 text-sm hover:text-white">← ClubMode</Link>
        <h1 className="text-3xl font-display text-white mt-4">Support</h1>
        <p className="mt-6">
          Questions, problems or requests (including deleting your data): email{' '}
          <a href={`mailto:${CONTACT}`} className="text-[#D3FB52] hover:underline">{CONTACT}</a>.
          A real person answers, usually within one business day.
        </p>
        <h2 className="text-lg font-display text-white mt-8">Racquets IRL</h2>
        <ul className="mt-2 list-disc pl-5 space-y-1.5">
          <li><Link href="/play/new" className="text-[#D3FB52] hover:underline">Start a game</Link>: no app, no login. Players join from the link.</li>
          <li><Link href="/play/ai" className="text-[#D3FB52] hover:underline">Run your games from ChatGPT or Claude</Link>: how to connect and what to say.</li>
          <li>Lost your host link? If you made the game in ChatGPT or Claude, ask it for the host link. Otherwise email us the game link and we&rsquo;ll help.</li>
        </ul>
        <p className="mt-10 text-white/30 text-sm">
          <Link href="/privacy" className="text-white/50 hover:text-white underline">Privacy Policy</Link>
          {' · '}
          <Link href="/terms" className="text-white/50 hover:text-white underline">Terms of Service</Link>
        </p>
      </div>
    </div>
  );
}

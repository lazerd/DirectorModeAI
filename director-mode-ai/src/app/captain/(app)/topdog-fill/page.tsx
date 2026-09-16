import Link from 'next/link';
import BookmarkletSetup from './BookmarkletSetup';

export const metadata = { title: 'Fill TopDog from ClubMode' };

export default function TopDogFillSetupPage() {
  return (
    <div className="p-6 md:p-10 max-w-3xl">
      <Link href="/captain" className="text-white/40 text-sm hover:text-white">
        ← CaptainMode
      </Link>
      <h1 className="text-3xl font-display text-white mt-2">Fill TopDog from ClubMode</h1>
      <p className="text-white/60 mt-2">
        Post a match to TopDog without retyping it. ClubMode fills in your players, the set scores,
        the winner and any defaults on TopDog&apos;s score card. You pick the other team&apos;s
        players, check it, and press Submit. ClubMode never submits for you.
      </p>

      <BookmarkletSetup />

      <h2 className="text-xl font-display text-white mt-10">After every match</h2>
      <ol className="mt-3 space-y-2 text-white/70 list-decimal pl-5">
        <li>Save the court scores on the match page in ClubMode.</li>
        <li>
          Press <b className="text-white">Enter on TopDog</b>. TopDog&apos;s score card opens in a
          new tab.
        </li>
        <li>
          Tap <b className="text-white">Fill from ClubMode</b> in your bookmarks. Green boxes are
          filled; amber boxes are the other team&apos;s players for you to pick; red means ClubMode
          couldn&apos;t match someone to TopDog&apos;s roster.
        </li>
        <li>Check it against the paper card, then press Submit on TopDog.</li>
      </ol>
      <p className="mt-4 text-sm text-white/40">
        If TopDog asks you to log in first, the link loses the scores. Log in, go back to the
        match&apos;s Enter Score page, tap the bookmark and paste. ClubMode copied the code when you
        pressed the button.
      </p>
    </div>
  );
}

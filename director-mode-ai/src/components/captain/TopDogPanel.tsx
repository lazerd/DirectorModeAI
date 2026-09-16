'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

/**
 * Send this match's saved scores to TopDog.
 *
 * Opens TopDog's Enter Score page with the scores in the link; the captain taps
 * the "Fill from ClubMode" bookmark there, checks the card, picks the other
 * team's players (ClubMode never has them) and presses Submit on TopDog.
 * Nothing is ever submitted from here.
 */
export default function TopDogPanel({
  teamId,
  matchId,
  linkedMatchId,
  hasResults,
}: {
  teamId: string;
  matchId: string;
  /** TopDog's id for this match, when it is linked. */
  linkedMatchId: string | null;
  hasResults: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<'open' | 'fix' | 'link' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [opened, setOpened] = useState(false);
  const [copied, setCopied] = useState(false);
  const [linking, setLinking] = useState(false);
  const [link, setLink] = useState('');

  const open = async (which: 'open' | 'fix') => {
    setError(null);
    setBusy(which);
    // Open the tab inside the click, before any await — Safari blocks a
    // window.open that happens after a network round-trip.
    const tab = window.open('', '_blank');
    try {
      const res = await fetch(`/api/captain/topdog?team_id=${teamId}&match_id=${matchId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not build the TopDog fill.');
      setProblems(data.problems || []);
      // The copy is the fallback for when TopDog's login page eats the link.
      try {
        await navigator.clipboard.writeText(data.code);
        setCopied(true);
      } catch {
        setCopied(false);
      }
      const url = which === 'fix' ? data.updateUrl : data.entryUrl;
      if (tab) tab.location.href = url;
      else window.location.href = url;
      setOpened(true);
    } catch (e) {
      tab?.close();
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const saveLink = async (value: string) => {
    setError(null);
    setBusy('link');
    try {
      const res = await fetch('/api/captain/topdog', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: teamId, match_id: matchId, link: value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save the link.');
      setLinking(false);
      setLink('');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const btn = 'px-4 py-2.5 rounded-xl font-semibold text-sm disabled:opacity-50 transition';
  const primary = `${btn} bg-[#D3FB52] text-[#001820] hover:brightness-95`;
  const ghost = `${btn} border border-white/10 text-white/70 hover:text-white hover:border-white/25`;

  return (
    <section className="mt-6 rounded-xl border border-white/[0.08] bg-[#002838] p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-white font-semibold">Post the scores to TopDog</h3>
          <p className="text-white/40 text-sm mt-0.5">
            {linkedMatchId
              ? hasResults
                ? 'Opens the TopDog score card. Tap your Fill from ClubMode bookmark there, pick the other team’s players, check it, and Submit.'
                : 'Save the court scores above first. Then this fills the TopDog card for you.'
              : 'Link this match to its TopDog match to fill the score card from here.'}
          </p>
        </div>
        {linkedMatchId && (
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => open('open')}
              disabled={!hasResults || !!busy}
              className={primary}
            >
              {busy === 'open' ? 'Opening…' : 'Enter on TopDog'}
            </button>
          </div>
        )}
      </div>

      {opened && (
        <div className="mt-3 rounded-lg border border-[#D3FB52]/30 bg-[#D3FB52]/10 p-3 text-sm text-[#D3FB52]">
          TopDog is open in a new tab. Tap <b>Fill from ClubMode</b> in your bookmarks there.
          {copied && ' If TopDog made you log in first, tap it anyway and paste — the fill code is on your clipboard.'}
          <span className="block mt-1 text-white/60">Nothing is posted until you press Submit on TopDog.</span>
        </div>
      )}

      {problems.length > 0 && (
        <ul className="mt-3 list-disc pl-5 text-sm text-amber-200">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}

      <div className="mt-3 flex items-center gap-x-4 gap-y-1 flex-wrap text-xs text-white/40">
        <Link href="/captain/topdog-fill" className="hover:text-white underline underline-offset-2">
          Set up the Fill from ClubMode bookmark (one time)
        </Link>
        {linkedMatchId && hasResults && (
          <button onClick={() => open('fix')} disabled={!!busy} className="hover:text-white underline underline-offset-2">
            Already posted? Correct it on TopDog
          </button>
        )}
        <button
          onClick={() => setLinking((v) => !v)}
          className="hover:text-white underline underline-offset-2"
        >
          {linkedMatchId ? `TopDog match ${linkedMatchId} · change` : 'Link to TopDog'}
        </button>
      </div>

      {linking && (
        <div className="mt-3 flex gap-2 flex-wrap items-center">
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Paste the match's TopDog link (scorecard, lineup or Enter Score page)"
            style={{ color: '#ffffff' }}
            className="flex-1 min-w-[16rem] px-3 py-2 rounded-lg bg-[#001820] border border-white/10 placeholder-white/25 text-sm focus:border-[#D3FB52]/50 focus:outline-none"
          />
          <button onClick={() => saveLink(link)} disabled={!link.trim() || !!busy} className={ghost}>
            {busy === 'link' ? 'Saving…' : 'Save link'}
          </button>
          {linkedMatchId && (
            <button onClick={() => saveLink('')} disabled={!!busy} className="text-xs text-white/40 hover:text-red-300">
              Unlink
            </button>
          )}
        </div>
      )}
    </section>
  );
}

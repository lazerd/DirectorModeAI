'use client';

import { useState } from 'react';

/**
 * Post this match's saved scores to USTA TennisLink.
 *
 * The TopDog panel used to be shown for every team, so a JTT coach — playing a
 * USTA league that is scored on TennisLink and has nothing to do with TopDog —
 * was told to "post the scores to TopDog" (Darrin, 2026-09-20).
 *
 * TennisLink is behind a USTA login and its score page is built per match, so
 * there is no link we can hand someone that lands on the right card, and
 * nothing here ever submits anything. What it does is remove the retyping
 * error: the card as ClubMode has it, in line order, ready to read across while
 * the captain fills TennisLink in the other tab.
 */
export type UstaLine = {
  label: string;
  /** Our players on this line, already formatted "Ann Lee / Jo Kim". */
  ours: string;
  /** Their players, when the captain recorded them off the paper card. */
  theirs: string | null;
  score: string | null;
  won: boolean | null;
  defaulted: boolean;
};

const CAPTAIN_TEAMS_URL = 'https://tennislink.usta.com/TeamTennis/Secure/CaptainTeams.aspx';

export default function UstaScorePanel({
  lines,
  opponent,
  isHome,
  matchAt,
  timeZone,
  unsaved = false,
}: {
  lines: UstaLine[];
  opponent: string | null;
  isHome: boolean;
  matchAt: string;
  timeZone: string;
  /** The score form above has changes not saved yet. */
  unsaved?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const scored = lines.filter((l) => l.score || l.won !== null || l.defaulted);
  const won = scored.filter((l) => l.won === true).length;
  const lost = scored.filter((l) => l.won === false).length;

  const when = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(new Date(matchAt));

  const asText = [
    `${isHome ? 'vs' : 'at'} ${opponent || 'TBD'} — ${when}`,
    ...scored.map((l) =>
      [
        `${l.label}:`,
        l.ours,
        l.theirs ? `vs ${l.theirs}` : '',
        l.defaulted ? '(default)' : '',
        l.score || '',
        l.won === true ? 'W' : l.won === false ? 'L' : '',
      ]
        .filter(Boolean)
        .join(' '),
    ),
    `Lines ${won}-${lost}`,
  ].join('\n');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  const btn = 'px-4 py-2.5 rounded-xl font-semibold text-sm disabled:opacity-50 transition';

  return (
    <section className="mt-6 rounded-xl border border-white/[0.08] bg-[#002838] p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-white font-semibold">Post the scores to USTA (TennisLink)</h3>
          <p className="text-white/40 text-sm mt-0.5">
            {scored.length
              ? 'Open TennisLink, find this match under your team, and copy the lines across. Nothing is posted from here.'
              : 'Save the line scores above first, then post them to TennisLink.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={CAPTAIN_TEAMS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={`${btn} bg-[#D3FB52] text-[#001820] hover:brightness-95`}
          >
            Open TennisLink
          </a>
          {scored.length > 0 && (
            <button
              onClick={copy}
              className={`${btn} border border-white/10 text-white/70 hover:border-white/25 hover:text-white`}
            >
              {copied ? 'Copied' : 'Copy the card'}
            </button>
          )}
        </div>
      </div>

      {unsaved && (
        <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/[0.07] p-2.5 text-sm text-amber-100/80">
          You have score changes that aren&apos;t saved. Press <b>Save scores</b> above first, or
          you will copy the old ones across.
        </p>
      )}

      {scored.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {scored.map((l) => (
            <div
              key={l.label}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-lg border border-white/[0.05] bg-[#001820] px-3 py-2 text-sm"
            >
              <span className="w-20 shrink-0 text-xs uppercase tracking-wide text-white/40">
                {l.label}
              </span>
              <span className="text-white/80">{l.ours}</span>
              {l.theirs && <span className="text-white/35">vs {l.theirs}</span>}
              <span className="ml-auto font-mono text-white/70">
                {l.defaulted ? 'default' : l.score || '—'}
              </span>
              <span
                className={
                  l.won === true
                    ? 'font-semibold text-[#D3FB52]'
                    : l.won === false
                      ? 'font-semibold text-white/50'
                      : 'text-white/30'
                }
              >
                {l.won === true ? 'W' : l.won === false ? 'L' : '·'}
              </span>
            </div>
          ))}
          <p className="pt-1 text-sm text-white/50">
            Lines {won}&ndash;{lost}
          </p>
        </div>
      )}
    </section>
  );
}

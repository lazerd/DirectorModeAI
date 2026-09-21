'use client';

import { useState } from 'react';

/**
 * Post this match's saved scores to USTA TennisLink.
 *
 * FIRST VERSION GOT THIS WRONG (Darrin, mid-match, 2026-09-20): the button
 * opened CaptainTeams.aspx, the team LIST, which is not a step in score entry
 * at all. The real path he walked is:
 *
 *   Homepage.aspx -> click the Coach/Captain role link -> Score Entry (under My
 *   Options) -> type the Match # -> Next -> Next -> the card.
 *
 * There is deliberately no deep link here. Opening the role or score-entry URL
 * directly leaves the SERVER's idea of your role unchanged and the second Next
 * lands on AccessDenied.htm — it reads like a permissions problem and is not
 * one. The link must be clicked from the homepage, so the homepage is where we
 * send you. (Same trap cost an hour in court-booker/jtt-score.js.)
 *
 * Nothing is ever submitted from here.
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

const HOME = 'https://tennislink.usta.com/TeamTennis/Main/Homepage.aspx';

/**
 * Games needed for TennisLink to call a line "Completed". A JTT round is timed,
 * so a line that never reached the target is a **Timed Match** — the single
 * field on that form people get wrong. 10U Green plays 4-game sets; 12U and 14U
 * Yellow play 6.
 */
function gamesTarget(level: string | null): number {
  return /10U/i.test(level || '') ? 4 : 6;
}

/** "6-4" / "4-2, 3-1" -> [6, 4]. JTT plays one short set, so the first pair is it. */
function gamesOf(score: string | null): [number, number] | null {
  const m = (score || '').match(/(\d+)\s*[-–]\s*(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** What to pick in TennisLink's `result` dropdown for this line. */
function resultLabel(line: UstaLine, target: number): string {
  if (line.defaulted) return 'Default';
  const g = gamesOf(line.score);
  if (!g) return '—';
  return Math.max(g[0], g[1]) >= target ? 'Completed' : 'Timed Match';
}

export default function UstaScorePanel({
  lines,
  opponent,
  isHome,
  matchAt,
  timeZone,
  teamLevel = null,
  unsaved = false,
}: {
  lines: UstaLine[];
  opponent: string | null;
  isHome: boolean;
  matchAt: string;
  timeZone: string;
  /** "12U Yellow Ball" — decides the games target behind Completed vs Timed. */
  teamLevel?: string | null;
  /** The score form above has changes not saved yet. */
  unsaved?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const target = gamesTarget(teamLevel);
  const scored = lines.filter((l) => l.score || l.won !== null || l.defaulted);
  const won = scored.filter((l) => l.won === true).length;
  const lost = scored.filter((l) => l.won === false).length;

  /** TennisLink asks for the date of the match on the card, not today's. */
  const cardDate = new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    timeZone,
  }).format(new Date(matchAt));

  /* Home/visiting is what the form's two columns are labelled, so say it that
     way rather than "us/them" — one less translation at the keyboard. */
  const ourColumn = isHome ? 'Home' : 'Visiting';
  const theirColumn = isHome ? 'Visiting' : 'Home';

  const asText = [
    `${isHome ? 'vs' : 'at'} ${opponent || 'TBD'} — match date ${cardDate}`,
    `${ourColumn} = us, ${theirColumn} = them`,
    ...scored.map((l) =>
      [
        `${l.label}:`,
        l.ours,
        l.theirs ? `vs ${l.theirs}` : '',
        l.defaulted ? '' : l.score || '',
        `[${resultLabel(l, target)}]`,
        l.won === true ? 'winner: us' : l.won === false ? 'winner: them' : '',
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
              ? 'Four clicks on TennisLink, then read the card below across. Nothing is posted from here.'
              : 'Save the line scores above first, then post them to TennisLink.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={HOME}
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

      {/* The path itself. TennisLink has no URL that lands on score entry, so
          the steps are the product. */}
      <ol className="mt-3 space-y-1 text-sm text-white/55">
        <li>
          1. On the homepage, click your <b className="text-white/80">Coach/Captain</b> role link.
        </li>
        <li>
          2. Under My Options, click <b className="text-white/80">Score Entry</b>.
        </li>
        <li>
          3. Type the <b className="text-white/80">Match #</b>, then Next, then Next. It is at the
          top of this match&apos;s score card on your TennisLink team page — we don&apos;t have it.
        </li>
        <li>
          4. Set the date to <b className="text-white/80">{cardDate}</b> and fill the lines below.
        </li>
      </ol>
      <p className="mt-2 text-xs text-white/30">
        Clicking the role link matters — opening those pages by URL leaves your role unset and Next
        lands on Access Denied, which looks like a permissions problem but isn&apos;t.
      </p>

      {unsaved && (
        <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/[0.07] p-2.5 text-sm text-amber-100/80">
          You have score changes that aren&apos;t saved. Press <b>Save scores</b> above first, or
          you will copy the old ones across.
        </p>
      )}

      {scored.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <div className="flex gap-3 px-3 text-[11px] uppercase tracking-wide text-white/25">
            <span className="w-20 shrink-0">Line</span>
            <span>
              {ourColumn} / {theirColumn}
            </span>
            <span className="ml-auto">Games</span>
            <span className="w-24 text-right">Result</span>
            <span className="w-14 text-right">Winner</span>
          </div>
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
                {l.defaulted ? '—' : l.score || '—'}
              </span>
              <span className="w-24 text-right text-xs text-white/50">
                {resultLabel(l, target)}
              </span>
              <span
                className={`w-14 text-right ${
                  l.won === true
                    ? 'font-semibold text-[#D3FB52]'
                    : l.won === false
                      ? 'font-semibold text-white/50'
                      : 'text-white/30'
                }`}
              >
                {l.won === true ? 'us' : l.won === false ? 'them' : '·'}
              </span>
            </div>
          ))}
          <p className="pt-1 text-sm text-white/50">
            Lines {won}&ndash;{lost} · anything short of {target} games is a{' '}
            <b className="text-white/70">Timed Match</b>, not Completed.
          </p>
        </div>
      )}
    </section>
  );
}

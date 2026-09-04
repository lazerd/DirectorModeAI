'use client';

/**
 * Team settings: how the season gets shared out, and when the automatic
 * emails go.
 *
 * The captaining style is the single most consequential setting in the app —
 * it decides whether a stronger player gets benched so a teammate can play —
 * so it's two explicit cards with their trade-off spelled out, not a dropdown
 * a captain flips past without reading.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Props = {
  teamId: string;
  captainingStyle: string | null;
  pollLeadDays: number | null;
  lineupLeadDays: number | null;
  /** Lines a match is played over — 2 + 2 in JTT, 0 + 4 in a doubles league. */
  singlesCourts: number;
  doublesCourts: number;
  /** Courts we host on. Null until the captain says. */
  courtFormat: number | null;
  /** Only leagues where players share lines need to publish this. */
  showCourtFormat: boolean;
};

const STYLES = [
  {
    value: 'play_to_win',
    title: 'Play to win',
    blurb: 'Strongest available side every week. Fairness is only a tiebreaker.',
  },
  {
    value: 'equal_play',
    title: 'Equal play',
    blurb:
      'Everyone gets as close to the same number of matches as the schedule allows — even when that benches a stronger player.',
  },
] as const;

// globals.css styles bare `input` outside Tailwind's layers and wins the
// cascade, so a class-only colour renders white text on a white field. The
// inline colour is deliberate — see the note in the roster panel.
const INPUT_COLOR = { color: '#ffffff' } as const;
const field =
  'w-24 px-3 py-2 rounded-lg bg-[#001820] border border-white/10 focus:border-[#D3FB52]/50 focus:outline-none text-sm';

export default function TeamSettingsPanel({
  teamId,
  captainingStyle,
  pollLeadDays,
  lineupLeadDays,
  singlesCourts,
  doublesCourts,
  courtFormat,
  showCourtFormat,
}: Props) {
  const router = useRouter();
  const [style, setStyle] = useState(
    captainingStyle === 'equal_play' ? 'equal_play' : 'play_to_win',
  );
  const [poll, setPoll] = useState(String(pollLeadDays ?? 21));
  const [lineup, setLineup] = useState(String(lineupLeadDays ?? 7));
  const [singles, setSingles] = useState(String(singlesCourts));
  const [doubles, setDoubles] = useState(String(doublesCourts));
  const [format, setFormat] = useState(courtFormat == null ? '' : String(courtFormat));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      const res = await fetch('/api/captain/teams', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: teamId, ...patch }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error || 'Could not save.');
        return false;
      }
      setMsg('Saved.');
      router.refresh();
      return true;
    } catch {
      setError('Network problem — try again.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function pickStyle(v: string) {
    const previous = style;
    setStyle(v); // optimistic: the cards should respond to the click at once
    if (!(await save({ captaining_style: v }))) setStyle(previous);
  }

  return (
    <section className="mt-10">
      <h2 className="text-xl font-display text-white">How you captain</h2>

      {msg && <p className="text-sm text-[#D3FB52] mt-3">{msg}</p>}
      {error && <p className="text-sm text-red-300 mt-3">{error}</p>}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {STYLES.map((s) => {
          const on = style === s.value;
          return (
            <button
              key={s.value}
              onClick={() => pickStyle(s.value)}
              disabled={busy}
              aria-pressed={on}
              className={`text-left rounded-2xl border p-4 transition disabled:opacity-60 ${
                on
                  ? 'border-[#D3FB52]/60 bg-[#D3FB52]/[0.07]'
                  : 'border-white/[0.08] bg-[#002838] hover:border-white/25'
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`w-3 h-3 rounded-full shrink-0 ${
                    on ? 'bg-[#D3FB52]' : 'border border-white/25'
                  }`}
                />
                <span className="text-white font-medium">{s.title}</span>
              </div>
              <p className="text-sm text-white/50 mt-1.5">{s.blurb}</p>
            </button>
          );
        })}
      </div>

      <h3 className="text-white/50 text-sm uppercase tracking-wide mt-8 mb-2">Lines per match</h3>
      <div className="rounded-2xl border border-white/[0.08] bg-[#002838] p-5 flex flex-wrap gap-6">
        <div>
          <label htmlFor="lines-singles" className="block text-xs text-white/50 mb-1">
            Singles courts
          </label>
          <input
            id="lines-singles"
            inputMode="numeric"
            value={singles}
            onChange={(e) => setSingles(e.target.value)}
            onBlur={() => save({ default_singles_courts: Number(singles) })}
            style={INPUT_COLOR}
            className={field}
          />
        </div>
        <div>
          <label htmlFor="lines-doubles" className="block text-xs text-white/50 mb-1">
            Doubles courts
          </label>
          <input
            id="lines-doubles"
            inputMode="numeric"
            value={doubles}
            onChange={(e) => setDoubles(e.target.value)}
            onBlur={() => save({ default_doubles_courts: Number(doubles) })}
            style={INPUT_COLOR}
            className={field}
          />
        </div>
      </div>
      <p className="text-xs text-white/35 mt-2">
        What a new match starts with — every match can still be changed on its own. Matches already
        on the schedule keep the lines they were created with.
      </p>

      {showCourtFormat && (
        <>
          <h3 className="text-white/50 text-sm uppercase tracking-wide mt-8 mb-2">
            Courts you host on
          </h3>
          <div className="rounded-2xl border border-white/[0.08] bg-[#002838] p-5 flex flex-wrap gap-6 items-end">
            <div>
              <label htmlFor="court-format" className="block text-xs text-white/50 mb-1">
                Court format
              </label>
              <input
                id="court-format"
                inputMode="numeric"
                placeholder="3"
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                onBlur={() => format.trim() && save({ court_format: Number(format) })}
                style={INPUT_COLOR}
                className={field}
              />
            </div>
            <p className="text-xs text-white/40 max-w-sm">
              How many courts you put the match on at home. It goes in the note to the opposing
              captain, because it decides how long the afternoon runs — and it is the first thing
              they write back to ask when the email doesn&rsquo;t say.
            </p>
          </div>
        </>
      )}

      <h3 className="text-white/50 text-sm uppercase tracking-wide mt-8 mb-2">Automatic emails</h3>
      <div className="rounded-2xl border border-white/[0.08] bg-[#002838] p-5 flex flex-wrap gap-6">
        <div>
          <label htmlFor="poll-lead" className="block text-xs text-white/50 mb-1">
            Ask who&apos;s available
          </label>
          <div className="flex items-center gap-2">
            <input
              id="poll-lead"
              inputMode="numeric"
              value={poll}
              onChange={(e) => setPoll(e.target.value)}
              onBlur={() => save({ poll_lead_days: Number(poll) })}
              style={INPUT_COLOR}
              className={field}
            />
            <span className="text-sm text-white/40">days before</span>
          </div>
        </div>
        <div>
          <label htmlFor="lineup-lead" className="block text-xs text-white/50 mb-1">
            Send the lineup
          </label>
          <div className="flex items-center gap-2">
            <input
              id="lineup-lead"
              inputMode="numeric"
              value={lineup}
              onChange={(e) => setLineup(e.target.value)}
              onBlur={() => save({ lineup_lead_days: Number(lineup) })}
              style={INPUT_COLOR}
              className={field}
            />
            <span className="text-sm text-white/40">days before</span>
          </div>
        </div>
      </div>
      <p className="text-xs text-white/35 mt-2">
        A nudge goes to anyone who hasn&apos;t answered 2 days out, and everyone playing gets a
        reminder the day before. Nobody is emailed about a weekday they said they can never play.
      </p>
    </section>
  );
}

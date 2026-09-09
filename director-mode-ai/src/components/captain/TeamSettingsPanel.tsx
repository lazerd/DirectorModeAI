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
  teamName: string;
  level: string | null;
  levelLabel: string;
  sourceTeamId: string | null;
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

/** What PATCH /api/captain/teams hands back beyond plain success. */
type SaveResult = {
  ok?: boolean;
  /** Upcoming matches whose line counts still differ from the new default. */
  courts_stale?: number;
  courts_applied?: number;
  warning?: string;
};

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
  teamName,
  level,
  levelLabel,
  sourceTeamId,
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
  const [name, setName] = useState(teamName);
  const [lvl, setLvl] = useState(level ?? '');
  const [srcId, setSrcId] = useState(sourceTeamId ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Upcoming matches still on the old line counts, and the save that found them. */
  const [stale, setStale] = useState(0);
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);

  /** The response body on success, null on failure — callers read the extras. */
  async function save(patch: Record<string, unknown>): Promise<SaveResult | null> {
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      const res = await fetch('/api/captain/teams', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: teamId, ...patch }),
      });
      const j = (await res.json().catch(() => ({}))) as SaveResult & { error?: string };
      if (!res.ok) {
        setError(j.error || 'Could not save.');
        return null;
      }
      setMsg(j.warning || 'Saved.');
      router.refresh();
      return j;
    } catch {
      setError('Network problem — try again.');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function pickStyle(v: string) {
    const previous = style;
    setStyle(v); // optimistic: the cards should respond to the click at once
    if (!(await save({ captaining_style: v }))) setStyle(previous);
  }

  /*
   * Saving the lines only changes what NEW matches start with. Matches already
   * on the schedule keep the counts they were created with, and the lineup
   * generator reads those — which is how a 4-doubles team kept getting 3
   * doubles and 2 singles. The API reports how many still disagree; offer to
   * restamp them rather than leaving the captain to find out from a lineup.
   */
  async function saveCourts(patch: Record<string, unknown>) {
    setStale(0);
    const j = await save(patch);
    if (j?.courts_stale) {
      setStale(j.courts_stale);
      setPending(patch);
    }
  }

  async function applyToUpcoming() {
    if (!pending) return;
    const j = await save({ ...pending, apply_courts_to_upcoming: true });
    if (j) {
      setStale(0);
      setPending(null);
      if (j.courts_applied) {
        setMsg(
          `Updated ${j.courts_applied} scheduled ${j.courts_applied === 1 ? 'match' : 'matches'}.`,
        );
      }
    }
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

      <h3 className="text-white/50 text-sm uppercase tracking-wide mt-8 mb-2">Name &amp; division</h3>
      <div className="rounded-2xl border border-white/[0.08] bg-[#002838] p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label htmlFor="team-name-edit" className="block text-xs text-white/50 mb-1">
            Team name
          </label>
          <input
            id="team-name-edit"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name !== teamName && save({ name })}
            style={INPUT_COLOR}
            className={`${field} w-full`}
          />
        </div>
        <div>
          <label htmlFor="team-level-edit" className="block text-xs text-white/50 mb-1">
            {levelLabel}
          </label>
          <input
            id="team-level-edit"
            value={lvl}
            onChange={(e) => setLvl(e.target.value)}
            onBlur={() => lvl !== (level ?? '') && save({ level: lvl })}
            style={INPUT_COLOR}
            className={`${field} w-full`}
          />
        </div>
        <div>
          <label htmlFor="team-source-id" className="block text-xs text-white/50 mb-1">
            League Team ID
          </label>
          <input
            id="team-source-id"
            value={srcId}
            onChange={(e) => setSrcId(e.target.value)}
            onBlur={() => srcId !== (sourceTeamId ?? '') && save({ source_team_id: srcId })}
            style={INPUT_COLOR}
            className={`${field} w-full`}
          />
        </div>
      </div>
      <p className="text-xs text-white/35 mt-2">
        The Team ID also stops your own club being imported as an opponent from the league contact
        list.
      </p>

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
            onBlur={() => saveCourts({ default_singles_courts: Number(singles) })}
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
            onBlur={() => saveCourts({ default_doubles_courts: Number(doubles) })}
            style={INPUT_COLOR}
            className={field}
          />
        </div>
      </div>
      {stale > 0 ? (
        <div className="mt-2 rounded-xl border border-[#D3FB52]/30 bg-[#D3FB52]/[0.07] p-4">
          <p className="text-sm text-white">
            {stale} upcoming {stale === 1 ? 'match is' : 'matches are'} still set to their old
            lines, and lineups for {stale === 1 ? 'it' : 'them'} will come out in the old shape.
          </p>
          <p className="text-xs text-white/50 mt-1">
            Matches you have already saved a lineup for are left alone — change those on the match
            itself.
          </p>
          <div className="flex gap-3 mt-3">
            <button
              type="button"
              onClick={applyToUpcoming}
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-[#D3FB52] text-[#001820] text-sm font-semibold disabled:opacity-50"
            >
              {busy ? 'Updating…' : `Apply to ${stale === 1 ? 'it' : 'all ' + stale}`}
            </button>
            <button
              type="button"
              onClick={() => {
                setStale(0);
                setPending(null);
              }}
              className="px-4 py-2 rounded-lg text-white/60 hover:text-white text-sm"
            >
              Leave them
            </button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-white/35 mt-2">
          What a new match starts with — every match can still be changed on its own.
        </p>
      )}

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

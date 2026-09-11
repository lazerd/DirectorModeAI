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
  /** How a match is decided: 'courts' won, or 'topdog' points. */
  matchScoring: string | null;
  /** Adult leagues only — JTT is decided on games. */
  showMatchScoring: boolean;
  /** JTT: most players brought to one match. Null = the league default (6). */
  maxPlayers: number | null;
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
  /** Upcoming matches left alone because a lineup is already saved on them. */
  courts_locked?: number;
  warning?: string;
};

// globals.css styles bare `input` outside Tailwind's layers and wins the
// cascade, so a class-only colour renders white text on a white field. The
// inline colour is deliberate — see the note in the roster panel.
const INPUT_COLOR = { color: '#ffffff' } as const;
const field =
  'w-24 px-3 py-2 rounded-lg bg-[#001820] border border-white/10 focus:border-[#D3FB52]/50 focus:outline-none text-sm';

/**
 * How a team match is decided. TopDog / EBWT leagues score points per court,
 * so a 2–2 split on courts can be an 8–4 win — which the recap used to call a
 * tie with no way out (Fall B2/B3 vs Orinda, 2026-09-10).
 */
const SCORING = [
  {
    value: 'courts',
    title: 'Courts won',
    blurb: 'Most courts takes the match — how USTA leagues score it. 3 courts to 2 is a 3–2 win.',
  },
  {
    value: 'topdog',
    title: 'TopDog points',
    blurb:
      'Points per court: 3 for a straight-set win, 2 for a three-set win, 1 for a three-set loss. A 2–2 split on courts can be an 8–4 win.',
  },
];

export default function TeamSettingsPanel({
  teamId,
  captainingStyle,
  pollLeadDays,
  lineupLeadDays,
  singlesCourts,
  doublesCourts,
  courtFormat,
  showCourtFormat,
  matchScoring,
  showMatchScoring,
  maxPlayers,
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
  const [maxP, setMaxP] = useState(maxPlayers == null ? '' : String(maxPlayers));
  const [name, setName] = useState(teamName);
  const [lvl, setLvl] = useState(level ?? '');
  const [srcId, setSrcId] = useState(sourceTeamId ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Upcoming matches we could not restamp because a lineup is saved on them. */
  const [locked, setLocked] = useState(0);

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

  const [scoring, setScoring] = useState(matchScoring === 'topdog' ? 'topdog' : 'courts');
  async function pickScoring(v: string) {
    const previous = scoring;
    setScoring(v);
    if (!(await save({ match_scoring: v }))) setScoring(previous);
  }

  /*
   * A match keeps its own copy of the line counts and the lineup generator
   * reads that copy, not this default — so saving the lines has to carry onto
   * the schedule or it changes nothing the captain can see. It used to ask
   * first, and a captain who saved and moved on never answered: an EBWT C team
   * ran a 16-match schedule stamped 2 singles + 3 doubles with its settings
   * reading 0 + 4, and every generated lineup came out in the wrong shape
   * (2026-09-11). Now the save does it, and says how many it changed.
   */
  async function saveCourts(patch: Record<string, unknown>) {
    setLocked(0);
    const j = await save(patch);
    if (!j || j.warning) return;
    setLocked(j.courts_locked ?? 0);
    const n = j.courts_applied ?? 0;
    setMsg(
      n
        ? `Saved — ${n} scheduled ${n === 1 ? 'match' : 'matches'} updated to these lines.`
        : 'Saved.',
    );
  }

  return (
    <section id="team-settings" className="mt-10 scroll-mt-6">
      {/*
        Named "Team settings" because that is what every instruction we send a
        captain calls it. It used to be headed "How you captain" only, so a
        captain told to open team settings had nothing on the page by that name
        and nothing to click (Megan Sullivan, 2026-09-11).
      */}
      <h2 className="text-xl font-display text-white">Team settings</h2>

      {msg && <p className="text-sm text-[#D3FB52] mt-3">{msg}</p>}
      {error && <p className="text-sm text-red-300 mt-3">{error}</p>}

      <h3 className="text-white/50 text-sm uppercase tracking-wide mt-6 mb-2">How you captain</h3>

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
      {locked > 0 && (
        <div className="mt-2 rounded-xl border border-[#D3FB52]/30 bg-[#D3FB52]/[0.07] p-4">
          <p className="text-sm text-white">
            {locked} upcoming {locked === 1 ? 'match' : 'matches'} kept{' '}
            {locked === 1 ? 'its' : 'their'} old lines because you have already saved a lineup
            {locked === 1 ? '' : 's'} there.
          </p>
          <p className="text-xs text-white/50 mt-1">
            Those courts may already have gone out to the players — change them on the match itself.
          </p>
        </div>
      )}
      <p className="text-xs text-white/35 mt-2">
        Every scheduled match is set to these lines when you save. A match you have already saved a
        lineup for keeps its own, and any one match can still be changed on its own.
      </p>

      {showMatchScoring && (
        <>
          <h3 className="text-white/50 text-sm uppercase tracking-wide mt-8 mb-2">
            How a match is won
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {SCORING.map((s) => {
              const on = scoring === s.value;
              return (
                <button
                  key={s.value}
                  onClick={() => pickScoring(s.value)}
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
          <p className="text-xs text-white/35 mt-2">
            Decides which recap goes out — win, loss or tie — the score it prints, and your season
            record. You can still pick the result by hand on any recap.
          </p>
        </>
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
            <div>
              <label htmlFor="max-players" className="block text-xs text-white/50 mb-1">
                Most players to bring
              </label>
              {/* Blank = 6: past that, somebody drives to the match for one short set. */}
              <input
                id="max-players"
                inputMode="numeric"
                placeholder="6"
                value={maxP}
                onChange={(e) => setMaxP(e.target.value)}
                onBlur={() =>
                  maxP !== (maxPlayers == null ? '' : String(maxPlayers)) &&
                  save({ max_players: maxP.trim() ? Number(maxP) : null })
                }
                style={INPUT_COLOR}
                className={field}
              />
            </div>
            <p className="text-xs text-white/40 max-w-sm">
              How many courts you put the match on at home. It goes in the note to the opposing
              captain, because it decides how long the afternoon runs — and it is the first thing
              they write back to ask when the email doesn&rsquo;t say. When more players say yes
              than you bring, the lineup picks who sits: fewest matches so far plays first, then
              whoever can make the fewest other dates, then whoever signed up first.
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

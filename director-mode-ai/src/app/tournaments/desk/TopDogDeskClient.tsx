'use client';

/**
 * Tournament desk for a TopDog event.
 *
 * TopDog publishes an order of play and nothing else — no courts, no start
 * times, no "in progress" — so this page is the missing half of the desk:
 *
 *   1. a match is ready (TopDog has both names on it)
 *   2. Darrin taps a free court           -> the PA calls the players out
 *   3. the players come back with a score -> the court opens again
 *
 * Step 2 is the announcement trigger, in place of the "court assigned" event
 * the Serve Tennis announcer listens for. Step 3 is what keeps the public
 * wait board honest, and it quietly times the match so the afternoon's
 * estimates come from today's play rather than a default.
 *
 * Everything the desk knows lives in this browser plus the published
 * snapshot. Nothing is written back to TopDog: the results still go in
 * there, which is why "Score in" opens the TopDog scoring page alongside
 * freeing the court.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  announcementText, type TopDogMatch, type TopDogSchedule,
} from '@/lib/ondeck/topdog';
import {
  eventIdFor, scoreEntryUrl, type DivisionLink,
} from '@/lib/ondeck/topdogResults';
import {
  buildDeskBoard, observationFor, type Assignment,
} from '@/lib/ondeck/desk';
import { DEFAULT_LENGTHS, type MatchLengths, type Observation } from '@/lib/ondeck/board';
import { pickVoice, speak, stopSpeaking, reportToDeskText } from '@/lib/ondeck/speech';

/** The RSPA/USPTA Jr Circuit event at Sleepy Hollow. */
const TOURNAMENT_ID = '1715';
const BOARD_SLUG = 'sh-rspa-sep-2026';

/**
 * How often the sheet is re-read. Short, because this is what decides how
 * quickly a newly-decided match appears in the queue — TopDog only fills in
 * the next round once the desk has entered a result.
 */
const POLL_MS = 20_000;
const PUBLISH_HEARTBEAT_MS = 90_000;

const COURTS_KEY = 'ondeck.td.courts';
const VOICE_KEY = 'ondeck.voice';
const LENGTHS_KEY = 'ondeck.td.lengths';
const stateKey = (date: string) => `ondeck.td.state.${TOURNAMENT_ID}.${date}`;

/** Sleepy Hollow runs nine courts; the desk may hold some back for members. */
const DEFAULT_COURTS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/** A call is read twice — nobody catches a name the first time. */
const CALL_REPEATS = 2;

interface DeskState {
  assignments: Assignment[];
  completedIds: string[];
  observations: Observation[];
}

const EMPTY_STATE: DeskState = { assignments: [], completedIds: [], observations: [] };

interface LogLine { at: string; text: string; kind: 'call' | 'info' | 'error' }

function loadJSON<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

/** "08:00" -> "8:00 AM", for a screen read at arm's length. */
function pretty(hhmm: string | null): string {
  if (!hhmm) return '—';
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h)) return hhmm;
  const mer = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m || 0).padStart(2, '0')} ${mer}`;
}

/** The schedule, plus the division links the results page carries. */
type Sheet = TopDogSchedule & { divisions?: DivisionLink[]; resultsAvailable?: boolean };

export default function TopDogDeskClient() {
  const [schedule, setSchedule] = useState<Sheet | null>(null);
  const [date, setDate] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [lastPoll, setLastPoll] = useState<Date | null>(null);
  const [armed, setArmed] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voice, setVoice] = useState('');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [courts, setCourts] = useState<string[]>(DEFAULT_COURTS);
  const [lengths, setLengths] = useState<MatchLengths>(DEFAULT_LENGTHS);
  const [state, setState] = useState<DeskState>(EMPTY_STATE);
  const [log, setLog] = useState<LogLine[]>([]);
  const [publishState, setPublishState] = useState<'idle' | 'ok' | 'failed' | 'signed_out'>('idle');
  const [showDone, setShowDone] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  const lastPublish = useRef<{ signature: string; at: number }>({ signature: '', at: 0 });

  const addLog = useCallback((text: string, kind: LogLine['kind'] = 'info') => {
    const at = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLog((l) => [{ at, text, kind }, ...l].slice(0, 80));
  }, []);

  // --- settings -----------------------------------------------------------
  useEffect(() => {
    try {
      const savedCourts = localStorage.getItem(COURTS_KEY);
      if (savedCourts) {
        const parsed = JSON.parse(savedCourts);
        if (Array.isArray(parsed) && parsed.length) setCourts(parsed.map(String));
      }
    } catch { /* keep defaults */ }
    setLengths(loadJSON(LENGTHS_KEY, DEFAULT_LENGTHS));
  }, []);

  useEffect(() => { saveJSON(COURTS_KEY, courts); }, [courts]);
  useEffect(() => { saveJSON(LENGTHS_KEY, lengths); }, [lengths]);

  // --- voices -------------------------------------------------------------
  useEffect(() => {
    const load = () => {
      const all = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
      setVoices(all);
      setVoice((current) => current || pickVoice(localStorage.getItem(VOICE_KEY)));
    };
    load();
    speechSynthesis.addEventListener('voiceschanged', load);
    return () => speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  useEffect(() => { if (voice) { try { localStorage.setItem(VOICE_KEY, voice); } catch { /* */ } } }, [voice]);

  // Keep the Stop button honest about whether anything is actually playing.
  useEffect(() => {
    const t = setInterval(() => setSpeaking(speechSynthesis.speaking), 400);
    return () => clearInterval(t);
  }, []);

  // Elapsed times on court have to tick without waiting for the next poll.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // --- desk state, per day ------------------------------------------------
  useEffect(() => {
    if (!date) return;
    setState(loadJSON(stateKey(date), EMPTY_STATE));
  }, [date]);

  useEffect(() => {
    if (!date) return;
    saveJSON(stateKey(date), state);
  }, [date, state]);

  // --- the sheet ----------------------------------------------------------
  const fetchSchedule = useCallback(async (forDate?: string) => {
    try {
      const q = new URLSearchParams({ tournamentId: TOURNAMENT_ID });
      if (forDate) q.set('date', forDate);
      const res = await fetch(`/api/ondeck/topdog?${q.toString()}`, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.message ?? `TopDog did not answer (${body?.error ?? res.status})`);
        return;
      }
      setSchedule(body as Sheet);
      setDate((d) => d || (body as Sheet).date);
      setError(null);
      setLastPoll(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach TopDog');
    }
  }, []);

  useEffect(() => { void fetchSchedule(); }, [fetchSchedule]);

  useEffect(() => {
    const t = setInterval(() => { void fetchSchedule(date || undefined); }, POLL_MS);
    return () => clearInterval(t);
  }, [fetchSchedule, date]);

  const matches = useMemo(() => schedule?.matches ?? [], [schedule]);
  const byId = useMemo(() => new Map(matches.map((m) => [m.id, m])), [matches]);

  // --- the board ----------------------------------------------------------
  const board = useMemo(() => {
    if (!schedule) return null;
    return buildDeskBoard({
      matches,
      courts,
      assignments: state.assignments,
      completedIds: state.completedIds,
      lengths,
      observations: state.observations,
      boardDate: schedule.date,
      now,
    });
  }, [schedule, matches, courts, state, lengths, now]);

  const occupied = useMemo(
    () => new Map(state.assignments.map((a) => [a.court, a])),
    [state.assignments]
  );
  const busyMatchIds = useMemo(
    () => new Set(state.assignments.map((a) => a.matchId)),
    [state.assignments]
  );
  const doneIds = useMemo(() => new Set(state.completedIds), [state.completedIds]);

  /** Ready to go out: both names known, not on court, not scored. */
  const queue = useMemo(
    () => matches.filter((m) => m.ready && !busyMatchIds.has(m.id) && !doneIds.has(m.id)),
    [matches, busyMatchIds, doneIds]
  );

  /** Still waiting on a result from an earlier round. */
  const undecided = useMemo(
    () => matches.filter((m) => !m.ready && !m.completed && !doneIds.has(m.id)),
    [matches, doneIds]
  );

  const finished = useMemo(
    () => matches.filter((m) => m.completed || doneIds.has(m.id)),
    [matches, doneIds]
  );

  const freeCourts = useMemo(
    () => courts.filter((c) => !occupied.has(c)),
    [courts, occupied]
  );

  // --- speaking -----------------------------------------------------------
  const say = useCallback((text: string, kind: LogLine['kind'] = 'call') => {
    addLog(text, kind);
    void speak(text, { voice, times: CALL_REPEATS });
  }, [addLog, voice]);

  // --- desk actions -------------------------------------------------------
  const assign = useCallback((match: TopDogMatch, court: string) => {
    setState((s) => ({
      ...s,
      assignments: [
        ...s.assignments.filter((a) => a.court !== court && a.matchId !== match.id),
        { court, matchId: match.id, startedAt: new Date().toISOString() },
      ],
    }));
    setPicking(null);
    say(announcementText(match, court));
  }, [say]);

  /**
   * The players came back with a score. The court opens, the match drops off
   * the board, and how long it took is remembered — that last part is what
   * makes the afternoon's wait times real rather than guessed.
   *
   * The result itself still has to go into TopDog, so the scoring page opens
   * alongside. Nothing here writes to TopDog.
   */
  const scoreIn = useCallback((court: string, openTopDog = true) => {
    const assignment = occupied.get(court);
    if (!assignment) return;
    const match = byId.get(assignment.matchId);

    setState((s) => {
      const obs = match ? observationFor(match, assignment.startedAt) : null;
      return {
        assignments: s.assignments.filter((a) => a.court !== court),
        completedIds: s.completedIds.includes(assignment.matchId)
          ? s.completedIds
          : [...s.completedIds, assignment.matchId],
        observations: obs ? [...s.observations, obs] : s.observations,
      };
    });

    if (match) {
      addLog(`Court ${court} open — ${match.playerA} v ${match.playerB} scored in`, 'info');
    }
    if (openTopDog && match) {
      // Straight to the batch form for that division, with the division
      // preselected — TopDog's own dropdown is there if the guess is wrong
      // (a main draw and its consolation share a name).
      const eventId = eventIdFor(match, schedule?.divisions ?? []);
      window.open(
        eventId
          ? scoreEntryUrl(eventId)
          : `https://sleepyhollowswimtennis.topdoglive.com/pages/tournaments/matches_list.asp?idevent=0&t=${TOURNAMENT_ID}`,
        'topdog-scoring'
      );
    }
  }, [occupied, byId, addLog, schedule]);

  /**
   * A court TopDog has a score for opens itself.
   *
   * This closes the loop from the other end: Darrin enters the result in
   * TopDog the way he always has, and within one poll the court comes back,
   * the match is timed, and the next round's names appear in the queue.
   * Nothing gets said twice.
   */
  useEffect(() => {
    const finished = state.assignments.filter((a) => byId.get(a.matchId)?.completed);
    if (!finished.length) return;

    const freed = new Set(finished.map((a) => a.court));
    const timed = finished
      .map((a) => {
        const m = byId.get(a.matchId);
        return m ? observationFor(m, a.startedAt) : null;
      })
      .filter((o): o is NonNullable<typeof o> => o !== null);

    setState((s) => ({
      ...s,
      assignments: s.assignments.filter((a) => !freed.has(a.court)),
      observations: [...s.observations, ...timed],
    }));

    for (const a of finished) {
      const m = byId.get(a.matchId);
      addLog(`Court ${a.court} open — TopDog has the score${m?.score ? ` (${m.score})` : ''}`, 'info');
    }
  }, [state.assignments, byId, addLog]);

  /** Put a court back the way it was — a mis-tap at a busy desk is common. */
  const clearCourt = useCallback((court: string) => {
    setState((s) => ({ ...s, assignments: s.assignments.filter((a) => a.court !== court) }));
    addLog(`Court ${court} cleared (no score recorded)`, 'info');
  }, [addLog]);

  const undoScore = useCallback((matchId: string) => {
    setState((s) => ({ ...s, completedIds: s.completedIds.filter((id) => id !== matchId) }));
  }, []);

  // --- publish the public board ------------------------------------------
  useEffect(() => {
    if (!board || !schedule) return;
    const signature = JSON.stringify({
      on: board.onCourt.map((c) => [c.court, c.playerA, c.playerB, c.startedAt]),
      wait: board.waiting.map((w) => [w.id, w.estimatedStart, w.ahead]),
    });
    const stale = Date.now() - lastPublish.current.at > PUBLISH_HEARTBEAT_MS;
    if (signature === lastPublish.current.signature && !stale) return;

    lastPublish.current = { signature, at: Date.now() };
    void (async () => {
      try {
        const res = await fetch('/api/ondeck/snapshot', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            slug: BOARD_SLUG,
            title: schedule.tournamentName,
            payload: board,
          }),
        });
        setPublishState(res.ok ? 'ok' : res.status === 401 ? 'signed_out' : 'failed');
      } catch {
        setPublishState('failed');
      }
    })();
  }, [board, schedule]);

  // --- arming -------------------------------------------------------------
  if (!armed) {
    return (
      <div style={S.wrap}>
        <div style={S.gate}>
          <h1 style={S.h1}>Tournament Desk</h1>
          <p style={S.gateText}>
            {schedule ? schedule.tournamentName : 'Loading the order of play…'}
          </p>
          <button
            style={S.bigButton}
            onClick={() => {
              // Browsers keep speech muted until a real click. This is it.
              void speak('Announcer ready.', { voice });
              setArmed(true);
              addLog('Desk armed', 'info');
            }}
          >
            Start the desk
          </button>
          <p style={S.gateHint}>
            Plug the laptop into the PA first. Nothing is said until you send a match out.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={S.wrap}>
      <div style={S.headerRow}>
        <div>
          <h1 style={S.h1}>{schedule?.tournamentName ?? 'Tournament Desk'}</h1>
          <div style={S.status}>
            <span style={{ ...S.dot, background: error ? '#dc2626' : '#16a34a' }} />
            {error
              ? error
              : `Reading TopDog · last check ${lastPoll?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) ?? '—'}`}
          </div>
        </div>
        <div style={S.headerActions}>
          <button
            style={speaking ? S.stopButtonActive : S.stopButton}
            onClick={() => { stopSpeaking(); addLog('Stopped', 'info'); }}
          >
            ■ Stop
          </button>
        </div>
      </div>

      <div style={S.controls}>
        <label style={S.label}>
          Day{' '}
          <select
            value={date}
            onChange={(e) => { setDate(e.target.value); void fetchSchedule(e.target.value); }}
            style={S.select}
          >
            {(schedule?.dates ?? []).map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </label>

        <label style={S.label}>
          Voice{' '}
          <select value={voice} onChange={(e) => setVoice(e.target.value)} style={S.select}>
            {voices.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
          </select>
        </label>

        <label style={S.label}>
          Courts{' '}
          <input
            style={S.textInput}
            value={courts.join(', ')}
            onChange={(e) =>
              setCourts(
                e.target.value.split(',').map((c) => c.trim()).filter(Boolean)
              )
            }
            title="The courts the tournament is using, comma separated"
          />
        </label>

        <label style={S.label}>
          Main{' '}
          <input
            type="number" min={20} max={240} step={5}
            value={lengths.mainMinutes}
            onChange={(e) => setLengths((l) => ({ ...l, mainMinutes: Number(e.target.value) || l.mainMinutes }))}
            style={S.numInput}
          /> min
        </label>

        <label style={S.label}>
          Consol{' '}
          <input
            type="number" min={20} max={240} step={5}
            value={lengths.consolationMinutes}
            onChange={(e) => setLengths((l) => ({ ...l, consolationMinutes: Number(e.target.value) || l.consolationMinutes }))}
            style={S.numInput}
          /> min
        </label>

        <button
          style={S.button}
          onClick={() => say('Attention please. On court five, boys twelve singles, quarterfinal. Test announcement.', 'info')}
        >
          Test the PA
        </button>

        <a href={`/tournaments/wait/${BOARD_SLUG}`} target="_blank" rel="noreferrer" style={S.button}>
          Public board
        </a>
        <a
          href={`/tournaments/wait/${BOARD_SLUG}/poster?title=${encodeURIComponent(schedule?.tournamentName ?? 'Order of play')}`}
          target="_blank"
          rel="noreferrer"
          style={S.button}
        >
          QR poster
        </a>

        {publishState === 'signed_out' && (
          <span style={S.warnPill}>Public board not updating — sign in to ClubMode here</span>
        )}
        {publishState === 'failed' && <span style={S.warnPill}>Public board failed to update</span>}
        {publishState === 'ok' && <span style={S.badge}>Public board live</span>}

        <span style={S.muted}>
          {state.observations.length
            ? `${state.observations.length} matches timed today`
            : `Using ${lengths.mainMinutes}/${lengths.consolationMinutes} min baselines`}
        </span>
      </div>

      {/* ---- courts ------------------------------------------------------ */}
      <h2 style={S.h2}>Courts</h2>
      <div style={S.courtGrid}>
        {courts.map((court) => {
          const a = occupied.get(court);
          const m = a ? byId.get(a.matchId) : undefined;
          const startMs = a ? new Date(a.startedAt).getTime() : 0;
          const elapsed = a ? Math.max(0, Math.round((now.getTime() - startMs) / 60000)) : 0;

          if (!a || !m) {
            return (
              <div key={court} style={S.courtFree}>
                <div style={S.courtNum}>{court}</div>
                <div style={S.courtOpen}>Open</div>
                {queue.length > 0 ? (
                  <button style={S.sendButton} onClick={() => assign(queue[0], court)}>
                    Send next ▸
                  </button>
                ) : (
                  <span style={S.muted}>Nothing ready</span>
                )}
              </div>
            );
          }

          return (
            <div key={court} style={S.courtBusy}>
              <div style={S.courtNumBusy}>{court}</div>
              <div style={S.courtBody}>
                <div style={S.players}>{m.playerA} <span style={S.vs}>v</span> {m.playerB}</div>
                <div style={S.meta}>{m.event} · {m.round}</div>
                <div style={S.meta}>
                  on at {pretty(new Date(startMs).toTimeString().slice(0, 5))} · {elapsed} min
                </div>
              </div>
              <div style={S.courtButtons}>
                <button style={S.scoreButton} onClick={() => scoreIn(court)}>
                  Score in ▸
                </button>
                <button
                  style={S.smallButton}
                  title="Announce this match again"
                  onClick={() => say(announcementText(m, court))}
                >
                  🔊
                </button>
                <button
                  style={S.smallGhost}
                  title="Put this court back to open without recording a score"
                  onClick={() => clearCourt(court)}
                >
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ---- the queue --------------------------------------------------- */}
      <h2 style={S.h2}>
        Ready to go on ({queue.length})
        {freeCourts.length > 0 && <span style={S.muted}> · {freeCourts.length} court{freeCourts.length === 1 ? '' : 's'} open</span>}
      </h2>
      {queue.length === 0 && <p style={S.muted}>Nothing is ready — every match is out, scored, or waiting on an earlier result.</p>}

      {queue.map((m, i) => {
        const row = board?.waiting.find((w) => w.id === m.id);
        return (
          <div key={m.id} style={{ ...S.queueCard, ...(i === 0 ? S.queueCardNext : {}) }}>
            <div style={S.slotChip}>{m.slot}</div>
            <div style={S.matchBody}>
              <div style={S.players}>{m.playerA} <span style={S.vs}>v</span> {m.playerB}</div>
              <div style={S.meta}>
                {m.event} · {m.round}
                {row && row.ahead > 0 && ` · ${row.ahead} ahead`}
                {row?.estimatedStart && ` · on about ${pretty(row.estimatedStart)}`}
              </div>
            </div>

            <div style={S.queueButtons}>
              {picking === m.id ? (
                <>
                  {freeCourts.length === 0 && <span style={S.muted}>No court open</span>}
                  {freeCourts.map((c) => (
                    <button key={c} style={S.courtPick} onClick={() => assign(m, c)}>{c}</button>
                  ))}
                  <button style={S.smallGhost} onClick={() => setPicking(null)}>✕</button>
                </>
              ) : (
                <>
                  <button
                    style={S.assignButton}
                    onClick={() => {
                      // One open court is not a choice worth making.
                      if (freeCourts.length === 1) assign(m, freeCourts[0]);
                      else setPicking(m.id);
                    }}
                    disabled={freeCourts.length === 0}
                    title={freeCourts.length === 0 ? 'Every court is busy' : 'Put this match on a court and call it'}
                  >
                    Court ▸
                  </button>
                  <button
                    style={S.smallButton}
                    title="Call these players to the desk without giving them a court"
                    onClick={() => say(reportToDeskText(m.playerA, m.playerB))}
                  >
                    🔔
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}

      {/* ---- not yet decided --------------------------------------------- */}
      <h2 style={S.h2}>Waiting on a result ({undecided.length})</h2>
      {undecided.length === 0 && <p style={S.muted}>Every match on the sheet has its players.</p>}
      <div style={S.pendingWrap}>
        {undecided.map((m) => (
          <div key={m.id} style={S.pendingCard}>
            <span style={S.slotChipSmall}>{m.slot}</span>
            <span style={S.meta}>{m.event} · {m.round}</span>
            <span style={S.pendingNames}>
              {m.playerA || 'TBD'} <span style={S.vs}>v</span> {m.playerB || 'TBD'}
            </span>
          </div>
        ))}
      </div>

      {/* ---- done -------------------------------------------------------- */}
      <h2 style={S.h2}>
        Finished ({finished.length}){' '}
        <button style={S.linkButton} onClick={() => setShowDone((v) => !v)}>
          {showDone ? 'hide' : 'show'}
        </button>
      </h2>
      {showDone && finished.map((m) => (
        <div key={m.id} style={{ ...S.queueCard, opacity: 0.6 }}>
          <div style={S.slotChip}>{m.slot}</div>
          <div style={S.matchBody}>
            <div style={S.players}>
              {m.playerA || 'TBD'} <span style={S.vs}>v</span> {m.playerB || 'TBD'}
            </div>
            <div style={S.meta}>
              {m.event} · {m.round}
              {m.score && ` · ${m.score}`}
              {m.winner && ` · ${m.winner} won`}
            </div>
          </div>
          {doneIds.has(m.id) && !m.completed && (
            <button style={S.smallGhost} onClick={() => undoScore(m.id)} title="Put this match back in the queue">
              undo
            </button>
          )}
        </div>
      ))}

      {/* ---- log --------------------------------------------------------- */}
      <h2 style={S.h2}>Announcements</h2>
      <div style={S.logBox}>
        {log.length === 0 && <p style={S.muted}>Nothing called yet.</p>}
        {log.map((l, i) => (
          <div key={i} style={S.logLine}>
            <span style={S.logTime}>{l.at}</span>
            <span style={{ color: l.kind === 'error' ? '#b91c1c' : l.kind === 'call' ? '#111827' : '#6b7280' }}>
              {l.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  // The desk sits inside ClubMode's dark shell, but this page is read at
  // arm's length in daylight by someone holding a clipboard — so it paints
  // its own light surface rather than inheriting a dark one.
  wrap: { maxWidth: 1180, margin: '0 auto', padding: '20px 20px 60px', minHeight: '100vh', background: '#fff', color: '#111827', fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif' },
  gate: { maxWidth: 520, margin: '0 auto', padding: '12vh 0', textAlign: 'center' },
  gateText: { color: '#6b7280', marginBottom: 28 },
  gateHint: { color: '#9ca3af', fontSize: 13, marginTop: 18 },
  bigButton: { fontSize: 20, fontWeight: 700, padding: '18px 34px', borderRadius: 12, border: 0, background: '#16a34a', color: '#fff', cursor: 'pointer' },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' },
  headerActions: { display: 'flex', gap: 8 },
  h1: { fontSize: 24, margin: '0 0 4px', lineHeight: 1.2, color: '#111827' },
  h2: { fontSize: 15, textTransform: 'uppercase', letterSpacing: '.06em', color: '#6b7280', margin: '28px 0 10px' },
  status: { display: 'flex', alignItems: 'center', gap: 8, color: '#6b7280', fontSize: 13 },
  dot: { width: 9, height: 9, borderRadius: '50%', display: 'inline-block' },
  controls: { display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 14, padding: '12px 0', borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb' },
  label: { fontSize: 13, color: '#374151', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' },
  select: { padding: '6px 8px', borderRadius: 6, border: '1px solid #d1d5db', color: '#111827', background: '#fff' },
  textInput: { padding: '6px 8px', borderRadius: 6, border: '1px solid #d1d5db', width: 200, color: '#111827', background: '#fff' },
  numInput: { padding: '6px 8px', borderRadius: 6, border: '1px solid #d1d5db', width: 70, color: '#111827', background: '#fff' },
  button: { padding: '7px 12px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', color: '#111827', cursor: 'pointer', fontSize: 13, textDecoration: 'none', display: 'inline-block' },
  linkButton: { border: 0, background: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 13, textTransform: 'none', letterSpacing: 0 },
  stopButton: { padding: '9px 18px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', color: '#374151', cursor: 'pointer', fontWeight: 700 },
  stopButtonActive: { padding: '9px 18px', borderRadius: 8, border: 0, background: '#dc2626', color: '#fff', cursor: 'pointer', fontWeight: 700 },
  muted: { color: '#9ca3af', fontSize: 13 },
  badge: { fontSize: 12, padding: '4px 8px', borderRadius: 999, background: '#dcfce7', color: '#166534' },
  warnPill: { fontSize: 12, padding: '4px 8px', borderRadius: 999, background: '#fef3c7', color: '#92400e' },

  courtGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 10 },
  courtFree: { display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 10, border: '1px dashed #d1d5db', background: '#fafafa' },
  courtBusy: { display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 10, border: '1px solid #bbf7d0', background: '#f0fdf4' },
  courtNum: { width: 40, height: 40, flexShrink: 0, borderRadius: 8, background: '#e5e7eb', color: '#6b7280', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 18 },
  courtNumBusy: { width: 40, height: 40, flexShrink: 0, borderRadius: 8, background: '#16a34a', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 18 },
  courtOpen: { flex: 1, color: '#9ca3af', fontWeight: 600 },
  courtBody: { flex: 1, minWidth: 0 },
  courtButtons: { display: 'flex', gap: 6, alignItems: 'center' },
  sendButton: { padding: '8px 12px', borderRadius: 8, border: '1px solid #16a34a', background: '#fff', color: '#166534', cursor: 'pointer', fontWeight: 700, fontSize: 13 },
  scoreButton: { padding: '8px 12px', borderRadius: 8, border: 0, background: '#2563eb', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 13 },

  queueCard: { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, border: '1px solid #e5e7eb', marginBottom: 6, background: '#fff' },
  queueCardNext: { borderColor: '#fbbf24', background: '#fffbeb' },
  queueButtons: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' },
  assignButton: { padding: '8px 14px', borderRadius: 8, border: 0, background: '#111827', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 13 },
  courtPick: { width: 36, height: 36, borderRadius: 8, border: '1px solid #16a34a', background: '#fff', color: '#166534', cursor: 'pointer', fontWeight: 800 },
  slotChip: { minWidth: 66, textAlign: 'center', padding: '5px 8px', borderRadius: 999, background: '#f3f4f6', color: '#374151', fontSize: 12, fontWeight: 700 },
  slotChipSmall: { padding: '2px 7px', borderRadius: 999, background: '#f3f4f6', color: '#6b7280', fontSize: 11, fontWeight: 700 },
  matchBody: { flex: 1, minWidth: 0 },
  players: { fontWeight: 600, fontSize: 15 },
  pendingNames: { color: '#9ca3af', fontSize: 13 },
  vs: { color: '#9ca3af', fontWeight: 400, margin: '0 4px' },
  meta: { color: '#6b7280', fontSize: 12.5 },
  smallButton: { padding: '7px 10px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', color: '#111827', cursor: 'pointer' },
  smallGhost: { padding: '7px 10px', borderRadius: 8, border: 0, background: 'none', color: '#9ca3af', cursor: 'pointer' },

  pendingWrap: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 6 },
  pendingCard: { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, background: '#fafafa', border: '1px solid #f3f4f6' },

  logBox: { border: '1px solid #e5e7eb', borderRadius: 10, padding: 10, maxHeight: 260, overflowY: 'auto', background: '#fff' },
  logLine: { display: 'flex', gap: 10, fontSize: 13, padding: '3px 0' },
  logTime: { color: '#9ca3af', fontVariantNumeric: 'tabular-nums', flexShrink: 0 },
};

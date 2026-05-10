'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Music,
  Mic,
  Play,
  Pause,
  Square,
  SkipForward,
  SkipBack,
  Search,
  Volume2,
  Sparkles,
  Loader2,
  X,
  Wand2,
  Megaphone,
  Flag,
  ChevronDown,
} from 'lucide-react';
import { generateScript, totalDurationSec, cueSpokenText, defaultOpeningText, defaultClosingText, type Cue, type ScriptOptions, type ScoringInfo, type ScriptMatch } from '@/lib/dj-script';

interface Player {
  id: string;
  name: string;
  walkoutSongUrl: string | null;
  walkoutSongTitle: string | null;
  walkoutSongArtist: string | null;
  walkoutSongStartSeconds: number;
  walkoutAnnouncerAudioUrl: string | null;
}

interface PixabayTrack {
  id: number;
  title: string;
  user: string;
  duration: number;
  audioUrl: string;
  previewUrl: string;
  tags: string[];
}

interface Round {
  id: string;
  roundNumber: number;
  status: string;
}

interface Match {
  id: string;
  roundId: string;
  courtNumber: number;
  playerIds: string[];
  team1Score?: number | null;
  team2Score?: number | null;
  winnerTeam?: 1 | 2 | null;
}

interface Props {
  eventId: string;
  eventName: string;
  numCourts: number;
  players: Player[];
  rounds: Round[];
  matches: Match[];
  scoring?: ScoringInfo;
}

type Tab = 'setlist' | 'show';

const DEFAULT_WALKOUT_SEC = 18;
const FADE_OUT_SEC = 1.5;

export default function DJConsole({ eventId, eventName, numCourts, players: initialPlayers, rounds, matches, scoring }: Props) {
  const [tab, setTab] = useState<Tab>(rounds.length > 0 ? 'show' : 'setlist');
  const [players, setPlayers] = useState<Player[]>(initialPlayers);
  const [pickerForPlayerId, setPickerForPlayerId] = useState<string | null>(null);
  const [volume, setVolume] = useState(0.85);

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-white/10 mb-6">
        <TabButton active={tab === 'setlist'} onClick={() => setTab('setlist')}>
          <Music size={16} /> Walkout setlist
          <span className="ml-1 text-[10px] text-white/40 font-normal">
            ({players.filter((p) => p.walkoutSongUrl).length}/{players.length})
          </span>
        </TabButton>
        <TabButton active={tab === 'show'} onClick={() => setTab('show')}>
          <Mic size={16} /> Run the show
        </TabButton>
        <div className="ml-auto flex items-center gap-2 text-white/60 text-xs pb-3">
          <Volume2 size={14} />
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            className="w-24"
          />
          <span className="w-8 text-right">{Math.round(volume * 100)}%</span>
        </div>
      </div>

      {tab === 'setlist' && (
        <SetlistTab
          players={players}
          onPickFor={(p) => setPickerForPlayerId(p.id)}
          onClear={async (p) => {
            await fetch('/api/dj/save-walkout', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                playerId: p.id,
                eventId,
                songUrl: null,
                songTitle: null,
                songArtist: null,
                startSeconds: 0,
              }),
            });
            setPlayers((prev) =>
              prev.map((x) =>
                x.id === p.id
                  ? {
                      ...x,
                      walkoutSongUrl: null,
                      walkoutSongTitle: null,
                      walkoutSongArtist: null,
                      walkoutSongStartSeconds: 0,
                      walkoutAnnouncerAudioUrl: null,
                    }
                  : x
              )
            );
          }}
        />
      )}

      {tab === 'show' && (
        <ShowTab
          eventId={eventId}
          eventName={eventName}
          players={players}
          rounds={rounds}
          matches={matches}
          scoring={scoring}
          volume={volume}
        />
      )}

      {pickerForPlayerId && (
        <WalkoutSongPicker
          eventId={eventId}
          player={players.find((p) => p.id === pickerForPlayerId)!}
          onClose={() => setPickerForPlayerId(null)}
          onSave={async (track, startSeconds) => {
            const res = await fetch('/api/dj/save-walkout', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                playerId: pickerForPlayerId,
                eventId,
                songUrl: track.audioUrl,
                songTitle: track.title,
                songArtist: track.user,
                startSeconds,
              }),
            });
            if (res.ok) {
              setPlayers((prev) =>
                prev.map((p) =>
                  p.id === pickerForPlayerId
                    ? {
                        ...p,
                        walkoutSongUrl: track.audioUrl,
                        walkoutSongTitle: track.title,
                        walkoutSongArtist: track.user,
                        walkoutSongStartSeconds: startSeconds,
                        walkoutAnnouncerAudioUrl: null,
                      }
                    : p
                )
              );
              setPickerForPlayerId(null);
            } else {
              const err = await res.json();
              alert(err.message || 'Could not save walkout song');
            }
          }}
          volume={volume}
        />
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
        active ? 'text-yellow-300 border-yellow-300' : 'text-white/50 border-transparent hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

// ============================================================
// Setlist tab — assign songs to players
// ============================================================
function SetlistTab({
  players,
  onPickFor,
  onClear,
}: {
  players: Player[];
  onPickFor: (p: Player) => void;
  onClear: (p: Player) => void;
}) {
  if (players.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-[#002838] p-12 text-center text-white/50">
        Add players to this event before setting walkout songs.
      </div>
    );
  }
  const withSong = players.filter((p) => p.walkoutSongUrl).length;
  return (
    <div>
      <div className="mb-4 text-sm text-white/60">
        Assign each player a walkout song. {withSong < players.length && (
          <span className="text-yellow-300">{players.length - withSong} player{players.length - withSong === 1 ? '' : 's'} still need{players.length - withSong === 1 ? 's' : ''} a song.</span>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {players.map((p) => (
          <div key={p.id} className="rounded-xl border border-white/10 bg-[#002838] p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-orange-400/10 text-orange-400 font-semibold flex items-center justify-center">
              {p.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-white truncate">{p.name}</div>
              {p.walkoutSongTitle ? (
                <div className="text-xs text-white/50 truncate flex items-center gap-1">
                  <Music size={11} /> {p.walkoutSongTitle}
                  {p.walkoutSongArtist && <span className="text-white/30"> · {p.walkoutSongArtist}</span>}
                  {p.walkoutSongStartSeconds > 0 && <span className="text-white/30"> · @{p.walkoutSongStartSeconds}s</span>}
                </div>
              ) : (
                <div className="text-xs text-white/40">No walkout song yet</div>
              )}
            </div>
            {p.walkoutSongTitle && (
              <button onClick={() => onClear(p)} className="px-2 py-1 text-xs text-white/40 hover:text-white/70" title="Clear">
                <X size={14} />
              </button>
            )}
            <button
              onClick={() => onPickFor(p)}
              className="px-3 py-2 text-xs font-medium rounded-lg bg-yellow-300/10 hover:bg-yellow-300/20 text-yellow-300 flex items-center gap-1 flex-shrink-0"
            >
              <Search size={12} />
              {p.walkoutSongTitle ? 'Change' : 'Pick song'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Show tab — script-driven performance
// ============================================================
type RunState =
  | { kind: 'idle' }
  | { kind: 'preparing'; cueId: string; index: number }
  | { kind: 'playing'; index: number; phase: 'announcer' | 'song' }
  | { kind: 'paused'; index: number };

function ShowTab({
  eventId,
  eventName,
  players,
  rounds,
  matches,
  scoring,
  volume,
}: {
  eventId: string;
  eventName: string;
  players: Player[];
  rounds: Round[];
  matches: Match[];
  scoring?: ScoringInfo;
  volume: number;
}) {
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(rounds[0]?.id ?? null);
  const [walkoutSec, setWalkoutSec] = useState(DEFAULT_WALKOUT_SEC);
  const [includeCourtIntros, setIncludeCourtIntros] = useState(true);
  const [includeScoringInfo, setIncludeScoringInfo] = useState(false);
  const [includeHype, setIncludeHype] = useState(false);
  const initialRound = rounds[0];
  const [openingText, setOpeningText] = useState(() =>
    initialRound ? defaultOpeningText(initialRound.roundNumber, eventName) : ''
  );
  const [closingText, setClosingText] = useState(() => defaultClosingText());
  // Track which round each text was generated for, so switching round re-fills defaults
  const [openingDefaultsForRoundId, setOpeningDefaultsForRoundId] = useState(initialRound?.id ?? null);
  const [showOptions, setShowOptions] = useState(false);
  const [runState, setRunState] = useState<RunState>({ kind: 'idle' });
  const [textOverrides, setTextOverrides] = useState<Record<string, string>>({});
  const [rehearseOpen, setRehearseOpen] = useState(false);

  const announcerRef = useRef<HTMLAudioElement | null>(null);
  const songRef = useRef<HTMLAudioElement | null>(null);
  const fadeTimerRef = useRef<any>(null);
  const customAudioUrlRef = useRef<string | null>(null);

  const round = useMemo(
    () => rounds.find((r) => r.id === selectedRoundId) ?? null,
    [rounds, selectedRoundId]
  );

  // When the round changes, refresh the opening text default unless the user has customized it
  // away from the previous round's default. We track openingDefaultsForRoundId to know when a
  // round switch happens; if the current openingText still matches the previous round's
  // default, we replace it with the new round's default. If the user typed something custom,
  // we leave their edit alone.
  useEffect(() => {
    if (!round) return;
    if (round.id === openingDefaultsForRoundId) return;
    const prevRound = rounds.find((r) => r.id === openingDefaultsForRoundId);
    const prevDefault = prevRound ? defaultOpeningText(prevRound.roundNumber, eventName) : '';
    const userCustomized = openingText.trim() !== '' && openingText.trim() !== prevDefault.trim();
    if (!userCustomized) {
      setOpeningText(defaultOpeningText(round.roundNumber, eventName));
    }
    setOpeningDefaultsForRoundId(round.id);
    // closingText doesn't depend on round number — leave it alone
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round?.id]);

  // Find the prior round (one with a smaller round_number than current) for hype highlights
  const priorMatches: ScriptMatch[] = useMemo(() => {
    if (!round) return [];
    const priorRound = rounds
      .filter((r) => r.roundNumber < round.roundNumber)
      .sort((a, b) => b.roundNumber - a.roundNumber)[0];
    if (!priorRound) return [];
    return matches
      .filter((m) => m.roundId === priorRound.id)
      .map((m) => ({
        id: m.id,
        roundId: m.roundId,
        courtNumber: m.courtNumber,
        playerIds: m.playerIds,
        team1Score: m.team1Score,
        team2Score: m.team2Score,
        winnerTeam: m.winnerTeam ?? null,
      }));
  }, [rounds, round, matches]);

  const cues: Cue[] = useMemo(() => {
    if (!round) return [];
    const generated = generateScript(round, matches, players, {
      eventName,
      walkoutDurationSec: walkoutSec,
      includeCourtIntros,
      includeScoringInfo,
      includeHype,
      openingText,
      closingText,
      scoring,
      priorMatches,
    });
    // Apply text overrides from rehearsal edits
    return generated.map((c) => {
      const override = textOverrides[c.id];
      if (!override) return c;
      if (c.kind === 'player') return { ...c, announcerText: override };
      return { ...c, text: override };
    });
  }, [round, matches, players, eventName, walkoutSec, includeCourtIntros, includeScoringInfo, includeHype, openingText, closingText, scoring, priorMatches, textOverrides]);

  // Volume sync
  useEffect(() => {
    if (announcerRef.current) announcerRef.current.volume = volume;
    if (songRef.current) songRef.current.volume = volume;
  }, [volume]);

  function stopAll() {
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    if (announcerRef.current) {
      announcerRef.current.pause();
      announcerRef.current.currentTime = 0;
    }
    if (songRef.current) {
      songRef.current.pause();
      songRef.current.currentTime = 0;
    }
    if (customAudioUrlRef.current) {
      URL.revokeObjectURL(customAudioUrlRef.current);
      customAudioUrlRef.current = null;
    }
    setRunState({ kind: 'idle' });
  }

  async function fetchAnnouncerForCue(cue: Cue): Promise<string> {
    const isOverridden = !!textOverrides[cue.id];
    if (cue.kind === 'player' && !isOverridden) {
      // Use cached per-player announcer (saves on ElevenLabs cost)
      const res = await fetch('/api/dj/announcer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: cue.playerId,
          eventId,
          courtNumber: cue.courtNumber,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'announcer_failed');
      return data.url;
    }
    // Custom text path: opening / hype / court_intro / closing / overridden player cue
    const text = cueSpokenText(cue);
    const res = await fetch('/api/dj/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, eventId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || 'speak_failed');
    }
    const blob = await res.blob();
    if (customAudioUrlRef.current) URL.revokeObjectURL(customAudioUrlRef.current);
    const url = URL.createObjectURL(blob);
    customAudioUrlRef.current = url;
    return url;
  }

  async function playCueAt(index: number) {
    if (index < 0 || index >= cues.length) {
      stopAll();
      return;
    }
    const cue = cues[index];
    setRunState({ kind: 'preparing', cueId: cue.id, index });

    let announcerUrl: string;
    try {
      announcerUrl = await fetchAnnouncerForCue(cue);
    } catch (err: any) {
      alert(err?.message || 'Could not generate announcer audio.');
      stopAll();
      return;
    }

    const announcer = announcerRef.current!;
    announcer.src = announcerUrl;
    announcer.volume = volume;

    // Wire up onended *before* playing
    announcer.onended = () => {
      if (cue.kind === 'player' && cue.walkoutSongUrl) {
        const song = songRef.current!;
        song.src = cue.walkoutSongUrl;
        song.volume = volume;
        song.currentTime = cue.walkoutSongStartSeconds || 0;
        setRunState({ kind: 'playing', index, phase: 'song' });
        song.play().catch((e) => console.error('walkout play failed', e));
        const playMs = (walkoutSec - FADE_OUT_SEC) * 1000;
        fadeTimerRef.current = setTimeout(() => {
          fadeOut(song, FADE_OUT_SEC, () => {
            song.pause();
            // Auto-pause between cues — operator hits Next when ready
            setRunState({ kind: 'paused', index });
          });
        }, playMs);
      } else {
        // No song to play — just pause for operator to hit Next
        setRunState({ kind: 'paused', index });
      }
    };

    setRunState({ kind: 'playing', index, phase: 'announcer' });
    try {
      await announcer.play();
    } catch (err) {
      console.error('announcer play failed', err);
      setRunState({ kind: 'paused', index });
    }
  }

  function next() {
    if (runState.kind === 'idle') {
      playCueAt(0);
    } else {
      const cur = (runState as any).index ?? 0;
      // Stop current playback first
      if (announcerRef.current) {
        announcerRef.current.pause();
        announcerRef.current.onended = null;
      }
      if (songRef.current) songRef.current.pause();
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
      playCueAt(cur + 1);
    }
  }

  function previous() {
    if (runState.kind === 'idle') return;
    const cur = (runState as any).index ?? 0;
    if (cur === 0) return;
    if (announcerRef.current) {
      announcerRef.current.pause();
      announcerRef.current.onended = null;
    }
    if (songRef.current) songRef.current.pause();
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    playCueAt(cur - 1);
  }

  function pause() {
    if (announcerRef.current && !announcerRef.current.paused) announcerRef.current.pause();
    if (songRef.current && !songRef.current.paused) songRef.current.pause();
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    if (runState.kind === 'playing') {
      setRunState({ kind: 'paused', index: runState.index });
    }
  }

  function resume() {
    if (runState.kind !== 'paused') return;
    if (announcerRef.current && announcerRef.current.src && announcerRef.current.currentTime < (announcerRef.current.duration || 0)) {
      announcerRef.current.play();
      setRunState({ kind: 'playing', index: runState.index, phase: 'announcer' });
      return;
    }
    if (songRef.current && songRef.current.src && songRef.current.currentTime < (songRef.current.duration || 0)) {
      songRef.current.play();
      setRunState({ kind: 'playing', index: runState.index, phase: 'song' });
      const remainingMs = ((walkoutSec - FADE_OUT_SEC) - songRef.current.currentTime) * 1000;
      if (remainingMs > 0) {
        fadeTimerRef.current = setTimeout(() => {
          fadeOut(songRef.current!, FADE_OUT_SEC, () => {
            songRef.current!.pause();
            setRunState({ kind: 'paused', index: runState.index });
          });
        }, remainingMs);
      }
      return;
    }
    // Nothing left — advance
    playCueAt(runState.index + 1);
  }

  if (rounds.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-[#002838] p-12 text-center">
        <div className="text-white/50">No rounds yet for this event.</div>
        <div className="text-white/40 text-sm mt-2">Generate rounds from the event page first, then come back here to run a scripted show.</div>
      </div>
    );
  }

  const songsAssigned = players.filter((p) => p.walkoutSongUrl).length;
  const songsMissing = players.length - songsAssigned;
  const totalSec = totalDurationSec(cues);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  const currentIndex = runState.kind === 'idle' ? -1 : (runState as any).index;

  return (
    <div>
      <audio ref={announcerRef} />
      <audio ref={songRef} />

      {/* Top: round picker + show options */}
      <div className="rounded-2xl border border-white/10 bg-[#002838] p-5 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Flag size={16} className="text-yellow-300" />
            <span className="text-white/60 text-sm">Running</span>
            <select
              value={selectedRoundId || ''}
              onChange={(e) => setSelectedRoundId(e.target.value)}
              className="bg-white/5 border border-white/10 text-white text-sm rounded-lg px-3 py-2"
            >
              {rounds.map((r) => (
                <option key={r.id} value={r.id}>
                  Round {r.roundNumber}
                  {r.status === 'completed' ? ' (completed)' : r.status === 'in_progress' ? ' (live)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="text-xs text-white/40">
            {cues.length} cues · ~{minutes}m {seconds}s total
          </div>
          {songsMissing > 0 && (
            <div className="text-xs text-yellow-300 ml-auto">
              ⚠ {songsMissing} player{songsMissing === 1 ? '' : 's'} missing a walkout song — they'll get an announcer-only intro.
            </div>
          )}
          <button
            onClick={() => setShowOptions((v) => !v)}
            className="ml-auto text-xs text-white/60 hover:text-white flex items-center gap-1"
          >
            <Wand2 size={12} /> Show options <ChevronDown size={12} className={showOptions ? 'rotate-180' : ''} />
          </button>
        </div>

        {showOptions && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-white/10">
            <div>
              <label className="text-xs text-white/60 block mb-1">Walkout song duration (sec)</label>
              <input
                type="range"
                min={6}
                max={30}
                value={walkoutSec}
                onChange={(e) => setWalkoutSec(Number(e.target.value))}
                className="w-full"
              />
              <div className="text-xs text-white/40 text-right">{walkoutSec}s</div>
            </div>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-xs text-white/60 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeCourtIntros}
                  onChange={(e) => setIncludeCourtIntros(e.target.checked)}
                  className="w-4 h-4"
                />
                Court intros ("On Court 1: Sarah and Mike vs Lisa and Tom")
              </label>
              <label className="flex items-center gap-2 text-xs text-white/60 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeScoringInfo}
                  onChange={(e) => setIncludeScoringInfo(e.target.checked)}
                  disabled={!scoring?.scoringFormat}
                  className="w-4 h-4"
                />
                Add scoring rules to court intros{' '}
                {scoring?.scoringFormat ? (
                  <span className="text-white/30">({(scoring.scoringFormat || '').replace(/_/g, ' ')})</span>
                ) : (
                  <span className="text-white/30">(no scoring set)</span>
                )}
              </label>
              <label className={`flex items-center gap-2 text-xs cursor-pointer ${priorMatches.length === 0 ? 'text-white/30' : 'text-white/60'}`}>
                <input
                  type="checkbox"
                  checked={includeHype}
                  onChange={(e) => setIncludeHype(e.target.checked)}
                  disabled={priorMatches.length === 0}
                  className="w-4 h-4"
                />
                Hype highlights from previous round{' '}
                {priorMatches.length === 0 ? (
                  <span className="text-white/20">(no prior round yet)</span>
                ) : (
                  <span className="text-white/30">({priorMatches.filter((m) => m.winnerTeam).length} results available)</span>
                )}
              </label>
            </div>
            <div className="md:col-span-2">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-white/60">Opening line</label>
                <button
                  type="button"
                  onClick={() => setOpeningText(round ? defaultOpeningText(round.roundNumber, eventName) : '')}
                  className="text-[10px] text-white/40 hover:text-white/70 uppercase tracking-wider"
                >
                  Reset to default
                </button>
              </div>
              <textarea
                value={openingText}
                onChange={(e) => setOpeningText(e.target.value)}
                rows={2}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm resize-y"
              />
            </div>
            <div className="md:col-span-2">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-white/60">Closing line</label>
                <button
                  type="button"
                  onClick={() => setClosingText(defaultClosingText())}
                  className="text-[10px] text-white/40 hover:text-white/70 uppercase tracking-wider"
                >
                  Reset to default
                </button>
              </div>
              <textarea
                value={closingText}
                onChange={(e) => setClosingText(e.target.value)}
                rows={2}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm resize-y"
              />
            </div>
          </div>
        )}
      </div>

      {/* Run controls */}
      <div className="rounded-2xl border border-yellow-300/30 bg-yellow-300/5 p-4 mb-4 flex items-center gap-3 flex-wrap">
        {runState.kind === 'idle' && (
          <>
            <button
              onClick={() => setRehearseOpen(true)}
              disabled={cues.length === 0}
              className="px-5 py-3 rounded-xl bg-white/10 hover:bg-white/15 text-white font-semibold flex items-center gap-2 disabled:opacity-50"
            >
              <Wand2 size={18} /> Rehearse script
            </button>
            <button
              onClick={() => playCueAt(0)}
              disabled={cues.length === 0}
              className="px-5 py-3 rounded-xl bg-yellow-300 text-[#001820] font-semibold flex items-center gap-2 hover:bg-yellow-200 disabled:opacity-50"
            >
              <Play size={18} /> Start show
            </button>
            {Object.keys(textOverrides).length > 0 && (
              <span className="text-xs text-yellow-300/80">
                {Object.keys(textOverrides).length} cue{Object.keys(textOverrides).length === 1 ? '' : 's'} edited in rehearsal
              </span>
            )}
          </>
        )}

        {runState.kind === 'preparing' && (
          <button disabled className="px-5 py-3 rounded-xl bg-yellow-300/30 text-yellow-300 font-semibold flex items-center gap-2">
            <Loader2 size={18} className="animate-spin" /> Preparing audio…
          </button>
        )}

        {runState.kind === 'playing' && (
          <>
            <button
              onClick={previous}
              disabled={currentIndex === 0}
              className="px-3 py-3 rounded-xl bg-white/10 hover:bg-white/15 text-white disabled:opacity-30"
              title="Previous cue"
            >
              <SkipBack size={18} />
            </button>
            <button
              onClick={pause}
              className="px-5 py-3 rounded-xl bg-yellow-300 text-[#001820] font-semibold flex items-center gap-2 hover:bg-yellow-200"
            >
              <Pause size={18} /> Pause
            </button>
            <button
              onClick={next}
              className="px-3 py-3 rounded-xl bg-white/10 hover:bg-white/15 text-white"
              title="Skip to next cue"
            >
              <SkipForward size={18} />
            </button>
            <div className="ml-2 text-xs text-yellow-300/80">
              Now playing cue {currentIndex + 1}/{cues.length}
              {runState.phase === 'song' && ' · walkout song'}
            </div>
          </>
        )}

        {runState.kind === 'paused' && (
          <>
            <button
              onClick={previous}
              disabled={currentIndex === 0}
              className="px-3 py-3 rounded-xl bg-white/10 hover:bg-white/15 text-white disabled:opacity-30"
              title="Previous cue"
            >
              <SkipBack size={18} />
            </button>
            <button
              onClick={resume}
              className="px-5 py-3 rounded-xl bg-yellow-300 text-[#001820] font-semibold flex items-center gap-2 hover:bg-yellow-200"
            >
              <Play size={18} /> Resume
            </button>
            <button
              onClick={() => playCueAt(currentIndex + 1)}
              disabled={currentIndex >= cues.length - 1}
              className="px-5 py-3 rounded-xl bg-yellow-300/20 hover:bg-yellow-300/30 text-yellow-300 font-semibold flex items-center gap-2 disabled:opacity-30"
            >
              <SkipForward size={18} /> Next cue
            </button>
            <div className="ml-2 text-xs text-yellow-300/80">
              Paused at {currentIndex + 1}/{cues.length} — hit Next when player is ready
            </div>
          </>
        )}

        {runState.kind !== 'idle' && (
          <button
            onClick={stopAll}
            className="ml-auto px-3 py-3 rounded-xl bg-red-400/20 hover:bg-red-400/30 text-red-300 flex items-center gap-1"
          >
            <Square size={16} /> Stop
          </button>
        )}
      </div>

      {/* Script timeline */}
      <div className="rounded-2xl border border-white/10 bg-[#002838] overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10 text-white/50 text-xs uppercase tracking-wider">
          Show script
        </div>
        <div className="divide-y divide-white/5">
          {cues.map((c, i) => (
            <CueRow
              key={c.id}
              cue={c}
              index={i}
              isCurrent={i === currentIndex}
              isPast={i < currentIndex}
              onJump={() => playCueAt(i)}
              isOverridden={!!textOverrides[c.id]}
            />
          ))}
        </div>
      </div>

      {rehearseOpen && (
        <RehearsalModal
          cues={cues}
          eventName={eventName}
          roundNumber={round?.roundNumber ?? 0}
          existingOverrides={textOverrides}
          onClose={() => setRehearseOpen(false)}
          onApprove={(overrides) => {
            setTextOverrides(overrides);
            setRehearseOpen(false);
          }}
        />
      )}
    </div>
  );
}

function CueRow({
  cue,
  index,
  isCurrent,
  isPast,
  onJump,
  isOverridden,
}: {
  cue: Cue;
  index: number;
  isCurrent: boolean;
  isPast: boolean;
  onJump: () => void;
  isOverridden?: boolean;
}) {
  const icon =
    cue.kind === 'opening' ? <Megaphone size={14} className="text-yellow-300" /> :
    cue.kind === 'hype' ? <Sparkles size={14} className="text-pink-400" /> :
    cue.kind === 'court_intro' ? <Flag size={14} className="text-emerald-400" /> :
    cue.kind === 'player' ? <Mic size={14} className="text-orange-400" /> :
    <Sparkles size={14} className="text-yellow-300" />;

  const label =
    cue.kind === 'opening' ? 'Opening' :
    cue.kind === 'hype' ? 'Hype' :
    cue.kind === 'court_intro' ? `Court ${cue.courtNumber} intro` :
    cue.kind === 'player' ? `Court ${cue.courtNumber} · ${cue.playerName}` :
    'Closing';

  const detail =
    cue.kind === 'player' && cue.walkoutSongTitle
      ? `${cue.announcerText} → ♪ ${cue.walkoutSongTitle}`
      : cue.kind === 'player'
        ? cue.announcerText
        : (cue as any).text;

  return (
    <div
      className={`px-4 py-3 flex items-center gap-3 cursor-pointer transition-colors ${
        isCurrent ? 'bg-yellow-300/10' : isPast ? 'opacity-50' : 'hover:bg-white/[0.03]'
      }`}
      onClick={onJump}
    >
      <div className="text-xs text-white/30 w-8">{String(index + 1).padStart(2, '0')}</div>
      <div className="flex items-center gap-2 w-44 flex-shrink-0">
        {icon}
        <span className="text-xs text-white/60 font-medium">{label}</span>
      </div>
      <div className="flex-1 min-w-0 text-sm text-white/80 truncate">
        {detail}
        {isOverridden && (
          <span className="ml-2 text-[10px] text-yellow-300/70 uppercase tracking-wider">edited</span>
        )}
      </div>
      <div className="text-xs text-white/30 w-12 text-right">{cue.durationSec}s</div>
    </div>
  );
}

// ============================================================
// Rehearsal modal — preview the script the announcer will read,
// edit any line, approve & lock in for the show
// ============================================================
function RehearsalModal({
  cues,
  eventName,
  roundNumber,
  existingOverrides,
  onClose,
  onApprove,
}: {
  cues: Cue[];
  eventName: string;
  roundNumber: number;
  existingOverrides: Record<string, string>;
  onClose: () => void;
  onApprove: (overrides: Record<string, string>) => void;
}) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);

  function getCurrentText(cue: Cue): string {
    if (edits[cue.id] != null) return edits[cue.id];
    if (existingOverrides[cue.id] != null) return existingOverrides[cue.id];
    return cueSpokenText(cue);
  }

  function setEdit(cueId: string, text: string) {
    setEdits((prev) => ({ ...prev, [cueId]: text }));
  }

  function resetCue(cueId: string) {
    setEdits((prev) => {
      const next = { ...prev };
      delete next[cueId];
      return next;
    });
  }

  function approve() {
    // Merge: existing overrides + new edits, dropping any that match the cue's default text
    const merged: Record<string, string> = { ...existingOverrides };
    for (const cue of cues) {
      const edited = edits[cue.id];
      if (edited == null) continue;
      const defaultText = cueSpokenText(cue);
      if (edited.trim() === defaultText.trim()) {
        delete merged[cue.id];
      } else {
        merged[cue.id] = edited;
      }
    }
    onApprove(merged);
  }

  function clearAllOverrides() {
    setEdits(Object.fromEntries(cues.map((c) => [c.id, cueSpokenText(c)])));
  }

  const totalEdits = Object.keys({ ...existingOverrides, ...edits }).filter((id) => {
    const cue = cues.find((c) => c.id === id);
    if (!cue) return false;
    const final = edits[id] ?? existingOverrides[id];
    return final != null && final.trim() !== cueSpokenText(cue).trim();
  }).length;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#002838] border border-white/10 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-5 border-b border-white/10 flex items-center justify-between">
          <div>
            <div className="text-xs text-yellow-300 uppercase tracking-wider flex items-center gap-1">
              <Wand2 size={12} /> Rehearsal mode
            </div>
            <div className="font-display text-xl text-white">
              {eventName} — Round {roundNumber} script preview
            </div>
            <div className="text-xs text-white/50 mt-1">
              This is exactly what the announcer voice will say. Click any line to edit before going live.
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-white/50 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-3">
          {cues.map((c, i) => {
            const text = getCurrentText(c);
            const defaultText = cueSpokenText(c);
            const edited = text.trim() !== defaultText.trim();
            const isEditing = editingId === c.id;

            const labelClass =
              c.kind === 'opening' ? 'text-yellow-300' :
              c.kind === 'hype' ? 'text-pink-400' :
              c.kind === 'court_intro' ? 'text-emerald-400' :
              c.kind === 'player' ? 'text-orange-400' :
              'text-yellow-300';

            const label =
              c.kind === 'opening' ? 'OPENING' :
              c.kind === 'hype' ? 'HYPE' :
              c.kind === 'court_intro' ? `COURT ${c.courtNumber} INTRO` :
              c.kind === 'player' ? `COURT ${c.courtNumber} · ${c.playerName.toUpperCase()}` :
              'CLOSING';

            return (
              <div
                key={c.id}
                className={`rounded-xl border p-4 ${
                  edited ? 'border-yellow-300/40 bg-yellow-300/5' : 'border-white/10 bg-white/[0.02]'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs text-white/30 font-mono w-8">{String(i + 1).padStart(2, '0')}</span>
                  <span className={`text-[10px] font-semibold tracking-wider ${labelClass}`}>{label}</span>
                  {edited && (
                    <span className="text-[10px] text-yellow-300/70 uppercase tracking-wider">edited</span>
                  )}
                  {c.kind === 'player' && c.walkoutSongTitle && (
                    <span className="text-xs text-white/40 ml-auto flex items-center gap-1">
                      <Music size={11} /> ♪ {c.walkoutSongTitle}
                    </span>
                  )}
                </div>
                {isEditing ? (
                  <textarea
                    autoFocus
                    value={text}
                    onChange={(e) => setEdit(c.id, e.target.value)}
                    onBlur={() => setEditingId(null)}
                    rows={3}
                    className="w-full bg-white/5 border border-yellow-300/30 rounded-lg px-3 py-2 text-white text-sm resize-y focus:outline-none focus:border-yellow-300"
                  />
                ) : (
                  <div
                    onClick={() => setEditingId(c.id)}
                    className="text-white text-sm leading-relaxed cursor-text hover:bg-white/[0.02] rounded px-2 py-1 -mx-2 -my-1"
                  >
                    {text}
                  </div>
                )}
                {edited && !isEditing && (
                  <button
                    onClick={() => resetCue(c.id)}
                    className="mt-2 text-[10px] text-white/40 hover:text-white/70 uppercase tracking-wider"
                  >
                    Reset to default
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="p-4 border-t border-white/10 bg-[#001820] flex items-center gap-3 flex-wrap">
          <div className="text-xs text-white/50">
            {totalEdits === 0 ? 'Nothing edited yet. Click any line above to change it.' : `${totalEdits} line${totalEdits === 1 ? '' : 's'} edited.`}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {totalEdits > 0 && (
              <button
                onClick={clearAllOverrides}
                className="px-3 py-2 rounded-lg text-white/60 hover:text-white text-sm"
              >
                Reset all
              </button>
            )}
            <button onClick={onClose} className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white text-sm">
              Cancel
            </button>
            <button
              onClick={approve}
              className="px-4 py-2 rounded-lg bg-yellow-300 text-[#001820] text-sm font-medium hover:bg-yellow-200"
            >
              Approve &amp; lock in
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Walkout song picker (Pixabay)
// ============================================================
function WalkoutSongPicker({
  eventId,
  player,
  onClose,
  onSave,
  volume,
}: {
  eventId: string;
  player: Player;
  onClose: () => void;
  onSave: (track: PixabayTrack, startSeconds: number) => void;
  volume: number;
}) {
  const [query, setQuery] = useState('walkout hype');
  const [tracks, setTracks] = useState<PixabayTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [selectedTrack, setSelectedTrack] = useState<PixabayTrack | null>(null);
  const [startSeconds, setStartSeconds] = useState(0);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  async function search(q: string) {
    setLoading(true);
    setQuery(q);
    try {
      const res = await fetch(`/api/dj/pixabay-search?q=${encodeURIComponent(q)}&eventId=${eventId}`);
      const data = await res.json();
      if (res.ok) setTracks(data.tracks || []);
      else alert(data.message || 'Search failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    search(query);
    return () => {
      if (previewAudioRef.current) previewAudioRef.current.pause();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function previewToggle(track: PixabayTrack) {
    if (!previewAudioRef.current) return;
    if (previewId === track.id) {
      previewAudioRef.current.pause();
      setPreviewId(null);
      return;
    }
    previewAudioRef.current.src = track.previewUrl || track.audioUrl;
    previewAudioRef.current.volume = volume;
    previewAudioRef.current.currentTime = 0;
    previewAudioRef.current.play();
    setPreviewId(track.id);
    previewAudioRef.current.onended = () => setPreviewId(null);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end md:items-center justify-center p-4">
      <audio ref={previewAudioRef} />
      <div className="bg-[#002838] border border-white/10 rounded-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <div className="p-5 border-b border-white/10 flex items-center justify-between">
          <div>
            <div className="text-xs text-white/40 uppercase tracking-wider">Walkout song for</div>
            <div className="font-display text-xl text-white">{player.name}</div>
          </div>
          <button onClick={onClose} className="p-2 text-white/50 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 border-b border-white/10 flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search(query)}
            placeholder="Try: walkout, hype, rock, hip hop, anthem…"
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder:text-white/30 text-sm"
          />
          <button
            onClick={() => search(query)}
            className="px-4 py-2 rounded-lg bg-yellow-300 text-[#001820] text-sm font-medium hover:bg-yellow-200 disabled:opacity-50"
            disabled={loading}
          >
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-4">
          {loading && tracks.length === 0 ? (
            <div className="text-white/50 text-center py-12">Loading…</div>
          ) : tracks.length === 0 ? (
            <div className="text-white/40 text-center py-12">No tracks found.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {tracks.map((t) => {
                const isSelected = selectedTrack?.id === t.id;
                const isPreviewing = previewId === t.id;
                return (
                  <div
                    key={t.id}
                    onClick={() => setSelectedTrack(t)}
                    className={`rounded-xl border p-3 cursor-pointer transition-colors ${
                      isSelected
                        ? 'border-yellow-300/50 bg-yellow-300/5'
                        : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          previewToggle(t);
                        }}
                        className="w-9 h-9 rounded-full bg-yellow-300/10 hover:bg-yellow-300/20 text-yellow-300 flex items-center justify-center flex-shrink-0"
                      >
                        {isPreviewing ? <Square size={14} /> : <Play size={14} />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="text-white text-sm font-medium truncate">{t.title}</div>
                        <div className="text-white/40 text-xs truncate">
                          {t.user} · {t.duration}s
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {selectedTrack && (
          <div className="p-4 border-t border-white/10 bg-[#001820]">
            <div className="text-xs text-white/50 mb-2">
              Selected: <span className="text-white">{selectedTrack.title}</span>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-xs text-white/60 flex-shrink-0">Start at</label>
              <input
                type="range"
                min={0}
                max={Math.max(0, selectedTrack.duration - 10)}
                value={startSeconds}
                onChange={(e) => setStartSeconds(Number(e.target.value))}
                className="flex-1"
              />
              <div className="text-xs text-white w-12 text-right">{startSeconds}s</div>
              <button
                onClick={() => onSave(selectedTrack, startSeconds)}
                className="px-4 py-2 rounded-lg bg-yellow-300 text-[#001820] text-sm font-medium hover:bg-yellow-200"
              >
                Save walkout song
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function fadeOut(el: HTMLAudioElement, durationSec: number, onDone: () => void) {
  const startVol = el.volume;
  const startTime = Date.now();
  const interval = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    const t = Math.min(1, elapsed / durationSec);
    el.volume = Math.max(0, startVol * (1 - t));
    if (t >= 1) {
      clearInterval(interval);
      el.volume = startVol;
      onDone();
    }
  }, 50);
}

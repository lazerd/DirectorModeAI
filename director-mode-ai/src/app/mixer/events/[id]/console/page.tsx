'use client';

/**
 * Live Director Console — TV-friendly all-courts view.
 *
 * Designed to be cast to a TV in the tournament office. Shows every court
 * with the current match in progress and what's on deck. Director can
 * click a match to mark it complete (which triggers downstream auto-reflow
 * via the existing score-submission endpoint).
 *
 * Auto-refreshes every 30 seconds.
 *
 * URL: /mixer/events/[id]/console
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, Megaphone, RefreshCw, Tv, Volume2, VolumeX } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatTimeDisplay, resolveCourtList } from '@/lib/quads';

type Event = {
  id: string;
  name: string;
  match_format: string;
  num_courts: number;
  court_names: string[] | null;
};

type Entry = {
  id: string;
  player_name: string;
  partner_name: string | null;
};

type Match = {
  id: string;
  bracket: 'main' | 'consolation';
  round: number;
  player1_id: string | null;
  player2_id: string | null;
  player3_id: string | null;
  player4_id: string | null;
  status: string;
  court: string | null;
  scheduled_at: string | null;
  scheduled_date: string | null;
};

const TOURNAMENT_FORMATS = new Set([
  'rr-singles', 'rr-doubles',
  'single-elim-singles', 'single-elim-doubles',
  'fmlc-singles', 'fmlc-doubles',
  'ffic-singles', 'ffic-doubles',
  'compass-singles', 'compass-doubles',
]);

const VOICE_STORAGE_KEY = 'dm:console:voice';
const RATE_STORAGE_KEY = 'dm:console:rate';

/** Phrase a team for spoken announcement — "and" reads better than "/". */
function spokenTeam(entry: Entry | undefined | null): string {
  if (!entry) return 'TBD';
  return entry.partner_name ? `${entry.player_name} and ${entry.partner_name}` : entry.player_name;
}

/** Build a single-court announcement line. */
function buildCourtAnnouncement(court: string, sideA: string, sideB: string): string {
  return `Players for Court ${court}: ${sideA}, versus ${sideB}. Please take Court ${court}.`;
}

export default function LiveConsolePage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : (params.id as string);
  const [event, setEvent] = useState<Event | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());

  // DJ mode — Web Speech API for announcing matches over the loudspeaker
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<string>('');
  const [rate, setRate] = useState(0.95);
  const [speaking, setSpeaking] = useState(false);
  const [showDjSettings, setShowDjSettings] = useState(false);
  const speechSupported =
    typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined';
  const announceQueueRef = useRef<string[]>([]);

  useEffect(() => {
    if (!speechSupported) return;
    const loadVoices = () => {
      const list = window.speechSynthesis.getVoices();
      setVoices(list);
      // Restore from localStorage, or default to first English voice
      const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(VOICE_STORAGE_KEY) : null;
      const storedRate = typeof localStorage !== 'undefined' ? localStorage.getItem(RATE_STORAGE_KEY) : null;
      if (storedRate) setRate(parseFloat(storedRate) || 0.95);
      if (stored && list.some((v) => v.voiceURI === stored)) {
        setSelectedVoice(stored);
      } else {
        const englishVoice = list.find((v) => v.lang.startsWith('en'));
        if (englishVoice) setSelectedVoice(englishVoice.voiceURI);
      }
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = null;
    };
  }, [speechSupported]);

  const speak = useCallback(
    (text: string) => {
      if (!speechSupported || !text.trim()) return;
      const voice = voices.find((v) => v.voiceURI === selectedVoice) || null;
      const utter = new SpeechSynthesisUtterance(text);
      if (voice) utter.voice = voice;
      utter.rate = rate;
      utter.volume = 1.0;
      utter.onstart = () => setSpeaking(true);
      utter.onend = () => {
        const next = announceQueueRef.current.shift();
        if (next) {
          speak(next);
        } else {
          setSpeaking(false);
        }
      };
      utter.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utter);
    },
    [speechSupported, voices, selectedVoice, rate]
  );

  const stopSpeaking = useCallback(() => {
    if (!speechSupported) return;
    announceQueueRef.current = [];
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [speechSupported]);

  const queueSpeak = useCallback(
    (lines: string[]) => {
      if (!speechSupported || lines.length === 0) return;
      announceQueueRef.current = lines.slice(1);
      speak(lines[0]);
    },
    [speechSupported, speak]
  );

  const fetchAll = useCallback(async () => {
    const supabase = createClient();
    const { data: ev } = await supabase
      .from('events')
      .select('id, name, match_format, num_courts, court_names')
      .eq('id', id)
      .maybeSingle();
    setEvent(ev as Event);
    if (!ev) {
      setLoading(false);
      return;
    }

    const isQuads = (ev as any).match_format === 'quads';
    const isTournament = TOURNAMENT_FORMATS.has((ev as any).match_format);

    if (isTournament) {
      const [eRes, mRes] = await Promise.all([
        supabase
          .from('tournament_entries')
          .select('id, player_name, partner_name')
          .eq('event_id', id),
        supabase
          .from('tournament_matches')
          .select('id, bracket, round, player1_id, player2_id, player3_id, player4_id, status, court, scheduled_at, scheduled_date')
          .eq('event_id', id),
      ]);
      setEntries((eRes.data as Entry[]) || []);
      setMatches((mRes.data as Match[]) || []);
    } else if (isQuads) {
      // Quads uses different tables; pull from there
      const [eRes, fRes] = await Promise.all([
        supabase.from('quad_entries').select('id, player_name').eq('event_id', id),
        supabase.from('quad_flights').select('id').eq('event_id', id),
      ]);
      const flightIds = ((fRes.data as any[]) || []).map((f) => f.id);
      const { data: mRes } = flightIds.length
        ? await supabase
            .from('quad_matches')
            .select('id, round, match_type, player1_id, player2_id, player3_id, player4_id, status, court, scheduled_at, scheduled_date, flight_id')
            .in('flight_id', flightIds)
        : { data: [] as any[] };
      setEntries(((eRes.data as any[]) || []).map((e) => ({ id: e.id, player_name: e.player_name, partner_name: null })));
      setMatches(
        ((mRes as any[]) || []).map((m) => ({
          id: m.id,
          bracket: 'main' as const,
          round: m.round,
          player1_id: m.player1_id,
          player2_id: m.player2_id,
          player3_id: m.player3_id,
          player4_id: m.player4_id,
          status: m.status,
          court: m.court,
          scheduled_at: m.scheduled_at,
          scheduled_date: m.scheduled_date,
        }))
      );
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchAll();
    const t = setInterval(fetchAll, 30_000); // refresh every 30s
    return () => clearInterval(t);
  }, [fetchAll]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const courts = useMemo(() => {
    if (!event) return [];
    return resolveCourtList({
      courtNames: event.court_names,
      numCourts: event.num_courts,
    });
  }, [event]);

  const labelEntry = (id: string | null): string => {
    if (!id) return 'TBD';
    const e = entries.find((x) => x.id === id);
    if (!e) return '—';
    return e.partner_name ? `${e.player_name} + ${e.partner_name}` : e.player_name;
  };

  const entryFor = (id: string | null): Entry | undefined =>
    id ? entries.find((x) => x.id === id) : undefined;

  if (loading) {
    return (
      <div className="min-h-screen bg-[#001820] text-white flex items-center justify-center">
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-[#001820] text-white flex items-center justify-center p-8">
        <div>Event not found.</div>
      </div>
    );
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  // For each court, find:
  //   - Current match: in progress / scheduled to be playing now
  //   - Next match: next scheduled match on this court that hasn't happened
  const courtState = courts.map((court) => {
    const courtMatches = matches
      .filter((m) => m.court === court && m.scheduled_at)
      .sort((a, b) => {
        const ad = (a.scheduled_date ?? todayStr) + 'T' + (a.scheduled_at ?? '00:00');
        const bd = (b.scheduled_date ?? todayStr) + 'T' + (b.scheduled_at ?? '00:00');
        return ad.localeCompare(bd);
      });

    // Current = first non-completed match whose start time has passed (within last 3 hours)
    const current = courtMatches.find((m) => {
      if (m.status === 'completed' || m.status === 'cancelled') return false;
      if (!m.scheduled_date || !m.scheduled_at) return false;
      const startMs = new Date(`${m.scheduled_date}T${m.scheduled_at.slice(0, 5)}:00`).getTime();
      return startMs <= now.getTime() && now.getTime() - startMs < 3 * 60 * 60 * 1000;
    });

    // Next = first non-completed match starting after `now`
    const next = courtMatches.find((m) => {
      if (m.status === 'completed' || m.status === 'cancelled') return false;
      if (m === current) return false;
      if (!m.scheduled_date || !m.scheduled_at) return false;
      const startMs = new Date(`${m.scheduled_date}T${m.scheduled_at.slice(0, 5)}:00`).getTime();
      return startMs > now.getTime();
    });

    return { court, current, next };
  });

  // Build "Call all courts" announcement — every court with active or upcoming match
  const announceAllCourts = () => {
    if (!speechSupported) return;
    const lines: string[] = [];
    for (const { court, current, next } of courtState) {
      const match = current ?? next;
      if (!match) continue;
      const a = spokenTeam(entryFor(match.player1_id));
      const b = spokenTeam(entryFor(match.player3_id));
      lines.push(buildCourtAnnouncement(court, a, b));
    }
    if (lines.length === 0) {
      speak('No matches scheduled to announce.');
      return;
    }
    queueSpeak([`Players, listen up. ${lines.length} courts ready.`, ...lines]);
  };

  const announceCourt = (court: string, match: Match | undefined) => {
    if (!speechSupported || !match) return;
    const a = spokenTeam(entryFor(match.player1_id));
    const b = spokenTeam(entryFor(match.player3_id));
    speak(buildCourtAnnouncement(court, a, b));
  };

  return (
    <div className="min-h-screen bg-[#001820] text-white p-4 sm:p-6 lg:p-8">
      <header className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link
            href={`/mixer/events/${id}`}
            className="p-2 hover:bg-white/10 rounded-lg"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <div className="text-xs text-white/40 uppercase tracking-wide flex items-center gap-1">
              <Tv size={12} /> Live Console
            </div>
            <h1 className="text-2xl font-bold">{event.name}</h1>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {speechSupported ? (
            <>
              <button
                onClick={speaking ? stopSpeaking : announceAllCourts}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm ${
                  speaking
                    ? 'bg-red-500 hover:bg-red-600 text-white'
                    : 'bg-[#D3FB52] hover:bg-[#bce844] text-[#001820]'
                }`}
              >
                {speaking ? <VolumeX size={16} /> : <Megaphone size={16} />}
                {speaking ? 'Stop' : 'Call to courts'}
              </button>
              <button
                onClick={() => setShowDjSettings((s) => !s)}
                className="p-2 hover:bg-white/10 rounded-lg text-white/60"
                title="DJ voice settings"
              >
                <Volume2 size={16} />
              </button>
            </>
          ) : (
            <span className="text-xs text-white/30 italic">Voice unsupported in this browser</span>
          )}
          <span className="text-xs text-white/50 inline-flex items-center gap-1">
            <RefreshCw size={12} /> 30s · {now.toLocaleTimeString()}
          </span>
        </div>
      </header>

      {showDjSettings && speechSupported && (
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6 grid sm:grid-cols-2 gap-4 max-w-2xl">
          <div>
            <label className="block text-xs uppercase tracking-wide text-white/50 mb-1">
              Voice
            </label>
            <select
              value={selectedVoice}
              onChange={(e) => {
                setSelectedVoice(e.target.value);
                if (typeof localStorage !== 'undefined')
                  localStorage.setItem(VOICE_STORAGE_KEY, e.target.value);
              }}
              className="w-full px-2 py-1.5 bg-[#002838] border border-white/10 rounded text-sm"
            >
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wide text-white/50 mb-1">
              Rate: {rate.toFixed(2)}×
            </label>
            <input
              type="range"
              min={0.5}
              max={1.3}
              step={0.05}
              value={rate}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setRate(v);
                if (typeof localStorage !== 'undefined')
                  localStorage.setItem(RATE_STORAGE_KEY, v.toString());
              }}
              className="w-full"
            />
          </div>
          <div className="sm:col-span-2 flex gap-2">
            <button
              onClick={() => speak('Players, test announcement. Please take your courts.')}
              className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded text-sm"
            >
              Test voice
            </button>
            <p className="text-xs text-white/50 self-center flex-1">
              Plug this device's audio output into your PA system. Press "Call to courts"
              to read every active + upcoming court.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {courtState.map(({ court, current, next }) => (
          <div
            key={court}
            className={`rounded-2xl p-5 border-2 ${
              current
                ? 'bg-emerald-500/10 border-emerald-400/50'
                : 'bg-white/5 border-white/10'
            }`}
          >
            <div className="flex items-center justify-between mb-3 gap-2">
              <div className="text-3xl font-bold">{court}</div>
              <div className="flex items-center gap-2">
                {speechSupported && (current || next) && (
                  <button
                    onClick={() => announceCourt(court, current ?? next)}
                    disabled={speaking}
                    title={`Announce match on Court ${court}`}
                    className="p-1.5 bg-[#D3FB52]/20 hover:bg-[#D3FB52]/30 text-[#D3FB52] rounded-lg disabled:opacity-40"
                  >
                    <Megaphone size={14} />
                  </button>
                )}
                <div
                  className={`text-xs uppercase tracking-widest font-bold px-2 py-0.5 rounded-full ${
                    current ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-white/50'
                  }`}
                >
                  {current ? '● Live' : 'Open'}
                </div>
              </div>
            </div>

            {current ? (
              <div className="space-y-2 mb-3">
                <div className="text-xs text-white/50 uppercase">In progress</div>
                <div className="font-semibold">{labelEntry(current.player1_id)}</div>
                <div className="text-xs text-white/40">vs</div>
                <div className="font-semibold">{labelEntry(current.player3_id)}</div>
                {current.scheduled_at && (
                  <div className="text-xs text-white/50">
                    Started: {formatTimeDisplay(current.scheduled_at)}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-white/40 text-sm mb-3 italic">No active match</div>
            )}

            {next && (
              <div className="border-t border-white/10 pt-3 space-y-1">
                <div className="text-xs text-white/50 uppercase">Up next</div>
                <div className="text-sm">
                  {labelEntry(next.player1_id)}{' '}
                  <span className="text-white/40">vs</span>{' '}
                  {labelEntry(next.player3_id)}
                </div>
                {next.scheduled_at && (
                  <div className="text-xs text-white/40">
                    {next.scheduled_date && next.scheduled_date !== todayStr
                      ? new Date(next.scheduled_date + 'T00:00:00').toLocaleDateString(undefined, {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        }) + ' · '
                      : ''}
                    {formatTimeDisplay(next.scheduled_at)}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {courts.length === 0 && (
        <div className="bg-white/5 rounded-xl p-8 text-center text-white/60">
          No courts configured. Add courts in Settings.
        </div>
      )}

      <div className="mt-6 text-xs text-white/40 text-center">
        Tip: cast this page to a TV in the tournament office for an at-a-glance view.
      </div>
    </div>
  );
}

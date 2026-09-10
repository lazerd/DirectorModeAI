'use client';

import { useEffect, useState } from 'react';
import MatchNextStep, { matchStage } from '@/components/captain/MatchNextStep';
import RecapPanel from '@/components/captain/RecapPanel';
import { useRouter } from 'next/navigation';
import EmailPreviewModal, { type EmailPreview } from './EmailPreviewModal';
import { lineupAsText } from '@/lib/captain/lineupText';
import { JTT_COURT_FORMATS, leagueSpec, roundClashes, roundsByCourt } from '@/lib/captain/leagues';
import { lineupPrintHtml } from '@/lib/captain/lineupPrint';
import { shrinkImage } from '@/lib/captain/shrinkImage';

export type MatchPlayer = {
  id: string;
  name: string;
  rating: number | null;
  /** World Tennis Number — LOWER is stronger, the opposite way to NTRP. */
  wtn: number | null;
  wtnDoubles: number | null;
  isSub: boolean;
  hasEmail: boolean;
  email: string | null;
  phone: string | null;
  availability: 'yes' | 'no' | 'maybe' | null;
  /**
   * The player's own qualifier on that answer — "doubles only", "first shift
   * only", "call last". A yes with a condition attached; shown wherever the
   * captain is choosing who plays, because that is the moment it matters.
   */
  availabilityNote?: string | null;
  /** Matches this player has actually played, defaulted courts excluded. */
  played: number;
  /**
   * Saved lineups naming this player on EVERY OTHER match of the season.
   * This match is excluded on purpose so the workspace can add whoever is on
   * screen right now — the count then moves as courts are swapped, which is
   * the only version of it a captain can plan against.
   */
  committedElsewhere: number;
};

/** The WTN a doubles court should be ordered on: doubles number, else singles. */
const wtnOf = (p: MatchPlayer | undefined): number | null => {
  if (!p) return null;
  const d = p.wtnDoubles;
  if (typeof d === 'number' && !Number.isNaN(d)) return d;
  return typeof p.wtn === 'number' && !Number.isNaN(p.wtn) ? p.wtn : null;
};

type Court = {
  id?: string;
  courtNumber: number;
  courtType: 'singles' | 'doubles';
  player1Id: string | null;
  player2Id: string | null;
  player1ConfirmedAt?: string | null;
  player2ConfirmedAt?: string | null;
  /** 'player' when they tapped it themselves, 'captain' when it was recorded for them. */
  player1ConfirmedSource?: string | null;
  player2ConfirmedSource?: string | null;
  notes?: string[];
};

type Explanation = { summary: string[]; benched: { name: string; reason: string }[] };

/** One person on a court, with everything needed to chase them. */
type RollCallRow = {
  playerId: string;
  name: string;
  email: string | null;
  phone: string | null;
  court: string;
  state: 'in' | 'out' | 'waiting';
  at: string | null;
  byCaptain: boolean;
};

/** What a text WOULD be, before it is one. */
type SmsPreview = {
  body: string;
  count: number;
  segments: number;
  recipients: { name: string; phone: string | null }[];
  noPhone: string[];
};

/** The lineup email's row on the season timeline, for this match. */
type AutoSend = { status: string; sendAt: string; sentAt: string | null };

/** Vercel runs UTC; the banner must speak club time or it will quote the wrong hour. */
const fmtWhen = (iso: string) =>
  new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Los_Angeles',
  }).format(new Date(iso));

const btn = 'px-4 py-2.5 rounded-xl font-semibold text-sm disabled:opacity-50 transition';
const primary = `${btn} bg-[#D3FB52] text-[#001820] hover:brightness-95`;
const ghost = `${btn} border border-white/10 text-white/70 hover:text-white hover:border-white/25`;
/** globals.css beats Tailwind on bare form elements — same fix as NeverPairPanel. */
const INPUT_COLOR = { color: '#ffffff' } as const;

export default function MatchWorkspace({
  teamId,
  matchId,
  players,
  initialLineup,
  singlesCourts,
  doublesCourts,
  lineupSent,
  matchAt,
  status,
  initialResults,
  recapSentAt,
  withdrawals,
  teamName,
  opponent,
  isHome,
  location,
  arrivalNote,
  jttCourtFormat,
}: {
  teamId: string;
  matchId: string;
  players: MatchPlayer[];
  initialLineup: Court[];
  singlesCourts: number;
  doublesCourts: number;
  lineupSent: boolean;
  matchAt: string;
  status: string;
  initialResults: {
    courtNumber: number;
    score: string | null;
    won: boolean | null;
    defaulted?: boolean;
    default_by?: 'us' | 'them' | null;
  }[];
  /** When the post-match recap last went to the team, if it has. */
  recapSentAt: string | null;
  /**
   * Who tapped "I can't play" on the lineup email. Keyed by PLAYER, not by
   * slot, so a withdrawal survives every swap and line flip below — a bail
   * belongs to the person, not the seat they happened to be in.
   */
  withdrawals: { playerId: string; at: string; note: string | null }[];
  /** Everything the shareable text needs to stand on its own outside the app. */
  teamName: string;
  opponent: string | null;
  isHome: boolean;
  location: string | null;
  arrivalNote: string | null;
  /**
   * JTT only: courts played at once (2 or 3), which decides which lines share a
   * round. Null for every other league — they have no rounds.
   */
  jttCourtFormat: number | null;
}) {
  const router = useRouter();
  const withdrawn = new Map(withdrawals.map((w) => [w.playerId, w]));
  const [courts, setCourts] = useState<Court[]>(initialLineup);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [showWhy, setShowWhy] = useState(true);
  const [handEdited, setHandEdited] = useState(false);
  const [autoSend, setAutoSend] = useState<AutoSend | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const [pendingOnlyMissing, setPendingOnlyMissing] = useState(false);
  const [previewKind, setPreviewKind] = useState<'poll' | 'lineup' | 'lineup-targeted'>('poll');
  /** Who the open preview is addressed to — set when it opens, used when it sends. */
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [smsBody, setSmsBody] = useState('');
  const [smsPreview, setSmsPreview] = useState<SmsPreview | null>(null);
  /** The shareable text, once the captain has asked to see it. */
  const [shareText, setShareText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [swapPick, setSwapPick] = useState<{ courtNumber: number; slot: 1 | 2 } | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  // datetime-local wants local wall-clock, not an ISO string with a zone.
  const [newDate, setNewDate] = useState(() => {
    const d = new Date(matchAt);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [scoring, setScoring] = useState(status === 'played');
  /**
   * Which player row has its actions open.
   *
   * Every row used to render up to four underlined links permanently — with
   * eight players that is thirty-odd controls competing with the eight names
   * the captain actually came to read. Nothing is removed; it is one tap away,
   * and a row whose player has pulled out opens itself because that one is not
   * optional.
   */
  const [rowMenu, setRowMenu] = useState<string | null>(null);

  /**
   * The manual sub picker.
   *
   * Eight seats and eleven yeses means three people are already willing and
   * already known — there is nothing to go and ask. "Find a sub" mails every
   * eligible player and waits for a race; this is the quiet other half of it,
   * for when the captain knows exactly who is stepping in.
   */
  const [subFor, setSubFor] = useState<{ courtNumber: number; slot: 1 | 2 } | null>(null);
  /** Subbing someone out normally means they genuinely cannot play — say why. */
  const [subMarkOut, setSubMarkOut] = useState(true);
  const [subNote, setSubNote] = useState('injured');

  /**
   * Only one lime button on the page at a time.
   *
   * Availability, Lineup and Results each had their own `primary`, so three
   * things shouted equally and none of them read as "the thing to do now".
   * Emphasis follows the stage the banner names, so the page has exactly one
   * obvious next click and everything else is a calm outline.
   */
  const emphasise = (...stages: string[]) => (stages.includes(stage) ? primary : ghost);
  /**
   * Courts won or lost without being played.
   *
   * The opposing team defaults a line often enough that it needs a first-class
   * control: the point counts for the team, the two players named on that court
   * do not get a match. Without this they are credited with a match they never
   * played, and a captain reading eligibility is told someone is covered when
   * they are still on zero.
   */
  const [defaulted, setDefaulted] = useState<Record<number, 'us' | 'them' | null>>(
    () =>
      Object.fromEntries(
        initialResults
          .filter((r) => (r as { defaulted?: boolean }).defaulted)
          .map((r) => [r.courtNumber, ((r as { default_by?: 'us' | 'them' }).default_by ?? 'them')]),
      ) as Record<number, 'us' | 'them' | null>,
  );
  const [scores, setScores] = useState<Record<number, { score: string; won: boolean | null }>>(
    Object.fromEntries(
      initialResults.map((r) => [r.courtNumber, { score: r.score ?? '', won: r.won }]),
    ),
  );

  const answered = players.filter((p) => p.availability !== null);
  const yes = players.filter((p) => p.availability === 'yes');
  const no = players.filter((p) => p.availability === 'no');
  const maybe = players.filter((p) => p.availability === 'maybe');
  const silent = players.filter((p) => !p.isSub && p.availability === null);
  /** JTT: courts at once for THIS match. Null = not a JTT team, so no rounds. */
  const [format, setFormat] = useState<number | null>(jttCourtFormat);
  const jttRules = format != null ? leagueSpec('jtt').multiLine : null;
  // JTT kids share the 12 slots, up to 3 lines each — 4 of them fill the sheet.
  const needed = jttRules
    ? Math.ceil((singlesCourts + doublesCourts * 2) / jttRules.maxTotal)
    : singlesCourts + doublesCourts * 2;

  /** Which round each line is played in, and anyone booked on two lines at once. */
  const roundOf = format != null ? roundsByCourt(courts, format) : null;
  const clashes = format != null ? roundClashes(courts, format) : [];

  /**
   * JTT: lay the sheet out the way it is played — round 1's lines together,
   * then round 2 — rather than every singles then every doubles. Display order
   * only: court numbers, and what is saved, never change.
   */
  const displayCourts = roundOf
    ? [...courts].sort(
        (a, b) =>
          (roundOf.get(a.courtNumber) ?? 99) - (roundOf.get(b.courtNumber) ?? 99) ||
          (a.courtType === b.courtType ? 0 : a.courtType === 'singles' ? -1 : 1) ||
          a.courtNumber - b.courtNumber,
      )
    : courts;

  const nameOf = (id: string | null) => (id ? players.find((p) => p.id === id)?.name ?? '—' : '—');

  /**
   * Only bails that still matter: someone who withdrew and has since been
   * swapped out of every court is handled, so nagging about them is noise.
   */
  const bailedInLineup = withdrawals
    .filter((w) => courts.some((c) => c.player1Id === w.playerId || c.player2Id === w.playerId))
    .map((w) => ({ ...w, name: nameOf(w.playerId) }));

  /**
   * Everyone named on a court, with what they told us. Confirmations live on
   * the slot but read as a roll-call, so flatten them here rather than making a
   * captain scan eight dropdowns for a badge.
   */
  const namedInLineup = courts.flatMap((c) =>
    ([1, 2] as const)
      .filter((slot) => slot === 1 || c.courtType === 'doubles')
      .map((slot) => {
        const pid = slot === 1 ? c.player1Id : c.player2Id;
        if (!pid) return null;
        const player = players.find((p) => p.id === pid);
        const bail = withdrawn.get(pid);
        const ok = slot === 1 ? c.player1ConfirmedAt : c.player2ConfirmedAt;
        const src = slot === 1 ? c.player1ConfirmedSource : c.player2ConfirmedSource;
        return {
          playerId: pid,
          name: nameOf(pid),
          email: player?.email ?? null,
          phone: player?.phone ?? null,
          court: `${c.courtType === 'singles' ? 'Singles' : 'Doubles'} ${c.courtNumber}`,
          state: bail ? ('out' as const) : ok ? ('in' as const) : ('waiting' as const),
          at: bail ? bail.at : ok,
          // A yes the captain typed in is a weaker fact than one the player
          // tapped, and the roll-call says which it was rather than blurring
          // the two into the same tick.
          byCaptain: src === 'captain',
        };
      })
      .filter(Boolean as unknown as (v: unknown) => boolean),
  ) as RollCallRow[];

  const confirmedNames = namedInLineup.filter((p) => p.state === 'in');

  /**
   * One derived answer to "what do I do next", so the page can lead with it
   * instead of showing three equally-loud sections and making the captain
   * work it out. Everything below stays reachable — captains skip steps.
   */
  const lineupFilled = namedInLineup.length;
  const stage = matchStage({
    answered: yes.length + no.length + maybe.length,
    available: yes.length,
    needed,
    lineupFilled,
    lineupSent,
    confirmed: confirmedNames.length,
    bailed: bailedInLineup.length,
    played: status === 'played',
    matchPast: new Date(matchAt).getTime() < Date.now(),
    scoresIn: initialResults.length > 0,
    recapSent: !!recapSentAt,
  });
  const waitingNames = namedInLineup.filter((p) => p.state === 'waiting').map((p) => p.name);

  // ---------------------------------------------------------- reaching people
  /**
   * Talking to SOME of the team rather than all of it.
   *
   * Re-mailing 23 people every time one player is swapped in is how a team
   * learns to stop opening these emails, and by the time it matters the lineup
   * email is just another thing nobody reads. Every one of these sends is
   * addressed to named players and shows the real email first.
   *
   * `pending` holds who the open preview is for, so confirming the send does
   * not have to re-derive it.
   */
  const waiting = namedInLineup.filter((p) => p.state === 'waiting');

  /** Preview the real lineup email, addressed only to these players. */
  const previewLineupFor = (ids: string[]) => {
    setPendingIds(ids);
    return call(
      'send-some',
      '/api/captain/timeline/send',
      { team_id: teamId, match_id: matchId, kind: 'lineup', preview: true, player_ids: ids },
      (j) => {
        setPreviewKind('lineup-targeted');
        setPreview(j as unknown as EmailPreview);
      },
    );
  };

  const confirmSendTargeted = () =>
    call(
      'send-some',
      '/api/captain/timeline/send',
      { team_id: teamId, match_id: matchId, kind: 'lineup', player_ids: pendingIds },
      async (j) => {
        setPreview(null);
        setPendingIds([]);
        setNote(
          `Lineup emailed to ${j.sent as number} ${
            (j.sent as number) === 1 ? 'player' : 'players'
          }. The rest of the team was not emailed again.`,
        );
        router.refresh();
      },
    );

  /** Record a yes (or a no) the captain collected by text, or in person. */
  const recordAnswer = (
    playerId: string,
    state: 'in' | 'maybe' | 'out' | 'clear',
    note?: string,
  ) =>
    call(
      `confirm-${playerId}`,
      '/api/captain/confirm-for',
      { team_id: teamId, match_id: matchId, player_id: playerId, state, note },
      (j) => {
        const who = j.name as string;
        const court = j.court as string | null;
        setNote(
          state === 'clear'
            ? `Cleared ${who}'s answer — back to no answer yet.`
            : state === 'out'
              ? `Marked ${who} out.`
              : state === 'maybe'
                ? `Marked ${who} a maybe.`
                : court
                  ? `Marked ${who} available and confirmed on ${court}. Recorded as your answer for her, not a tap of her own.`
                  : `Marked ${who} available. Recorded as your answer for her, not a tap of her own.`,
        );
        router.refresh();
      },
    );

  /** The off-app answer being recorded right now: who, and any qualifier. */
  const [tellWho, setTellWho] = useState('');
  const [tellNote, setTellNote] = useState('');

  const tell = async (state: 'in' | 'maybe' | 'out' | 'clear') => {
    if (!tellWho) return;
    await recordAnswer(tellWho, state, tellNote.trim() || undefined);
    setTellNote('');
  };

  const openText = (ids: string[], body: string) => {
    setPendingIds(ids);
    setSmsBody(body);
    setSmsPreview(null);
    return call(
      'text',
      '/api/captain/text',
      { team_id: teamId, match_id: matchId, player_ids: ids, body, preview: true },
      (j) => setSmsPreview(j as unknown as SmsPreview),
    );
  };

  const confirmSendText = () =>
    call(
      'text',
      '/api/captain/text',
      { team_id: teamId, match_id: matchId, player_ids: pendingIds, body: smsBody },
      (j) => {
        const failures = (
          j.report as { name: string; ok: boolean; reason: string | null }[]
        ).filter((r) => !r.ok);
        if (failures.length && j.commonFailure) {
          // One shared cause is a setup problem, not N separate mishaps.
          setError(`No texts got through — ${j.commonFailure as string}`);
        } else if (failures.length) {
          setError(
            `Sent ${j.sent as number}. Did not reach: ${failures
              .map((f) => `${f.name} (${f.reason})`)
              .join('; ')}`,
          );
        } else {
          setSmsPreview(null);
          setPendingIds([]);
          setNote(`Texted ${j.sent as number} ${(j.sent as number) === 1 ? 'player' : 'players'}.`);
        }
      },
    );

  /**
   * The lineup as plain text, for pasting into the group chat the team actually
   * reads. Built from what is on screen right now, so it matches the sheet even
   * before it is saved.
   */
  const buildShareText = () =>
    lineupAsText({
      teamName,
      matchAt,
      opponent,
      isHome,
      location,
      arrivalNote,
      courts: courts.map((c) => ({
        courtNumber: c.courtNumber,
        courtType: c.courtType,
        round: roundOf?.get(c.courtNumber) ?? null,
        names: ([c.player1Id] as (string | null)[])
          .concat(c.courtType === 'doubles' ? [c.player2Id] : [])
          .map((id) => nameOf(id)),
      })),
    });

  /**
   * Print the sheet on screen — or save it as a PDF from the same dialog.
   * Its own window, so none of the app's dark chrome comes along, and built
   * from what is on screen so an unsaved tweak prints too (marked DRAFT).
   */
  function printLineup() {
    const w = window.open('', '_blank');
    if (!w) {
      setError('Your browser blocked the print window — allow pop-ups for clubmode.ai and try again.');
      return;
    }
    w.document.open();
    w.document.write(
      lineupPrintHtml({
        teamName,
        matchAt,
        opponent,
        isHome,
        location,
        arrivalNote,
        courtFormat: format,
        draft: dirty,
        courts: courts.map((c) => ({
          courtNumber: c.courtNumber,
          courtType: c.courtType,
          round: roundOf?.get(c.courtNumber) ?? null,
          names: ([c.player1Id] as (string | null)[])
            .concat(c.courtType === 'doubles' ? [c.player2Id] : [])
            .map((id) => nameOf(id)),
        })),
      }),
    );
    w.document.close();
  }

  async function copyShareText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard access is refused in some browsers and every insecure
      // context. The text is already on screen and selectable, so say that
      // rather than pretending the copy worked.
      setError('Could not reach the clipboard — select the text above and copy it by hand.');
    }
  }

  /**
   * Reorder the doubles courts by the pair's average WTN, lowest on court 1.
   *
   * This is the objective version of the judgement call a captain otherwise
   * makes every week. Singles courts are left alone — they are ordered by the
   * individual, not by a pair — and the button only appears when every doubles
   * player on the sheet has a WTN, because averaging a WTN with a blank would
   * quietly promote whichever pair happens to be missing a number.
   */
  const doublesCourtRows = courts.filter((c) => c.courtType === 'doubles');

  const avgWtn = (c: Court): number | null => {
    const a = wtnOf(players.find((p) => p.id === c.player1Id));
    const b = wtnOf(players.find((p) => p.id === c.player2Id));
    if (a === null || b === null) return null;
    return (a + b) / 2;
  };

  const wtnReady = doublesCourtRows.length > 1 && doublesCourtRows.every((c) => avgWtn(c) !== null);

  function orderLinesByWtn() {
    setCourts((cs) => {
      const doubles = cs.filter((c) => c.courtType === 'doubles');
      // Sort the PEOPLE, then pour them back into the courts in number order,
      // so court identity (row id, number) never moves — only who is on it.
      // Confirmations travel with the player, because a confirmation belongs to
      // the person and not to the seat.
      const byStrength = [...doubles].sort(
        (x, y) => (avgWtn(x) ?? Infinity) - (avgWtn(y) ?? Infinity),
      );
      const seats = [...doubles].sort((x, y) => x.courtNumber - y.courtNumber);
      const moved = new Map<number, Court>();
      seats.forEach((seat, i) => {
        const from = byStrength[i];
        moved.set(seat.courtNumber, {
          ...seat,
          player1Id: from.player1Id,
          player2Id: from.player2Id,
          player1ConfirmedAt: from.player1ConfirmedAt,
          player2ConfirmedAt: from.player2ConfirmedAt,
          player1ConfirmedSource: from.player1ConfirmedSource,
          player2ConfirmedSource: from.player2ConfirmedSource,
          notes: from.notes,
        });
      });
      return cs.map((c) => moved.get(c.courtNumber) ?? c);
    });
    setSwapPick(null);
    setDirty(true);
    setHandEdited(true);
    setNote('Doubles courts reordered by average WTN, strongest pair on court 1. Save to keep it.');
  }

  async function call(
    action: string,
    url: string,
    body: Record<string, unknown>,
    onOk?: (j: Record<string, unknown>) => void,
  ) {
    setBusy(action);
    setError(null);
    setNote(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setError((j.error as string) || 'Something went wrong.');
        return;
      }
      onOk?.(j);
    } catch {
      setError('Network problem — try again.');
    } finally {
      setBusy(null);
    }
  }

  // Build and show it first — the button itself never puts mail in flight.
  /**
   * Rainout. The API wipes availability, the lineup and any open sub requests,
   * because all three were answers about the old date — so this asks first and
   * says exactly what it is about to throw away.
   */
  async function reschedule() {
    if (!newDate) {
      setError('Pick the new date and time first.');
      return;
    }
    const losing = [
      answered.length ? `${answered.length} availability answers` : null,
      courts.length ? 'the saved lineup' : null,
    ].filter(Boolean);
    const ok = window.confirm(
      `Move this match to ${new Date(newDate).toLocaleString()}?` +
        (losing.length ? `

This clears ${losing.join(' and ')} — everyone gets re-polled.` : ''),
    );
    if (!ok) return;

    setBusy('reschedule');
    setError(null);
    setNote(null);
    try {
      const res = await fetch('/api/captain/matches', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          team_id: teamId,
          match_id: matchId,
          // datetime-local has no zone; the browser reads it as club-local,
          // which is what the captain typed.
          reschedule_to: new Date(newDate).toISOString(),
        }),
      });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setError((j.error as string) || 'Could not reschedule.');
        return;
      }
      setCourts([]);
      setDirty(false);
      setRescheduling(false);
      setNote('Moved. Availability and the lineup were cleared — ask the team again.');
      router.refresh();
    } catch {
      setError('Network problem — try again.');
    } finally {
      setBusy(null);
    }
  }

  const sendPoll = (onlyMissing: boolean) =>
    call(
      onlyMissing ? 'nudge' : 'poll',
      '/api/captain/poll',
      { team_id: teamId, match_id: matchId, only_missing: onlyMissing, preview: true },
      (j) => {
        setPendingOnlyMissing(onlyMissing);
        setPreviewKind('poll');
        setPreview(j as unknown as EmailPreview);
      },
    );

  const confirmPoll = () =>
    call(
      'poll',
      '/api/captain/poll',
      { team_id: teamId, match_id: matchId, only_missing: pendingOnlyMissing },
      (j) => {
        setPreview(null);
        setNote(`Asked ${j.sent as number} ${(j.sent as number) === 1 ? 'player' : 'players'}.`);
      },
    );

  const generate = () => {
    // Regenerating throws away hand edits, so say so before doing it.
    if (
      handEdited &&
      !window.confirm('Regenerating replaces your manual changes with a fresh lineup. Continue?')
    ) {
      return;
    }
    return call(
      'generate',
      '/api/captain/lineup',
      { action: 'generate', team_id: teamId, match_id: matchId },
      (j) => {
        setCourts((j.courts as Court[]) || []);
        setWarnings((j.warnings as string[]) || []);
        setExplanation((j.explanation as Explanation) || null);
        setHandEdited(false);
        setDirty(true);
        setNote('Draft only — nothing has been emailed. Edit any court, then save.');
      },
    );
  };

  /**
   * 2 or 3 courts at once. Saved on the match — the host decides, and it can
   * differ week to week — then the sheet is rebuilt for the new rounds, because
   * a lineup laid out for 3 courts double-books kids on 2.
   */
  async function changeFormat(n: number) {
    if (n === format) return;
    setBusy('format');
    setError(null);
    try {
      const res = await fetch('/api/captain/matches', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: teamId, match_id: matchId, patch: { court_format: n } }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(j.error || 'Could not change the format.');
        return;
      }
      setFormat(n);
    } catch {
      setError('Network problem — try again.');
      return;
    } finally {
      setBusy(null);
    }
    if (courts.length) await generate();
    else setNote(`${n}-court format saved. Generate the lineup when you're ready.`);
  }

  /** Where this match sits on the season timeline, so the page can say whether the automation will mail it. */
  async function refreshAutoSend() {
    try {
      const res = await fetch(`/api/captain/timeline?team_id=${teamId}`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as {
        events: { kind: string; matchId: string; status: string; sendAt: string; sentAt: string | null }[];
      };
      const row = data.events.find((e) => e.matchId === matchId && e.kind === 'lineup');
      setAutoSend(row ? { status: row.status, sendAt: row.sendAt, sentAt: row.sentAt } : null);
    } catch {
      /* the banner is advisory; a failed lookup must not break the page */
    }
  }

  useEffect(() => {
    void refreshAutoSend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Re-sync the lineup from the server after a refresh.
   *
   * `courts` is seeded from a prop with useState, which takes its initial value
   * and then ignores every later change to that prop. So recording a
   * confirmation wrote to the database, called router.refresh(), got fresh data
   * back — and the screen carried on showing "no answer yet", because the state
   * still held the copy from first mount. Reported on 2026-08-28 as "I'm
   * clicking mark confirmed but it's not marking her".
   *
   * Compared on a serialised signature rather than the array itself: the server
   * component hands back a new array on every render, so depending on the array
   * would re-set state forever.
   *
   * Never while there are unsaved edits — a background refresh must not throw
   * away a lineup the captain is halfway through rearranging.
   */
  const serverLineup = JSON.stringify(initialLineup);
  useEffect(() => {
    if (!dirty) setCourts(initialLineup);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverLineup]);

  const setAutoSendSkip = (skip: boolean) =>
    call(
      'autosend',
      '/api/captain/timeline/override',
      { team_id: teamId, match_id: matchId, kind: 'lineup', skip },
      async () => {
        setNote(
          skip
            ? 'Automatic sending is off for this lineup — it will only go out when you send it.'
            : 'Automatic sending is back on for this lineup.',
        );
        await refreshAutoSend();
      },
    );

  /**
   * Saves the sheet it is handed, not the one in state.
   *
   * setCourts is async, so a caller that changes a seat and saves in the same
   * breath would post the pre-change sheet. Taking the array as an argument
   * makes that impossible.
   */
  const saveCourts = (next: Court[], savedNote?: string) =>
    call(
      'save',
      '/api/captain/lineup',
      {
        action: 'save',
        team_id: teamId,
        match_id: matchId,
        courts: next.map((c) => ({
          courtNumber: c.courtNumber,
          courtType: c.courtType,
          player1Id: c.player1Id,
          player2Id: c.player2Id,
        })),
      },
      async () => {
        setDirty(false);
        setHandEdited(false);
        setNote(savedNote ?? 'Saved as a draft. Players still have not seen it.');
        await refreshAutoSend();
        router.refresh();
      },
    );

  const save = () => saveCourts(courts);

  // Show the real email first. The button never puts mail in flight.
  const previewLineup = () =>
    call(
      'send',
      '/api/captain/timeline/send',
      { team_id: teamId, match_id: matchId, kind: 'lineup', preview: true },
      (j) => {
        setPreviewKind('lineup');
        setPreview(j as unknown as EmailPreview);
      },
    );

  const confirmSendLineup = () =>
    call(
      'send',
      '/api/captain/timeline/send',
      { team_id: teamId, match_id: matchId, kind: 'lineup' },
      async (j) => {
        setPreview(null);
        setNote(`Lineup emailed to ${j.sent as number} players.`);
        await refreshAutoSend();
        router.refresh();
      },
    );

  const findSub = (court: Court, slot: 1 | 2) => {
    const dropped = slot === 1 ? court.player1Id : court.player2Id;
    return call(
      `sub-${court.courtNumber}-${slot}`,
      '/api/captain/subs',
      {
        team_id: teamId,
        match_id: matchId,
        lineup_id: court.id,
        slot,
        dropped_player_id: dropped,
      },
      (j) => {
        setNote(`Asked ${j.asked as number} subs — first to claim gets the spot.`);
        router.refresh();
      },
    );
  };

  const saveResults = (markPlayed: boolean) =>
    call(
      markPlayed ? 'play' : 'scores',
      '/api/captain/results',
      {
        team_id: teamId,
        match_id: matchId,
        mark_played: markPlayed,
        results: courts.map((c) => ({
          court_number: c.courtNumber,
          score: scores[c.courtNumber]?.score ?? null,
          won: scores[c.courtNumber]?.won ?? null,
          defaulted: !!defaulted[c.courtNumber],
          default_by: defaulted[c.courtNumber] ?? undefined,
        })),
      },
      (j) => {
        setNote(
          markPlayed
            ? `Match recorded${j.teamResult ? ` — ${j.teamResult as string}` : ''}. Eligibility and partnership records updated.`
            : 'Scores saved.',
        );
        router.refresh();
      },
    );

  function setScore(courtNumber: number, patch: Partial<{ score: string; won: boolean | null }>) {
    setScores((s) => ({
      ...s,
      [courtNumber]: { ...{ score: '', won: null }, ...s[courtNumber], ...patch },
    }));
  }

  /**
   * Read the paper scorecard from a photo.
   *
   * Fills the fields and stops. Nothing is saved until the captain presses the
   * save button they already use — this is handwriting photographed on a court,
   * and these numbers drive play counts, playoff eligibility and partnership
   * records. Lines the model was unsure about are called out by name so the
   * captain knows exactly what to double-check rather than re-reading all of it.
   */
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState<string | null>(null);

  const readScorecard = async (file: File) => {
    setReading(true);
    setReadNote(null);
    try {
      // Shrink first. A phone photo is 3–8 MB, and Vercel rejects anything over
      // ~4.5 MB before it reaches the route — that was the "Request En…" error.
      const { data, mediaType } = await shrinkImage(file);

      const res = await fetch('/api/captain/read-scorecard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match_id: matchId, mediaType, data }),
      });
      // A platform error (413 too large, 504 timeout) arrives as plain text,
      // not JSON — say what happened instead of surfacing a parser error.
      const j = (await res.json().catch(() => ({}))) as { error?: string; courts?: unknown[] };
      if (!res.ok) {
        throw new Error(
          j.error ||
            (res.status === 413
              ? 'That photo is too large to upload. Try again a little further back from the scorecard.'
              : res.status === 504
                ? 'Reading the scorecard took too long. Try again — a straighter, brighter photo reads faster.'
                : `Could not read the scorecard (error ${res.status}).`),
        );
      }

      const rows = (j.courts ?? []) as {
        court_number: number;
        score: string | null;
        won: boolean | null;
        defaulted: boolean;
        confidence: 'high' | 'medium' | 'low';
      }[];
      if (!rows.length) {
        setReadNote('Nothing legible on that photo — try a straighter, brighter shot.');
        return;
      }

      for (const r of rows) {
        setScore(r.court_number, { score: r.score ?? '', won: r.won });
        setDefaulted((d) => ({
          ...d,
          [r.court_number]: r.defaulted ? (r.won === false ? 'us' : 'them') : null,
        }));
      }

      const shaky = rows.filter((r) => r.confidence !== 'high').map((r) => `court ${r.court_number}`);
      setReadNote(
        shaky.length
          ? `Filled ${rows.length} courts. Check ${shaky.join(', ')} — the writing was hard to read. Nothing is saved yet.`
          : `Filled ${rows.length} courts. Check them, then save. Nothing is saved yet.`,
      );
    } catch (e: any) {
      setReadNote(e?.message || 'Could not read the scorecard.');
    } finally {
      setReading(false);
    }
  };

  const labelOf = (c: Court) =>
    `${c.courtType === 'singles' ? 'Singles' : 'Doubles'} ${c.courtNumber}`;

  /** A line only ever trades with its own kind — doubles never lands on a singles court. */
  const peersOf = (c: Court) =>
    courts
      .filter((x) => x.courtType === c.courtType)
      .sort((a, b) => a.courtNumber - b.courtNumber);

  const neighborOf = (c: Court, dir: -1 | 1): Court | null => {
    const peers = peersOf(c);
    const i = peers.findIndex((p) => p.courtNumber === c.courtNumber);
    return peers[i + dir] ?? null;
  };

  /**
   * One-click line flip: the whole pair moves to the other court and vice versa.
   * Court identity (row id, number, type) stays put; only the people on it move,
   * and their confirmations move with them because a confirmation belongs to the
   * player, not the seat.
   */
  function flipLines(aNum: number, bNum: number) {
    setCourts((cs) => {
      const a = cs.find((c) => c.courtNumber === aNum);
      const b = cs.find((c) => c.courtNumber === bNum);
      if (!a || !b) return cs;
      const take = (from: Court, seat: Court): Court => ({
        ...seat,
        player1Id: from.player1Id,
        player2Id: from.player2Id,
        player1ConfirmedAt: from.player1ConfirmedAt,
        player2ConfirmedAt: from.player2ConfirmedAt,
        notes: from.notes,
      });
      return cs.map((c) =>
        c.courtNumber === aNum ? take(b, a) : c.courtNumber === bNum ? take(a, b) : c,
      );
    });
    setSwapPick(null);
    setDirty(true);
    setHandEdited(true);
    setNote(null);
  }

  /** Two-click single-player trade: pick one slot, pick another, they exchange. */
  function pickSlot(courtNumber: number, slot: 1 | 2) {
    if (!swapPick) {
      setSwapPick({ courtNumber, slot });
      return;
    }
    if (swapPick.courtNumber === courtNumber && swapPick.slot === slot) {
      setSwapPick(null);
      return;
    }
    const from = swapPick;
    setCourts((cs) => {
      const read = (c: Court, s: 1 | 2) =>
        s === 1
          ? { id: c.player1Id, ok: c.player1ConfirmedAt }
          : { id: c.player2Id, ok: c.player2ConfirmedAt };
      const write = (c: Court, s: 1 | 2, v: { id: string | null; ok?: string | null }): Court =>
        s === 1
          ? { ...c, player1Id: v.id, player1ConfirmedAt: v.ok }
          : { ...c, player2Id: v.id, player2ConfirmedAt: v.ok };
      const a = cs.find((c) => c.courtNumber === from.courtNumber);
      const b = cs.find((c) => c.courtNumber === courtNumber);
      if (!a || !b) return cs;
      const av = read(a, from.slot);
      const bv = read(b, slot);
      return cs.map((c) => {
        let out = c;
        // Both writes can land on the same court (swapping partners) — chain them.
        if (out.courtNumber === from.courtNumber) out = write(out, from.slot, bv);
        if (out.courtNumber === courtNumber) out = write(out, slot, av);
        return out;
      });
    });
    setSwapPick(null);
    setDirty(true);
    setHandEdited(true);
    setNote(null);
  }

  function setSlot(courtNumber: number, slot: 1 | 2, playerId: string | null) {
    setSwapPick(null);
    setCourts((cs) =>
      cs.map((c) =>
        c.courtNumber === courtNumber
          ? { ...c, [slot === 1 ? 'player1Id' : 'player2Id']: playerId }
          : c,
      ),
    );
    setDirty(true);
    setHandEdited(true);
  }

  /**
   * Who can go in this slot.
   *
   * Adult leagues: anyone not already on the sheet. JTT is different — a child
   * plays up to three lines, so hiding everyone already placed made it
   * impossible to put a singles player on a doubles court by hand. There, only
   * these are out: someone on another line of the SAME round (they would be on
   * two courts at once), a second singles, or a fourth line.
   */
  const optionsFor = (court: Court, slot: 1 | 2) => {
    const current = slot === 1 ? court.player1Id : court.player2Id;
    const others = courts.flatMap((c) =>
      [
        { c, id: c.courtNumber === court.courtNumber && slot === 1 ? null : c.player1Id },
        { c, id: c.courtNumber === court.courtNumber && slot === 2 ? null : c.player2Id },
      ].filter((x): x is { c: Court; id: string } => !!x.id),
    );

    if (!roundOf || !jttRules) {
      const used = new Set(others.map((x) => x.id));
      return players.filter((p) => p.id === current || !used.has(p.id));
    }

    const round = roundOf.get(court.courtNumber);
    const out = new Set<string>();
    const lines = new Map<string, number>();
    for (const { c, id } of others) {
      lines.set(id, (lines.get(id) ?? 0) + 1);
      if (roundOf.get(c.courtNumber) === round) out.add(id);
      if (court.courtType === 'singles' && c.courtType === 'singles') out.add(id);
    }
    for (const [id, n] of lines) if (n >= jttRules.maxTotal) out.add(id);
    return players.filter((p) => p.id === current || !out.has(p.id));
  };

  /* ------------------------------------------------------------ equal play */

  /** Everyone on the sheet as it stands right now, saved or not. */
  const onSheet = new Set(
    courts.flatMap((c) => [c.player1Id, c.player2Id]).filter(Boolean) as string[],
  );

  /**
   * Lineups this player is in for the season, counting the sheet on screen.
   *
   * Live rather than saved: the whole point is to see the fairness cost of a
   * swap while making it, not after.
   */
  const lineupsFor = (p: MatchPlayer) => p.committedElsewhere + (onSheet.has(p.id) ? 1 : 0);

  /** Subs are not on the equal-play clock unless this sheet puts them on it. */
  const equalPlayRoster = players
    .filter((p) => !p.isSub || onSheet.has(p.id))
    .map((p) => ({ ...p, lineups: lineupsFor(p), inThisMatch: onSheet.has(p.id) }))
    .sort((a, b) => a.lineups - b.lineups || a.played - b.played || a.name.localeCompare(b.name));

  const maxLineups = Math.max(1, ...equalPlayRoster.map((p) => p.lineups));
  const minLineups = equalPlayRoster.length
    ? Math.min(...equalPlayRoster.map((p) => p.lineups))
    : 0;
  const spread = equalPlayRoster.length ? maxLineups - minLineups : 0;

  /** Who the spread is actually about — a number alone doesn't name anyone. */
  const trailing = equalPlayRoster.filter((p) => p.lineups === minLineups);
  const trailingNames =
    trailing.length > 3
      ? `${trailing.length} players`
      : trailing.map((p) => p.name.split(' ')[0]).join(', ');

  /** The short "2 lineups · 1 played" tag, used on options and on each slot. */
  const loadLabel = (p: MatchPlayer) => {
    const l = lineupsFor(p);
    const parts = [`${l} lineup${l === 1 ? '' : 's'}`];
    if (p.played > 0) parts.push(`${p.played} played`);
    return parts.join(' · ');
  };

  /* --------------------------------------------- subbing in from the bench */

  /**
   * The strength that matters for the seat being filled: a doubles court ranks
   * on the doubles WTN where the player has one, a singles court on the singles
   * number. Lower WTN is stronger — NTRP runs the other way, so it only breaks
   * ties, and an unrated player sorts last rather than first.
   */
  const strengthFor = (p: MatchPlayer, courtType: 'singles' | 'doubles') =>
    courtType === 'doubles'
      ? wtnOf(p)
      : typeof p.wtn === 'number' && !Number.isNaN(p.wtn)
        ? p.wtn
        : null;

  const byStrength =
    (courtType: 'singles' | 'doubles') => (a: MatchPlayer, b: MatchPlayer) => {
      const wa = strengthFor(a, courtType);
      const wb = strengthFor(b, courtType);
      if (wa != null && wb != null && wa !== wb) return wa - wb;
      if (wa != null && wb == null) return -1;
      if (wa == null && wb != null) return 1;
      const ra = a.rating ?? -Infinity;
      const rb = b.rating ?? -Infinity;
      if (ra !== rb) return rb - ra;
      return a.name.localeCompare(b.name);
    };

  /**
   * Said yes, not on the sheet — the players who can step straight in without
   * anyone being asked anything. Strongest first, for the seat in question.
   */
  const spareFor = (courtType: 'singles' | 'doubles', excludeId: string | null) =>
    players
      .filter((p) => p.availability === 'yes' && !onSheet.has(p.id) && p.id !== excludeId)
      .sort(byStrength(courtType));

  /**
   * Swap a named player out and a willing one in, in one move: record why the
   * first is out, put the replacement on the court, save the sheet, then show
   * the one email that needs to go — to the player coming in. Nothing is sent
   * until that preview is confirmed.
   */
  async function subIn(court: Court, slot: 1 | 2, inId: string) {
    const outId = slot === 1 ? court.player1Id : court.player2Id;
    setSubFor(null);
    if (outId && subMarkOut) await recordAnswer(outId, 'out', subNote.trim() || undefined);

    const next = courts.map((c) => {
      if (c.courtNumber !== court.courtNumber) return c;
      // The seat's confirmation belonged to whoever just left it.
      return slot === 1
        ? { ...c, player1Id: inId, player1ConfirmedAt: null }
        : { ...c, player2Id: inId, player2ConfirmedAt: null };
    });
    setCourts(next);
    setSwapPick(null);
    setDirty(false);
    setHandEdited(false);
    await saveCourts(
      next,
      `${nameOf(inId)} is on ${labelOf(court)}${outId ? `, in for ${nameOf(outId)}` : ''}.`,
    );
    await previewLineupFor([inId]);
  }

  return (
    <div className="mt-8 space-y-8">
      {/* The bench, at the moment it is needed: who said yes, who is free, and
          who is closest in strength to the seat being filled. */}
      {subFor &&
        (() => {
          const court = courts.find((c) => c.courtNumber === subFor.courtNumber);
          if (!court) return null;
          const outId = subFor.slot === 1 ? court.player1Id : court.player2Id;
          const spares = spareFor(court.courtType, outId);
          return (
            <div
              className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-6"
              onClick={() => setSubFor(null)}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-[#002838] border border-white/10 p-5 max-h-[85vh] overflow-y-auto"
              >
                <h3 className="text-white font-display text-lg">
                  {outId ? `Sub in for ${nameOf(outId)}` : `Fill ${labelOf(court)}`}
                </h3>
                <p className="text-white/50 text-sm mt-1">
                  {labelOf(court)} · {spares.length}{' '}
                  {spares.length === 1 ? 'player said yes and is' : 'players said yes and are'} not
                  on the sheet. Strongest first.
                </p>

                {outId && (
                  <label className="flex items-start gap-2.5 mt-4 text-sm text-white/70">
                    <input
                      type="checkbox"
                      checked={subMarkOut}
                      onChange={(e) => setSubMarkOut(e.target.checked)}
                      className="mt-1 shrink-0"
                    />
                    <span className="flex-1">
                      Mark {nameOf(outId)} unavailable for this match
                      {subMarkOut && (
                        <input
                          value={subNote}
                          onChange={(e) => setSubNote(e.target.value)}
                          placeholder="reason — injured, away…"
                          style={INPUT_COLOR}
                          className="mt-2 w-full px-3 py-2 rounded-lg bg-[#001820] border border-white/10 text-sm focus:border-[#D3FB52]/50 focus:outline-none"
                        />
                      )}
                    </span>
                  </label>
                )}

                <div className="mt-4 space-y-2">
                  {spares.map((p) => {
                    const w = strengthFor(p, court.courtType);
                    return (
                      <button
                        key={p.id}
                        onClick={() => subIn(court, subFor.slot, p.id)}
                        disabled={!!busy}
                        className="w-full text-left px-3 py-2.5 rounded-xl bg-[#001820] border border-white/10 hover:border-[#D3FB52]/50 disabled:opacity-40 transition"
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-white font-semibold text-sm">{p.name}</span>
                          <span className="text-[#D3FB52] text-xs tabular-nums shrink-0">
                            {w != null ? `WTN ${w}` : p.rating != null ? `${p.rating}` : 'unrated'}
                          </span>
                        </div>
                        <div className="text-white/40 text-xs mt-0.5">{loadLabel(p)}</div>
                        {p.availabilityNote && (
                          <div className="text-amber-300/80 text-xs mt-0.5 italic">
                            &ldquo;{p.availabilityNote}&rdquo;
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>

                <p className="text-white/35 text-xs mt-4">
                  Saves the sheet, then shows you the email to the player coming in. Nothing is sent
                  until you confirm it.
                </p>
                <div className="mt-4 flex justify-end">
                  <button onClick={() => setSubFor(null)} className={ghost}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      {/* A text costs money and cannot be unsent, so it gets the same
          see-it-first treatment as every email in CaptainMode. */}
      {smsPreview && (
        <div
          className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-6"
          onClick={() => busy !== 'text' && setSmsPreview(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-[#002838] border border-white/10 p-5"
          >
            <div className="text-xs uppercase tracking-wider text-[#D3FB52] font-semibold">
              Preview — nothing has been sent
            </div>
            <p className="text-white/50 text-sm mt-2">
              To {smsPreview.recipients.map((r) => r.name).join(', ') || 'nobody'} ·{' '}
              {smsPreview.segments} segment{smsPreview.segments === 1 ? '' : 's'}
            </p>
            <div className="mt-3 rounded-xl bg-[#D3FB52]/10 border border-[#D3FB52]/20 p-3 text-white text-sm whitespace-pre-wrap">
              {smsPreview.body}
            </div>
            {smsPreview.noPhone.length > 0 && (
              <p className="text-amber-300/80 text-xs mt-3">
                No mobile number for {smsPreview.noPhone.join(', ')} — add one on the roster.
              </p>
            )}
            <div className="mt-4 flex items-center justify-end gap-3">
              <button
                onClick={() => setSmsPreview(null)}
                disabled={busy === 'text'}
                className="px-4 py-2.5 rounded-xl text-white/70 hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmSendText}
                disabled={busy === 'text' || smsPreview.count === 0}
                className="px-5 py-2.5 rounded-xl bg-[#D3FB52] text-[#001820] font-semibold disabled:opacity-50"
              >
                {busy === 'text'
                  ? 'Sending…'
                  : `Send to ${smsPreview.count} ${smsPreview.count === 1 ? 'number' : 'numbers'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      <EmailPreviewModal
        preview={preview}
        sending={busy === 'poll' || busy === 'send' || busy === 'send-some'}
        onSend={
          previewKind === 'lineup-targeted'
            ? confirmSendTargeted
            : previewKind === 'lineup'
              ? confirmSendLineup
              : confirmPoll
        }
        onCancel={() => setPreview(null)}
      />
      <MatchNextStep
        stage={stage}
        counts={{
          available: yes.length,
          needed,
          confirmed: confirmedNames.length,
          lineupFilled,
          bailed: bailedInLineup.length,
        }}
      />

      {/* ---------------------------------------------------------- availability */}
      <section>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h2 className="text-xl font-display text-white">Availability</h2>
          <div className="flex gap-2">
            <button onClick={() => sendPoll(false)} disabled={!!busy} className={emphasise('poll')}>
              {busy === 'poll' ? 'Working…' : 'Ask the team who can play'}
            </button>
            {silent.length > 0 && (
              <button onClick={() => sendPoll(true)} disabled={!!busy} className={emphasise('waiting')}>
                {busy === 'nudge'
                  ? 'Working…'
                  : `Nudge the ${silent.length} who haven't replied`}
              </button>
            )}
            <button onClick={() => setRescheduling((v) => !v)} disabled={!!busy} className={ghost}>
              {rescheduling ? 'Cancel' : 'Move this match'}
            </button>
          </div>
        </div>

        {rescheduling && (
          <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/[0.06] p-4">
            <label htmlFor="new-date" className="block text-sm text-amber-100/80 mb-2">
              New date and time — clears availability and the lineup, then re-polls.
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="new-date"
                type="datetime-local"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                style={{ color: '#ffffff' }}
                className="px-3 py-2 rounded-lg bg-[#001820] border border-white/10 focus:border-[#D3FB52]/50 focus:outline-none text-sm"
              />
              <button onClick={reschedule} disabled={!!busy} className={primary}>
                {busy === 'reschedule' ? 'Moving…' : 'Move this match'}
              </button>
            </div>
          </div>
        )}

        {/*
          One column per answer, each showing its own count and its own names.
          Previously the counts lived in four tiles and the names in a single
          colour-coded wrap underneath, so "who said no?" meant reading a total
          in one place and decoding chip colours in another. Now the question
          and the answer are in the same column.
        */}
        <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { key: 'yes', label: 'Available', rows: yes, tone: '#D3FB52' },
            { key: 'maybe', label: 'Maybe', rows: maybe, tone: '#fbbf24' },
            { key: 'no', label: 'Out', rows: no, tone: '#f87171' },
            { key: 'silent', label: 'No answer', rows: silent, tone: '#94a3b8' },
          ].map((g) => (
            <div
              key={g.key}
              className="rounded-xl border border-white/[0.08] bg-[#002838] p-4 flex flex-col"
            >
              <div className="text-2xl font-semibold" style={{ color: g.tone }}>
                {g.rows.length}
              </div>
              <div className="text-white/40 text-xs uppercase tracking-wide mt-0.5">{g.label}</div>
              <div className="mt-3 space-y-1">
                {g.rows.length === 0 ? (
                  <p className="text-white/20 text-xs">—</p>
                ) : (
                  g.rows.map((p) => (
                    <p key={p.id} className="text-[13px] leading-snug text-white/75">
                      {p.name}
                      {p.isSub ? <span className="text-white/35"> (sub)</span> : ''}
                      {/* The condition the player attached to their answer.
                          A "yes — doubles only" that reads as a plain yes is
                          how somebody ends up on a singles court they told
                          you they couldn't play. */}
                      {p.availabilityNote ? (
                        <span className="block text-[11px] text-amber-300/80">
                          {p.availabilityNote}
                        </span>
                      ) : null}
                    </p>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>

        {/*
          Half a team never taps the button. They text, or say it at pickup, or
          shout it across the courts — and until that lands here the four
          columns above are a picture of who checks email, not of who can play.
          This records it in one line, and counts exactly the same afterwards.
        */}
        <div className="mt-3 rounded-xl border border-white/[0.08] bg-[#002838] p-4">
          <div className="text-white/70 text-sm font-semibold">
            Somebody told you instead of tapping?
          </div>
          <p className="text-white/40 text-xs mt-0.5">
            Record it for them. It counts the same as the button in the email — no lineup needed
            yet, and you can change it later.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="sr-only">Player</span>
              <select
                value={tellWho}
                onChange={(e) => setTellWho(e.target.value)}
                aria-label="Player who told you"
                style={INPUT_COLOR}
                className="px-3 py-2 rounded-lg bg-[#001820] border border-white/10 text-sm focus:border-[#D3FB52]/50 focus:outline-none min-w-[13rem]"
              >
                <option value="">Choose a player…</option>
                {[...players]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.isSub ? ' (sub)' : ''} —{' '}
                      {p.availability === 'yes'
                        ? 'available'
                        : p.availability === 'no'
                          ? 'out'
                          : p.availability === 'maybe'
                            ? 'maybe'
                            : 'no answer yet'}
                    </option>
                  ))}
              </select>
            </label>

            <input
              value={tellNote}
              onChange={(e) => setTellNote(e.target.value)}
              placeholder="note — doubles only, arriving late…"
              aria-label="Note on their answer"
              style={INPUT_COLOR}
              className="px-3 py-2 rounded-lg bg-[#001820] border border-white/10 text-sm focus:border-[#D3FB52]/50 focus:outline-none flex-1 min-w-[12rem]"
            />

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => tell('in')}
                disabled={!tellWho || !!busy}
                className="px-3 py-2 rounded-lg text-sm font-semibold bg-[#D3FB52] text-[#001820] hover:brightness-95 disabled:opacity-30 transition"
              >
                Available
              </button>
              <button
                onClick={() => tell('maybe')}
                disabled={!tellWho || !!busy}
                className="px-3 py-2 rounded-lg text-sm font-semibold border border-amber-400/40 text-amber-300 hover:border-amber-400/70 disabled:opacity-30 transition"
              >
                Maybe
              </button>
              <button
                onClick={() => tell('out')}
                disabled={!tellWho || !!busy}
                className="px-3 py-2 rounded-lg text-sm font-semibold border border-red-400/40 text-red-300 hover:border-red-400/70 disabled:opacity-30 transition"
              >
                Out
              </button>
              {tellWho && players.find((p) => p.id === tellWho)?.availability != null && (
                <button
                  onClick={() => tell('clear')}
                  disabled={!!busy}
                  className="px-3 py-2 rounded-lg text-sm border border-white/10 text-white/50 hover:text-white hover:border-white/25 disabled:opacity-30 transition"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>

        <p className="text-white/40 text-sm mt-3">
          {jttRules
            ? yes.length >= needed
              ? `Enough to cover every line — ${needed} players fill the sheet.`
              : `Need ${needed - yes.length} more to cover every line — ${needed} players fill the sheet.`
            : yes.length >= needed
              ? `Enough to field a lineup (${needed} spots).`
              : `Need ${needed - yes.length} more for a full lineup of ${needed}.`}
        </p>

        {players.some((p) => !p.hasEmail) && (
          <p className="text-amber-300/70 text-xs mt-3">
            {players.filter((p) => !p.hasEmail).length} player(s) have no email and can&rsquo;t be
            polled — add one on the roster.
          </p>
        )}
      </section>

      {/* ---------------------------------------------------------------- lineup */}
      <section>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h2 className="text-xl font-display text-white">Lineup</h2>
          <div className="flex gap-2 flex-wrap">
            {/* JTT: how many courts the host is playing on at once. It decides
                which lines share a round, so switching rebuilds the sheet. */}
            {format != null && (
              <div
                role="group"
                aria-label="Courts played at once"
                className="inline-flex rounded-xl border border-white/10 overflow-hidden"
              >
                {JTT_COURT_FORMATS.map((n) => (
                  <button
                    key={n}
                    onClick={() => void changeFormat(n)}
                    disabled={!!busy}
                    aria-pressed={format === n}
                    title={
                      n === 2
                        ? '2 courts: each round is 1 singles + 1 doubles — 4 rounds'
                        : '3 courts: 2 singles + 1 doubles, twice, then 2 doubles — 3 rounds'
                    }
                    className={`px-3 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${
                      format === n ? 'bg-[#D3FB52] text-[#001820]' : 'text-white/60 hover:text-white'
                    }`}
                  >
                    {busy === 'format' && format !== n ? '…' : `${n} courts`}
                  </button>
                ))}
              </div>
            )}
            <button onClick={generate} disabled={!!busy} className={courts.length ? ghost : primary}>
              {busy === 'generate' ? 'Building…' : courts.length ? 'Regenerate' : 'Generate lineup'}
            </button>
            {/* Only offered when every doubles player has a WTN. A pair with a
                blank would average out ahead of everyone and look deliberate. */}
            {wtnReady && (
              <button
                onClick={orderLinesByWtn}
                disabled={!!busy}
                title="Sort the doubles courts by each pair's average WTN — lowest average on court 1"
                className={`${btn} border border-[#D3FB52]/30 text-[#D3FB52] hover:border-[#D3FB52]/60`}
              >
                Order lines by WTN
              </button>
            )}
            {courts.length > 0 && (
              <>
                <button onClick={save} disabled={!!busy || !dirty} className={ghost}>
                  {busy === 'save' ? 'Saving…' : dirty ? 'Save draft' : 'Saved'}
                </button>
                {/* For the group chat the team already lives in. No API can post
                    into a WhatsApp group somebody created, so hand the captain
                    the message and let them paste it. */}
                <button
                  onClick={() => {
                    setShareText(buildShareText());
                    setCopied(false);
                  }}
                  disabled={!!busy}
                  className={ghost}
                >
                  Copy for the group chat
                </button>
                {/* Paper for the clipboard at the courts. The browser's print
                    dialog also has "Save as PDF". */}
                <button
                  onClick={printLineup}
                  disabled={!!busy}
                  title="Print the lineup, or save it as a PDF"
                  className={ghost}
                >
                  Print
                </button>
                <button
                  onClick={previewLineup}
                  // A kid on two courts at once is an unplayable sheet — never send one.
                  disabled={!!busy || dirty || clashes.length > 0}
                  className={emphasise('send', 'build')}
                >
                  {busy === 'send'
                    ? 'Opening…'
                    : lineupSent
                      ? 'Preview & resend'
                      : 'Preview & send to team'}
                </button>
              </>
            )}
          </div>
        </div>

        {/* The whole point of this strip: never leave a captain guessing whether
            players can already see what is on screen. */}
        {courts.length > 0 && (
          <div
            className={`mt-3 rounded-xl border p-4 ${
              lineupSent
                ? 'border-emerald-400/25 bg-emerald-400/[0.07]'
                : 'border-[#D3FB52]/25 bg-[#D3FB52]/[0.06]'
            }`}
          >
            <div className={`font-medium ${lineupSent ? 'text-emerald-200' : 'text-[#D3FB52]'}`}>
              {lineupSent
                ? 'Sent — your team has this lineup.'
                : dirty
                  ? 'Draft — nothing has been emailed, and unsaved changes are visible only to you.'
                  : 'Saved draft — no player has seen this.'}
            </div>

            {lineupSent && namedInLineup.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                <span className="text-white/60">
                  {confirmedNames.length} of {namedInLineup.length} confirmed
                  {waiting.length > 0 && ` · waiting on ${waiting.map((w) => w.name).join(', ')}`}
                </span>
                {waiting.length > 0 && (
                  <button
                    onClick={() => previewLineupFor(waiting.map((w) => w.playerId))}
                    disabled={!!busy || dirty}
                    className="text-xs text-[#D3FB52]/80 hover:text-[#D3FB52] underline disabled:opacity-30 disabled:no-underline"
                  >
                    email the {waiting.length} who haven&rsquo;t
                  </button>
                )}
              </div>
            )}

            {!lineupSent && (
              <div className="text-white/60 text-sm mt-2">
                Generating, editing and saving never email anyone. The only things that do are the
                Preview &amp; send button above — which shows you the email first — and the
                automatic send below.
              </div>
            )}

            {!lineupSent && autoSend && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {autoSend.status === 'skipped' ? (
                  <>
                    <span className="text-white/70 text-sm">
                      Automatic sending is <strong className="text-white">off</strong> for this
                      lineup. It goes out only when you send it.
                    </span>
                    <button
                      onClick={() => setAutoSendSkip(false)}
                      disabled={!!busy}
                      className="text-xs text-white/45 hover:text-white underline"
                    >
                      turn it back on
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-white/70 text-sm">
                      {autoSend.status === 'blocked'
                        ? 'Once you save a lineup, the automation will email it on the scheduled day.'
                        : `Unless you turn this off, the automation emails this lineup on ${fmtWhen(autoSend.sendAt)}.`}
                    </span>
                    <button
                      onClick={() => setAutoSendSkip(true)}
                      disabled={!!busy}
                      className="px-3 py-1.5 rounded-lg border border-white/20 text-white/80 hover:text-white text-xs"
                    >
                      Don&rsquo;t auto-send — I&rsquo;ll send it myself
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {shareText !== null && (
          <div className="mt-3 rounded-xl border border-white/[0.08] bg-[#002838] p-4">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <h3 className="text-white font-medium text-sm">Paste this into your group chat</h3>
              <button
                onClick={() => setShareText(null)}
                className="text-white/35 hover:text-white text-xs"
              >
                close
              </button>
            </div>
            <textarea
              readOnly
              value={shareText}
              rows={Math.min(18, shareText.split('\n').length + 1)}
              onFocus={(e) => e.currentTarget.select()}
              style={{ color: '#ffffff' }}
              className="mt-3 w-full px-3 py-2 rounded-lg bg-[#001820] border border-white/10 text-sm font-mono leading-relaxed focus:border-[#D3FB52]/50 focus:outline-none"
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button onClick={() => copyShareText(shareText)} className={primary}>
                {copied ? 'Copied ✓' : 'Copy'}
              </button>
              <span className="text-white/35 text-xs">
                No personal confirm links in here on purpose — anyone in a group could tap someone
                else&rsquo;s. Confirming stays in their own email or text.
              </span>
            </div>
          </div>
        )}

        {explanation && (
          <div className="mt-3 rounded-xl border border-white/[0.08] bg-[#002838] p-4">
            <button
              onClick={() => setShowWhy((v) => !v)}
              className="text-white font-medium text-sm hover:text-[#D3FB52]"
            >
              Why this lineup {showWhy ? '▾' : '▸'}
            </button>
            {showWhy && (
              <>
                <ol className="mt-3 space-y-1.5 text-sm text-white/65 list-decimal pl-5">
                  {explanation.summary.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ol>
                {explanation.benched.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-white/[0.08]">
                    <div className="text-white/45 text-xs uppercase tracking-wider font-semibold">
                      Said yes but not in the lineup
                    </div>
                    <ul className="mt-2 space-y-1 text-sm text-white/60">
                      {explanation.benched.map((b) => (
                        <li key={b.name}>
                          <span className="text-white/85">{b.name}</span> — {b.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-white/35 text-xs mt-3">
                  Each court shows its own reason on the right. Change any player with the dropdowns
                  — your edits win, and Regenerate starts over from scratch.
                </p>
              </>
            )}
          </div>
        )}

        {/* Who has actually answered the lineup email.
            This used to be one grey word next to each dropdown, which a captain
            reported as "I know Stef clicked yes but I can't see it anywhere". */}
        {/* The roll-call used to live here as its own list. It was a second copy
            of the lineup a captain had to keep in their head alongside the real
            one, so it now lives ON each court instead — who confirmed, and every
            way to chase them, next to the person's name. */}
        {/* Loud, because a bail after the lineup went out is the thing a captain
            most needs to act on and it arrives while they aren't looking. */}
        {bailedInLineup.length > 0 && (
          <div className="mt-3 rounded-xl border border-red-500/40 bg-red-500/[0.09] p-4 text-sm text-red-100">
            <strong>
              {bailedInLineup.length === 1
                ? `${bailedInLineup[0].name} pulled out of this lineup.`
                : `${bailedInLineup.length} players pulled out of this lineup.`}
            </strong>
            <ul className="mt-1.5 space-y-1 text-red-100/80">
              {bailedInLineup.map((b) => (
                <li key={b.playerId}>
                  {b.name} — {fmtWhen(b.at)}
                  {b.note ? ` · “${b.note}”` : ''}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-red-100/60">
              Swap someone in below, or use “find a sub” on their court to blast the sub list.
            </p>
          </div>
        )}

        {/* JTT: lines in the same round are played at the same time. Loud,
            because a swap or a line flip can create this silently. */}
        {clashes.length > 0 && (
          <div className="mt-3 rounded-xl border border-red-500/40 bg-red-500/[0.09] p-4 text-sm text-red-100">
            <strong>
              {clashes.length === 1
                ? 'A player is on two courts at once.'
                : `${clashes.length} players are on two courts at once.`}
            </strong>
            <ul className="mt-1.5 space-y-1 text-red-100/80">
              {clashes.map((x) => (
                <li key={`${x.round}-${x.playerId}`}>
                  {nameOf(x.playerId)} —{' '}
                  {x.courtNumbers
                    .map((n) => {
                      const c = courts.find((y) => y.courtNumber === n);
                      return c ? labelOf(c) : `Court ${n}`;
                    })
                    .join(' and ')}
                  , both in round {x.round}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-red-100/60">
              Lines in the same round are played at the same time. Swap one of them or hit
              Regenerate — sending is blocked until it&rsquo;s fixed.
            </p>
          </div>
        )}

        {warnings.length > 0 && (
          <ul className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/[0.07] p-4 space-y-1 text-sm text-amber-100/85">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}

        {courts.length === 0 && (
          <p className="text-white/40 text-sm mt-3">
            No lineup yet. Collect availability, then hit Generate — it only proposes a lineup on
            screen, it does not email anyone.
          </p>
        )}

        {courts.length > 0 && (
          <p className="text-white/40 text-xs mt-3">
            {swapPick
              ? `Now pick the slot ${nameOf(
                  courts.find((x) => x.courtNumber === swapPick.courtNumber)?.[
                    swapPick.slot === 1 ? 'player1Id' : 'player2Id'
                  ] ?? null,
                )} should trade with.`
              : 'Use ↑ ↓ to move a whole line, or ⇄ to trade two players. Nothing is emailed until you save and send.'}
          </p>
        )}

        <div className="mt-3 space-y-2">
          {displayCourts.map((c, i) => (
            <div key={c.courtNumber}>
              {/* A heading where each round starts, so the lines played together read together. */}
              {roundOf &&
                roundOf.get(c.courtNumber) != null &&
                (i === 0 ||
                  roundOf.get(displayCourts[i - 1].courtNumber) !== roundOf.get(c.courtNumber)) && (
                  <h3
                    className={`${i === 0 ? '' : 'pt-4'} pb-1 text-[#D3FB52] text-sm font-semibold uppercase tracking-wide`}
                  >
                    Round {roundOf.get(c.courtNumber)}
                  </h3>
                )}
            <div className="rounded-xl border border-white/[0.08] bg-[#002838] p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="text-white/50 text-xs uppercase tracking-wide">
                    {labelOf(c)}
                  </div>
                  {/* Worked out from the format, not the generator's notes, so a
                      saved sheet still shows its rounds after a reload. */}
                  {roundOf?.get(c.courtNumber) != null && (
                    <span className="text-[#D3FB52]/70 text-[11px] uppercase tracking-wide">
                      round {roundOf.get(c.courtNumber)}
                    </span>
                  )}
                  {/* One click moves this whole pair a line up or down. */}
                  <div className="flex items-center gap-1">
                    {([-1, 1] as const).map((dir) => {
                      const n = neighborOf(c, dir);
                      return (
                        <button
                          key={dir}
                          onClick={() => n && flipLines(c.courtNumber, n.courtNumber)}
                          disabled={!n}
                          title={n ? `Flip with ${labelOf(n)}` : undefined}
                          aria-label={
                            n ? `Flip ${labelOf(c)} with ${labelOf(n)}` : `${labelOf(c)} cannot move`
                          }
                          className="w-6 h-6 rounded-md border border-white/10 text-white/50 text-xs leading-none hover:text-[#D3FB52] hover:border-[#D3FB52]/40 disabled:opacity-20 disabled:hover:text-white/50 disabled:hover:border-white/10"
                        >
                          {dir === -1 ? '↑' : '↓'}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-right">
                  {/* The number this court was ranked on, so the order can be
                      checked rather than taken on trust. */}
                  {c.courtType === 'doubles' && avgWtn(c) !== null && (
                    <span className="text-[#D3FB52]/60 text-xs shrink-0">
                      avg WTN {avgWtn(c)!.toFixed(1)}
                    </span>
                  )}
                  {/* "round N" already shows as the badge by the label. */}
                  {(c.notes ?? []).filter((n) => !/^round \d+$/.test(n)).length > 0 && (
                    <span className="text-white/35 text-xs">
                      {(c.notes ?? []).filter((n) => !/^round \d+$/.test(n)).join(' · ')}
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {([1, 2] as const)
                  .filter((slot) => slot === 1 || c.courtType === 'doubles')
                  .map((slot) => {
                    const pid = slot === 1 ? c.player1Id : c.player2Id;
                    const confirmedAt = slot === 1 ? c.player1ConfirmedAt : c.player2ConfirmedAt;
                    const confirmed = !!confirmedAt;
                    // A yes the captain typed in is a weaker fact than one the
                    // player tapped, so the badge says which it was.
                    const confirmedByCaptain =
                      (slot === 1 ? c.player1ConfirmedSource : c.player2ConfirmedSource) ===
                      'captain';
                    const bailed = pid ? withdrawn.get(pid) : undefined;
                    const picked =
                      swapPick?.courtNumber === c.courtNumber && swapPick.slot === slot;
                    const pickedCourt = courts.find((x) => x.courtNumber === swapPick?.courtNumber);
                    const pickedId = pickedCourt
                      ? swapPick?.slot === 1
                        ? pickedCourt.player1Id
                        : pickedCourt.player2Id
                      : null;
                    return (
                      <div key={slot}>
                        <div className="flex items-center gap-2">
                          {/* Pick one slot, then another — the two players trade places. */}
                          <button
                            onClick={() => pickSlot(c.courtNumber, slot)}
                            title={
                              picked
                                ? 'Cancel the swap'
                                : swapPick
                                  ? `Swap with ${nameOf(pickedId)}`
                                  : 'Swap this player with another court'
                            }
                            aria-pressed={picked}
                            aria-label={`Swap ${nameOf(pid)} on ${labelOf(c)}`}
                            className={`w-8 h-9 shrink-0 rounded-lg border text-sm ${
                              picked
                                ? 'bg-[#D3FB52] text-[#001820] border-[#D3FB52]'
                                : swapPick
                                  ? 'border-[#D3FB52]/40 text-[#D3FB52] hover:bg-[#D3FB52]/10'
                                  : 'border-white/10 text-white/40 hover:text-white hover:border-white/25'
                            }`}
                          >
                            ⇄
                          </button>
                          <select
                            value={pid ?? ''}
                            onChange={(e) => setSlot(c.courtNumber, slot, e.target.value || null)}
                            aria-label={`Court ${c.courtNumber} player ${slot}`}
                            className="flex-1 px-3 py-2 rounded-lg bg-[#001820] border border-white/10 text-white text-sm focus:border-[#D3FB52]/50 focus:outline-none"
                          >
                            <option value="">— empty —</option>
                            {optionsFor(c, slot).map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                                {p.rating != null ? ` (${p.rating})` : ''}
                                {p.availability === 'yes' ? ' ✓' : p.availability === 'no' ? ' ✗' : ''}
                                {p.availabilityNote ? ` (${p.availabilityNote})` : ''}
                                {` — ${loadLabel(p)}`}
                              </option>
                            ))}
                          </select>
                          {bailed ? (
                            <span
                              className="text-red-400 text-xs shrink-0 font-semibold"
                              title={`Pulled out ${fmtWhen(bailed.at)}`}
                            >
                              pulled out
                            </span>
                          ) : confirmed ? (
                            <span
                              className="text-[#D3FB52] text-xs shrink-0"
                              title={`Confirmed ${fmtWhen(confirmedAt as string)}${
                                confirmedByCaptain ? ' — recorded by you' : ''
                              }`}
                            >
                              confirmed{confirmedByCaptain ? ' ·  by you' : ''}
                            </span>
                          ) : (
                            pid && (
                              <span className="text-white/25 text-xs shrink-0">no answer yet</span>
                            )
                          )}
                        </div>
                        {bailed?.note && (
                          <p className="text-red-300/70 text-xs mt-1 pl-10 italic">
                            “{bailed.note}”
                          </p>
                        )}

                        {/* What this seat costs in fairness, next to the seat.
                            The closed <select> truncates the option's tag, so
                            the number has to survive on its own line. */}
                        {pid && (() => {
                          const p = players.find((x) => x.id === pid);
                          return p ? (
                            <p
                              className="mt-1 pl-10 text-white/30 text-xs"
                              title="Lineups counts every saved sheet plus this one; played counts matches that have happened."
                            >
                              {loadLabel(p)}
                            </p>
                          ) : null;
                        })()}

                        {/* Everything a captain does about THIS person, next to
                            their name. Both send buttons open the same preview
                            the whole-team send uses — nothing leaves without
                            being seen, and nothing hands off to a mail app. */}
                        {pid && (() => {
                          const rowKey = `${c.courtNumber}-${slot}`;
                          const rowOpen = !!bailed || rowMenu === rowKey;
                          // Already said yes, already free — no email needed to find them.
                          const spares = spareFor(c.courtType, pid);
                          return (
                          <div className="mt-1.5 pl-10">
                            {!bailed && (
                              <button
                                onClick={() => setRowMenu(rowOpen ? null : rowKey)}
                                className="text-white/25 hover:text-white/70 text-xs underline"
                              >
                                {rowOpen ? 'hide actions' : 'actions'}
                              </button>
                            )}
                            {rowOpen && (
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs">
                            <button
                              onClick={() => previewLineupFor([pid])}
                              disabled={!!busy || dirty}
                              title={
                                dirty
                                  ? 'Save the lineup first — the email would show the version you have already changed.'
                                  : `Show ${nameOf(pid)} the current lineup`
                              }
                              className="text-[#D3FB52]/80 hover:text-[#D3FB52] underline disabled:opacity-30 disabled:no-underline"
                            >
                              {busy === 'send-some' ? 'opening…' : 'send updated lineup'}
                            </button>

                            {players.find((x) => x.id === pid)?.phone && (
                              <button
                                onClick={() =>
                                  openText(
                                    [pid],
                                    `${nameOf(pid).split(' ')[0]} — you're on ${labelOf(c)} for ${fmtWhen(matchAt)}. Can you confirm?`,
                                  )
                                }
                                disabled={!!busy}
                                className="text-white/40 hover:text-white underline disabled:opacity-30"
                              >
                                text
                              </button>
                            )}

                            {!bailed &&
                              (confirmed ? (
                                <button
                                  onClick={() => recordAnswer(pid, 'clear')}
                                  disabled={!!busy}
                                  className="text-white/30 hover:text-white underline disabled:opacity-30"
                                >
                                  {busy === `confirm-${pid}` ? 'saving…' : 'undo'}
                                </button>
                              ) : (
                                <button
                                  onClick={() => recordAnswer(pid, 'in')}
                                  disabled={!!busy}
                                  className="text-white/40 hover:text-white underline disabled:opacity-30"
                                >
                                  {busy === `confirm-${pid}`
                                    ? 'saving…'
                                    : 'she told me yes — mark confirmed'}
                                </button>
                              ))}

                            {/* Somebody who has already said yes can just be put
                                on the court. This asks nobody and races nobody,
                                so it comes before the mail-everyone button. */}
                            <button
                              onClick={() => {
                                setSubFor({ courtNumber: c.courtNumber, slot });
                                setSubMarkOut(true);
                                setSubNote(bailed?.note ?? 'injured');
                              }}
                              disabled={!!busy || spares.length === 0}
                              title={
                                spares.length === 0
                                  ? 'Nobody who said yes is free — use “find a sub” to ask the rest of the roster.'
                                  : `Put one of the ${spares.length} who said yes on ${labelOf(c)}`
                              }
                              className={
                                bailed
                                  ? 'text-[#D3FB52] hover:brightness-110 font-semibold underline disabled:opacity-30 disabled:no-underline'
                                  : 'text-white/40 hover:text-white underline disabled:opacity-25 disabled:no-underline'
                              }
                            >
                              {bailed
                                ? `sub in for ${nameOf(pid)} (${spares.length} said yes) →`
                                : `sub in someone who said yes (${spares.length})`}
                            </button>

                            {c.id && (
                              <button
                                onClick={() => findSub(c, slot)}
                                disabled={!!busy}
                                className={
                                  bailed
                                    ? 'text-red-300 hover:text-red-200 underline'
                                    : 'text-white/30 hover:text-white underline disabled:opacity-30'
                                }
                              >
                                {busy === `sub-${c.courtNumber}-${slot}`
                                  ? 'asking subs…'
                                  : bailed
                                    ? `or ask the whole roster for ${nameOf(pid)}`
                                    : 'find a sub'}
                              </button>
                            )}
                          </div>
                            )}
                          </div>
                          );
                        })()}
                      </div>
                    );
                  })}
              </div>
            </div>
            </div>
          ))}
        </div>

        {/* ------------------------------------------------------ equal play */}
        {equalPlayRoster.length > 0 && (
          <div className="mt-5 rounded-xl border border-white/[0.08] bg-[#002838] p-4">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <h3 className="text-white/70 text-sm font-semibold">Equal play</h3>
              <span
                className={`text-xs ${spread <= 1 ? 'text-[#D3FB52]/80' : 'text-amber-300/90'}`}
              >
                {spread <= 1
                  ? `Spread ${spread} — even`
                  : `Spread ${spread} — ${trailingNames} on ${minLineups}`}
              </span>
            </div>
            <p className="text-white/35 text-xs mt-1">
              Lineups counts every saved sheet for the season <em>plus the one on screen</em>, so it
              moves as you swap. Played counts matches that have actually happened — defaulted
              courts don’t count, nobody played them.
            </p>

            <div className="mt-3 flex items-center gap-2 text-[10px] uppercase tracking-wide text-white/25">
              <span className="flex-1" />
              <span className="w-12 text-right">lineups</span>
              <span className="w-12 text-right">played</span>
            </div>
            <div className="mt-1 grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-1.5">
              {equalPlayRoster.map((p) => (
                <div key={p.id} className="flex items-center gap-2 text-xs">
                  <span
                    aria-hidden
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      p.inThisMatch ? 'bg-[#D3FB52]' : 'bg-white/15'
                    }`}
                  />
                  <span
                    className={`truncate w-32 shrink-0 ${
                      p.inThisMatch ? 'text-white' : 'text-white/45'
                    }`}
                    title={p.inThisMatch ? `${p.name} — on this sheet` : p.name}
                  >
                    {p.name}
                  </span>
                  <span className="flex-1 min-w-[2rem] h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                    <span
                      className={`block h-full rounded-full ${
                        p.inThisMatch ? 'bg-[#D3FB52]/70' : 'bg-white/25'
                      }`}
                      style={{ width: `${(p.lineups / maxLineups) * 100}%` }}
                    />
                  </span>
                  <span
                    className={`w-12 text-right tabular-nums ${
                      p.lineups === minLineups && spread > 1
                        ? 'text-amber-300'
                        : 'text-white/70'
                    }`}
                  >
                    {p.lineups}
                  </span>
                  <span className="w-12 text-right tabular-nums text-white/30">{p.played}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {dirty && courts.length > 0 && (
          <p className="text-amber-300/70 text-xs mt-3">
            Unsaved changes — save the draft before sending to the team.
          </p>
        )}
      </section>

      {/* --------------------------------------------------------------- results */}
      {courts.length > 0 && (
        <section>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <h2 className="text-xl font-display text-white">
              Results
              {status === 'played' && (
                <span className="ml-2 text-sm text-[#D3FB52] font-sans">recorded</span>
              )}
            </h2>
            {!scoring ? (
              <button
                onClick={() => setScoring(true)}
                disabled={!!busy}
                className={emphasise('results')}
              >
                Enter the scores
              </button>
            ) : (
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => saveResults(false)} disabled={!!busy} className={ghost}>
                  {busy === 'scores' ? 'Saving…' : 'Save scores'}
                </button>
                <button
                  onClick={() => saveResults(true)}
                  disabled={!!busy}
                  className={emphasise('results')}
                >
                  {busy === 'play'
                    ? 'Recording…'
                    : status === 'played'
                      ? 'Update result'
                      : 'Save & mark played'}
                </button>
              </div>
            )}
          </div>

          {scoring && (
            <>
              <p className="text-white/40 text-sm mt-1">
                Marking a match played is what counts it toward playoff eligibility and play-time.
                Win/loss per court also teaches the generator which pairings work.
              </p>

              {/* Photograph the card instead of typing it. Fills the fields for
                  review; the existing save button is still what commits. */}
              <div className="mt-3 rounded-xl border border-white/[0.08] bg-[#002838] p-4">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-white/80 transition hover:border-[#D3FB52]/50 hover:text-white">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    disabled={reading || !!busy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f) readScorecard(f);
                    }}
                  />
                  {reading ? 'Reading the card…' : 'Photograph the scorecard'}
                </label>
                <p className="mt-2 text-xs text-white/40">
                  Snap the paper card and the scores fill themselves in. Check them before you
                  save — nothing is recorded until you do.
                </p>
                {readNote && (
                  <p className="mt-2 text-xs text-[#D3FB52]">{readNote}</p>
                )}
              </div>

              <div className="mt-3 space-y-2">
                {courts.map((c) => {
                  const s = scores[c.courtNumber] ?? { score: '', won: null };
                  return (
                    <div
                      key={c.courtNumber}
                      className="flex items-center gap-3 flex-wrap rounded-xl border border-white/[0.08] bg-[#002838] p-3"
                    >
                      <div className="text-white/50 text-xs uppercase tracking-wide w-24 shrink-0">
                        {c.courtType === 'singles' ? 'Singles' : 'Doubles'} {c.courtNumber}
                      </div>
                      <div className="text-white text-sm flex-1 min-w-[10rem]">
                        {nameOf(c.player1Id)}
                        {c.courtType === 'doubles' ? ` / ${nameOf(c.player2Id)}` : ''}
                      </div>
                      <input
                        value={defaulted[c.courtNumber] ? 'Default' : s.score}
                        onChange={(e) => setScore(c.courtNumber, { score: e.target.value })}
                        disabled={!!defaulted[c.courtNumber]}
                        placeholder="6-4, 6-3"
                        aria-label={`Score for court ${c.courtNumber}`}
                        className="w-32 px-3 py-2 rounded-lg bg-[#001820] border border-white/10 text-white placeholder-white/25 text-sm focus:border-[#D3FB52]/50 focus:outline-none disabled:opacity-40"
                      />
                      {/* Defaulting sets the win/loss for the team but takes the
                          match away from the two players on the court. */}
                      <button
                        onClick={() => {
                          const next = defaulted[c.courtNumber] ? null : 'them';
                          setDefaulted((d) => ({ ...d, [c.courtNumber]: next }));
                          if (next) setScore(c.courtNumber, { won: true });
                        }}
                        title={
                          defaulted[c.courtNumber]
                            ? 'This court was defaulted — the players on it are not credited with a match'
                            : 'Nobody played this court'
                        }
                        className={`px-2.5 py-1.5 rounded-lg text-xs border ${
                          defaulted[c.courtNumber]
                            ? 'border-amber-400/50 bg-amber-400/10 text-amber-200'
                            : 'border-white/10 text-white/40 hover:text-white/80'
                        }`}
                      >
                        {defaulted[c.courtNumber] ? 'Defaulted' : 'Default'}
                      </button>
                      {defaulted[c.courtNumber] && (
                        <select
                          value={defaulted[c.courtNumber] ?? 'them'}
                          onChange={(e) => {
                            const who = e.target.value as 'us' | 'them';
                            setDefaulted((d) => ({ ...d, [c.courtNumber]: who }));
                            // Who defaulted decides the point: they default, we win.
                            setScore(c.courtNumber, { won: who === 'them' });
                          }}
                          aria-label={`Who defaulted court ${c.courtNumber}`}
                          style={{ color: '#ffffff', backgroundColor: '#001820' }}
                          className="px-2 py-1.5 rounded-lg border border-white/10 text-xs focus:border-[#D3FB52]/50 focus:outline-none"
                        >
                          <option value="them">they defaulted</option>
                          <option value="us">we defaulted</option>
                        </select>
                      )}
                      <div className="flex gap-1">
                        {[
                          { label: 'W', val: true },
                          { label: 'L', val: false },
                        ].map((o) => (
                          <button
                            key={o.label}
                            onClick={() =>
                              setScore(c.courtNumber, { won: s.won === o.val ? null : o.val })
                            }
                            aria-pressed={s.won === o.val}
                            className={`w-10 py-2 rounded-lg text-sm font-semibold border ${
                              s.won === o.val
                                ? o.val
                                  ? 'bg-[#D3FB52] text-[#001820] border-[#D3FB52]'
                                  : 'bg-red-400/20 text-red-200 border-red-400/40'
                                : 'border-white/10 text-white/40 hover:text-white'
                            }`}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* The one email that goes out AFTER a match. Hidden until there are
              saved scores to recap — the scoreboard is built from the database,
              not from the unsaved form above. */}
          <RecapPanel
            matchId={matchId}
            hasResults={initialResults.length > 0}
            recapSentAt={recapSentAt}
          />
        </section>
      )}

      {error && (
        <p role="alert" className="rounded-xl bg-red-500/10 border border-red-400/30 text-red-200 p-3 text-sm">
          {error}
        </p>
      )}
      {note && (
        <p className="rounded-xl bg-[#D3FB52]/10 border border-[#D3FB52]/30 text-[#D3FB52] p-3 text-sm">
          {note}
        </p>
      )}
    </div>
  );
}

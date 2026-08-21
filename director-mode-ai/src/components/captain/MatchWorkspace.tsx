'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import EmailPreviewModal, { type EmailPreview } from './EmailPreviewModal';

export type MatchPlayer = {
  id: string;
  name: string;
  rating: number | null;
  isSub: boolean;
  hasEmail: boolean;
  availability: 'yes' | 'no' | 'maybe' | null;
};

type Court = {
  id?: string;
  courtNumber: number;
  courtType: 'singles' | 'doubles';
  player1Id: string | null;
  player2Id: string | null;
  player1ConfirmedAt?: string | null;
  player2ConfirmedAt?: string | null;
  notes?: string[];
};

type Explanation = { summary: string[]; benched: { name: string; reason: string }[] };

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
  withdrawals,
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
  initialResults: { courtNumber: number; score: string | null; won: boolean | null }[];
  /**
   * Who tapped "I can't play" on the lineup email. Keyed by PLAYER, not by
   * slot, so a withdrawal survives every swap and line flip below — a bail
   * belongs to the person, not the seat they happened to be in.
   */
  withdrawals: { playerId: string; at: string; note: string | null }[];
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
  const [previewKind, setPreviewKind] = useState<'poll' | 'lineup'>('poll');
  const [swapPick, setSwapPick] = useState<{ courtNumber: number; slot: 1 | 2 } | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  // datetime-local wants local wall-clock, not an ISO string with a zone.
  const [newDate, setNewDate] = useState(() => {
    const d = new Date(matchAt);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [scoring, setScoring] = useState(status === 'played');
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
  const needed = singlesCourts + doublesCourts * 2;

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
        const bail = withdrawn.get(pid);
        const ok = slot === 1 ? c.player1ConfirmedAt : c.player2ConfirmedAt;
        return {
          playerId: pid,
          name: nameOf(pid),
          court: `${c.courtType === 'singles' ? 'Singles' : 'Doubles'} ${c.courtNumber}`,
          state: bail ? ('out' as const) : ok ? ('in' as const) : ('waiting' as const),
          at: bail ? bail.at : ok,
        };
      })
      .filter(Boolean as unknown as (v: unknown) => boolean),
  ) as { playerId: string; name: string; court: string; state: 'in' | 'out' | 'waiting'; at: string | null }[];

  const confirmedNames = namedInLineup.filter((p) => p.state === 'in');
  const waitingNames = namedInLineup.filter((p) => p.state === 'waiting').map((p) => p.name);

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

  const save = () =>
    call(
      'save',
      '/api/captain/lineup',
      {
        action: 'save',
        team_id: teamId,
        match_id: matchId,
        courts: courts.map((c) => ({
          courtNumber: c.courtNumber,
          courtType: c.courtType,
          player1Id: c.player1Id,
          player2Id: c.player2Id,
        })),
      },
      async () => {
        setDirty(false);
        setHandEdited(false);
        setNote('Saved as a draft. Players still have not seen it.');
        await refreshAutoSend();
        router.refresh();
      },
    );

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

  /** Players not already placed elsewhere in the lineup. */
  const optionsFor = (court: Court, slot: 1 | 2) => {
    const current = slot === 1 ? court.player1Id : court.player2Id;
    const used = new Set(
      courts
        .flatMap((c) => [
          c.courtNumber === court.courtNumber && slot === 1 ? null : c.player1Id,
          c.courtNumber === court.courtNumber && slot === 2 ? null : c.player2Id,
        ])
        .filter(Boolean) as string[],
    );
    return players.filter((p) => p.id === current || !used.has(p.id));
  };

  return (
    <div className="mt-8 space-y-8">
      <EmailPreviewModal
        preview={preview}
        sending={busy === 'poll'}
        onSend={previewKind === 'lineup' ? confirmSendLineup : confirmPoll}
        onCancel={() => setPreview(null)}
      />
      {/* ---------------------------------------------------------- availability */}
      <section>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h2 className="text-xl font-display text-white">Availability</h2>
          <div className="flex gap-2">
            <button onClick={() => sendPoll(false)} disabled={!!busy} className={ghost}>
              {busy === 'poll' ? 'Working…' : 'Preview & ask the team'}
            </button>
            {silent.length > 0 && (
              <button onClick={() => sendPoll(true)} disabled={!!busy} className={ghost}>
                {busy === 'nudge' ? 'Working…' : `Preview nudge to ${silent.length}`}
              </button>
            )}
            <button onClick={() => setRescheduling((v) => !v)} disabled={!!busy} className={ghost}>
              {rescheduling ? 'Cancel' : 'Reschedule'}
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

        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Available', n: yes.length, tone: 'text-[#D3FB52]' },
            { label: 'Out', n: no.length, tone: 'text-red-300' },
            { label: 'Maybe', n: maybe.length, tone: 'text-amber-300' },
            { label: 'No answer', n: silent.length, tone: 'text-white/40' },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-white/[0.08] bg-[#002838] p-4">
              <div className={`text-2xl font-semibold ${s.tone}`}>{s.n}</div>
              <div className="text-white/40 text-xs uppercase tracking-wide mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        <p className="text-white/40 text-sm mt-3">
          {yes.length >= needed
            ? `Enough to field a lineup (${needed} spots).`
            : `Need ${needed - yes.length} more for a full lineup of ${needed}.`}
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {players
            .filter((p) => p.availability)
            .map((p) => (
              <span
                key={p.id}
                className={`text-xs px-2.5 py-1 rounded-full border ${
                  p.availability === 'yes'
                    ? 'border-[#D3FB52]/40 text-[#D3FB52]'
                    : p.availability === 'no'
                      ? 'border-red-400/30 text-red-300'
                      : 'border-amber-400/30 text-amber-300'
                }`}
              >
                {p.name}
                {p.isSub ? ' (sub)' : ''}
              </span>
            ))}
        </div>

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
            <button onClick={generate} disabled={!!busy} className={courts.length ? ghost : primary}>
              {busy === 'generate' ? 'Building…' : courts.length ? 'Regenerate' : 'Generate lineup'}
            </button>
            {courts.length > 0 && (
              <>
                <button onClick={save} disabled={!!busy || !dirty} className={ghost}>
                  {busy === 'save' ? 'Saving…' : dirty ? 'Save draft' : 'Saved'}
                </button>
                <button onClick={previewLineup} disabled={!!busy || dirty} className={primary}>
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
        {lineupSent && namedInLineup.length > 0 && (
          <div className="mt-3 rounded-xl border border-white/[0.08] bg-[#002838] p-4">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <h3 className="text-white font-medium text-sm">Who has answered the lineup email</h3>
              <span className="text-white/45 text-xs">
                {confirmedNames.length} of {namedInLineup.length} confirmed
              </span>
            </div>
            <div className="mt-3 grid gap-1.5">
              {namedInLineup.map((p) => (
                <div key={p.playerId} className="flex items-center gap-2 text-sm">
                  <span
                    className={
                      p.state === 'in'
                        ? 'text-[#D3FB52]'
                        : p.state === 'out'
                          ? 'text-red-400'
                          : 'text-white/25'
                    }
                  >
                    {p.state === 'in' ? '✓' : p.state === 'out' ? '✗' : '·'}
                  </span>
                  <span className={p.state === 'out' ? 'text-white/45 line-through' : 'text-white/85'}>
                    {p.name}
                  </span>
                  <span className="text-white/30 text-xs">{p.court}</span>
                  <span className="ml-auto text-xs text-white/40">
                    {p.state === 'in'
                      ? `confirmed ${fmtWhen(p.at as string)}`
                      : p.state === 'out'
                        ? `pulled out ${fmtWhen(p.at as string)}`
                        : 'no answer yet'}
                  </span>
                </div>
              ))}
            </div>
            {waitingNames.length > 0 && (
              <p className="text-white/35 text-xs mt-3">
                Still waiting on {waitingNames.join(', ')}.
              </p>
            )}
          </div>
        )}

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
          {courts.map((c) => (
            <div key={c.courtNumber} className="rounded-xl border border-white/[0.08] bg-[#002838] p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="text-white/50 text-xs uppercase tracking-wide">
                    {labelOf(c)}
                  </div>
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
                {c.notes && c.notes.length > 0 && (
                  <div className="text-white/35 text-xs text-right">{c.notes.join(' · ')}</div>
                )}
              </div>

              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {([1, 2] as const)
                  .filter((slot) => slot === 1 || c.courtType === 'doubles')
                  .map((slot) => {
                    const pid = slot === 1 ? c.player1Id : c.player2Id;
                    const confirmed = !!(slot === 1 ? c.player1ConfirmedAt : c.player2ConfirmedAt);
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
                          ) : (
                            confirmed && (
                              <span className="text-[#D3FB52] text-xs shrink-0" title="Confirmed">
                                confirmed
                              </span>
                            )
                          )}
                        </div>
                        {bailed?.note && (
                          <p className="text-red-300/70 text-xs mt-1 pl-10 italic">
                            “{bailed.note}”
                          </p>
                        )}
                        {c.id && pid && (
                          <button
                            onClick={() => findSub(c, slot)}
                            disabled={!!busy}
                            className={`text-xs mt-1.5 ${bailed ? 'text-red-300 hover:text-red-200 font-semibold' : 'text-white/35 hover:text-white'}`}
                          >
                            {busy === `sub-${c.courtNumber}-${slot}`
                              ? 'Asking subs…'
                              : bailed
                                ? `Find a sub for ${nameOf(pid)} →`
                                : `${nameOf(pid)} bailed — find a sub`}
                          </button>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>

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
              <button onClick={() => setScoring(true)} disabled={!!busy} className={ghost}>
                Enter scores
              </button>
            ) : (
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => saveResults(false)} disabled={!!busy} className={ghost}>
                  {busy === 'scores' ? 'Saving…' : 'Save scores'}
                </button>
                <button onClick={() => saveResults(true)} disabled={!!busy} className={primary}>
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
                        value={s.score}
                        onChange={(e) => setScore(c.courtNumber, { score: e.target.value })}
                        placeholder="6-4, 6-3"
                        aria-label={`Score for court ${c.courtNumber}`}
                        className="w-32 px-3 py-2 rounded-lg bg-[#001820] border border-white/10 text-white placeholder-white/25 text-sm focus:border-[#D3FB52]/50 focus:outline-none"
                      />
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

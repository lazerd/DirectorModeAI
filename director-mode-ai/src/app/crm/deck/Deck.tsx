'use client';

/**
 * One card, one decision, next card.
 *
 * ── WHY IT IS OPTIMISTIC ────────────────────────────────────────────────
 * The card advances the instant you decide, and the POST catches up behind
 * it. Fifteen cards at 300ms of network each is five seconds of waiting in a
 * flow whose entire value is that it is faster than opening fifteen emails.
 * If a write fails the card comes back with the error on it — which has never
 * once been the wrong tradeoff for a queue you can Undo.
 *
 * ── WHY THE TEXT IS A TEXTAREA AND NOT A PREVIEW ────────────────────────
 * Because the first thing anyone does with a generated email is change one
 * word. Making that a mode you have to enter ("Edit") means people send the
 * word they would have changed. So the body is always editable in place, and
 * E just puts the cursor in it. Whatever is in the box when you swipe right
 * is what goes out.
 *
 * ── KEYBOARD AND TOUCH ARE THE SAME DECISIONS ───────────────────────────
 * →/← on a laptop, a real drag on a phone. The drag is pointer-events so it
 * works with a mouse too, it follows the finger with rotation, and it only
 * commits past a threshold — a 20px scroll must never send an email.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { DeckCard } from '@/lib/outreach/types';

const SKIP_REASONS = ['Too small', 'Wrong region', 'Has a system already', 'Contact looks wrong', 'Not a fit'];

/** Past this much drag, a release is a decision. */
const COMMIT_PX = 95;

interface Payload {
  today: string;
  paused: boolean;
  cards: DeckCard[];
  tally: { total: number; approved: number; rejected: number; snoozed: number; sent: number };
  undo: { queue_id: string; org_name: string; was: string } | null;
}

type Action = 'approve' | 'skip' | 'snooze' | 'edit' | 'undo';

export default function Deck({ initial, repName }: { initial: Payload; repName: string }) {
  const [cards, setCards] = useState<DeckCard[]>(initial.cards);
  const [index, setIndex] = useState(0);
  const [tally, setTally] = useState(initial.tally);
  const [undoable, setUndoable] = useState(initial.undo);
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null);
  const [asking, setAsking] = useState(false);
  const [drag, setDrag] = useState(0);
  const [flying, setFlying] = useState<'left' | 'right' | null>(null);

  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const card = cards[index] ?? null;
  const done = !card;

  /* The edited text, keyed by card, so flipping back and forth keeps changes. */
  const [edits, setEdits] = useState<Record<string, { subject: string; body: string }>>({});
  const current = card ? edits[card.queue_id] ?? { subject: card.subject, body: card.body } : null;
  const dirty = !!card && !!current && (current.subject !== card.subject || current.body !== card.body);

  const say = useCallback((text: string, bad?: boolean) => {
    setToast({ text, bad });
    window.setTimeout(() => setToast(null), bad ? 5000 : 2200);
  }, []);

  const post = useCallback(
    async (action: Action, queueId: string, extra: Record<string, unknown> = {}) => {
      const res = await fetch('/api/outreach/decide', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ queue_id: queueId, action, ...extra }),
      });
      const json = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) throw new Error(json.error || 'That did not save.');
      return json.message || 'Done.';
    },
    [],
  );

  /** Commit a decision on the current card and move on. */
  const decide = useCallback(
    async (action: Exclude<Action, 'undo' | 'edit'>, reason?: string) => {
      if (!card || !current) return;
      const target = card;
      const extra: Record<string, unknown> =
        action === 'approve' ? { subject: current.subject, body: current.body } : reason ? { reason } : {};

      setFlying(action === 'approve' ? 'right' : 'left');
      setAsking(false);
      window.setTimeout(() => {
        setFlying(null);
        setDrag(0);
        setIndex((i) => i + 1);
      }, 170);

      setTally((t) => ({
        ...t,
        approved: t.approved + (action === 'approve' ? 1 : 0),
        rejected: t.rejected + (action === 'skip' ? 1 : 0),
        snoozed: t.snoozed + (action === 'snooze' ? 1 : 0),
      }));
      setUndoable({ queue_id: target.queue_id, org_name: target.org_name, was: action });

      try {
        say(await post(action, target.queue_id, extra));
      } catch (e) {
        say((e as Error).message, true);
        // Put it back where it was rather than pretend it went.
        setIndex((i) => Math.max(0, i - 1));
        setUndoable(null);
      }
    },
    [card, current, post, say],
  );

  const doUndo = useCallback(async () => {
    if (!undoable) return;
    const target = undoable;
    setUndoable(null);
    try {
      say(await post('undo', target.queue_id));
      // The row is planned again; the simplest honest refresh is a reload of
      // the deck, because its position in the order is the server's to decide.
      const res = await fetch('/api/outreach/deck', { cache: 'no-store' });
      const next = (await res.json()) as Payload;
      setCards(next.cards);
      setTally(next.tally);
      setUndoable(next.undo);
      setIndex(0);
    } catch (e) {
      say((e as Error).message, true);
      setUndoable(target);
    }
  }, [undoable, post, say]);

  // ------------------------------------------------------------ keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT');
      if (e.key === 'Escape' && typing) {
        (el as HTMLElement).blur();
        return;
      }
      if (typing) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); void decide('approve'); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); setAsking(true); }
      else if (e.key.toLowerCase() === 'e') { e.preventDefault(); bodyRef.current?.focus(); }
      else if (e.key.toLowerCase() === 'u') { e.preventDefault(); void doUndo(); }
      else if (e.key.toLowerCase() === 's') { e.preventDefault(); void decide('snooze'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [decide, doUndo]);

  // --------------------------------------------------------------- touch
  const onPointerDown = (e: React.PointerEvent) => {
    const el = e.target as HTMLElement;
    // Dragging must never start inside the text the rep is editing.
    if (el.closest('textarea, input, button, a')) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current || start.current.id !== e.pointerId) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    // A vertical gesture is a scroll, not a swipe.
    if (Math.abs(dy) > Math.abs(dx) * 1.4 && Math.abs(dy) > 14) return;
    setDrag(dx);
  };
  const onPointerUp = () => {
    const dx = drag;
    start.current = null;
    if (dx > COMMIT_PX) void decide('approve');
    else if (dx < -COMMIT_PX) setAsking(true);
    setDrag(dx > COMMIT_PX || dx < -COMMIT_PX ? dx : 0);
  };

  const transform = flying
    ? `translateX(${flying === 'right' ? 620 : -620}px) rotate(${flying === 'right' ? 14 : -14}deg)`
    : `translateX(${drag}px) rotate(${drag / 26}deg)`;

  const total = tally.total || cards.length;
  const position = Math.min(index + 1, cards.length);

  // ----------------------------------------------------------- end screen
  if (done) {
    return (
      <div className="mt-10" data-testid="deck-end">
        <p className="font-display text-xl text-white">
          {tally.approved + tally.rejected + tally.snoozed === 0
            ? 'Nothing to decide.'
            : "That's the deck."}
        </p>
        <ul className="mt-4 space-y-1 text-sm text-white/55">
          <li>
            <span className="font-semibold text-[#D3FB52]">{tally.approved}</span> approved — they go out inside each
            club&rsquo;s morning.
          </li>
          <li>
            <span className="font-semibold text-white/80">{tally.rejected}</span> skipped for good.
          </li>
          {tally.snoozed > 0 && (
            <li>
              <span className="font-semibold text-white/80">{tally.snoozed}</span> back in a week.
            </li>
          )}
          {tally.sent > 0 && (
            <li>
              <span className="font-semibold text-white/80">{tally.sent}</span> already sent today.
            </li>
          )}
        </ul>
        {cards.length === 0 && initial.paused && (
          <p className="mt-4 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">
            Outreach is paused in settings. Nothing will be planned or sent until that is off.
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/crm" className="rounded-lg bg-[#D3FB52] px-4 py-2 text-sm font-semibold text-[#001820]">
            Back to the pipeline
          </Link>
          {undoable && (
            <button
              onClick={() => void doUndo()}
              className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/70"
            >
              Undo {undoable.org_name}
            </button>
          )}
        </div>
        {toast && <Toast toast={toast} />}
      </div>
    );
  }

  const place = [card.org_city, card.org_state].filter(Boolean).join(', ');

  return (
    <div className="mt-5">
      {/* Progress. Deliberately the first thing under the title: the rep wants
          to know how long this is going to take before they read anything. */}
      <p className="text-sm text-white/45" data-testid="deck-progress">
        {position} of {cards.length} today
        {tally.approved > 0 && <span className="text-white/30"> · {tally.approved} approved</span>}
      </p>

      <div
        data-testid="deck-card"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ transform, transition: start.current ? 'none' : 'transform 170ms ease-out', touchAction: 'pan-y' }}
        className="relative mt-3 select-none rounded-2xl border border-white/[0.08] bg-[#002838] p-4 sm:p-5"
      >
        {/* The swipe's own feedback, so a half-drag says what it would do. */}
        <Edge side="right" on={drag > 40} label="Approve" />
        <Edge side="left" on={drag < -40} label="Skip" />

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate font-display text-lg text-white">{card.org_name}</h2>
            <p className="mt-0.5 text-xs text-white/40">
              {card.contact_name}
              {card.contact_title ? ` · ${card.contact_title}` : ''} · {card.contact_email}
            </p>
          </div>
          {card.kind === 'followup' && (
            <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/60">
              follow-up
            </span>
          )}
        </div>

        {/* Why this club. One line, all facts, never generated. */}
        <p className="mt-3 rounded-lg bg-white/[0.04] px-3 py-2 text-[13px] leading-snug text-white/60" data-testid="deck-why">
          {card.why}
          {place && <span className="text-white/35"> · {place}</span>}
          {card.generated_by === 'template' && <span className="text-white/35"> · plain template</span>}
        </p>

        {card.blocks.length > 0 && (
          <p className="mt-3 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-[13px] text-red-200">
            This one cannot be sent: {card.blocks.join(', ')}.
          </p>
        )}

        <label className="mt-4 block text-[11px] uppercase tracking-wide text-white/30">Subject</label>
        <input
          value={current?.subject ?? ''}
          onChange={(e) =>
            setEdits((m) => ({ ...m, [card.queue_id]: { subject: e.target.value, body: current?.body ?? '' } }))
          }
          data-testid="deck-subject"
          className="mt-1 w-full rounded-lg border border-white/10 bg-[#001820] px-3 py-2 text-sm font-semibold text-white focus:border-[#D3FB52]/50 focus:outline-none"
        />

        <label className="mt-3 block text-[11px] uppercase tracking-wide text-white/30">
          The email {dirty && <span className="text-[#D3FB52]">· edited</span>}
        </label>
        <textarea
          ref={bodyRef}
          value={current?.body ?? ''}
          onChange={(e) =>
            setEdits((m) => ({ ...m, [card.queue_id]: { subject: current?.subject ?? '', body: e.target.value } }))
          }
          rows={13}
          data-testid="deck-body"
          className="mt-1 w-full resize-y rounded-lg border border-white/10 bg-[#001820] px-3 py-2.5 text-[14px] leading-relaxed text-white/90 focus:border-[#D3FB52]/50 focus:outline-none"
        />
        <p className="mt-1.5 text-[11px] text-white/30">
          Sent from {repName}&rsquo;s reply-to. The signature, the opt-out line and our postal address are added below
          this automatically.
        </p>
      </div>

      {/*
        The buttons are the same four decisions as the keys and the swipe.

        Two things on a phone, both about the same 56px:

        `pr-14` keeps the row clear of the app's global "Ask ClubMode" button,
        which is fixed in the bottom-right corner and sat directly on top of
        Approve — a primary action you could not fully tap. Reserving the
        column beside it is the only fix that holds at every scroll position,
        because a fixed button does not move when you scroll and a sticky one
        stops being sticky at the end of the document.

        `sticky` then keeps the four decisions reachable while the rep scrolls
        a long email, which on a 430px screen is what they are always doing.
      */}
      <div className="sticky bottom-3 z-10 mt-4 grid grid-cols-4 gap-2 rounded-xl bg-[#001820]/90 py-2 pr-14 backdrop-blur sm:static sm:bg-transparent sm:py-0 sm:pr-0 sm:backdrop-blur-none">
        <Button onClick={() => setAsking(true)} testid="deck-skip" tone="skip">
          Skip <Key>←</Key>
        </Button>
        <Button onClick={() => void decide('snooze')} testid="deck-snooze" tone="quiet">
          Snooze <Key>S</Key>
        </Button>
        <Button onClick={() => bodyRef.current?.focus()} testid="deck-edit" tone="quiet">
          Edit <Key>E</Key>
        </Button>
        <Button
          onClick={() => void decide('approve')}
          testid="deck-approve"
          tone="go"
          disabled={card.blocks.length > 0}
        >
          Approve <Key dark>→</Key>
        </Button>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-white/30">
        <span>Approving queues it. It sends inside that club&rsquo;s morning, never at once.</span>
        {undoable && (
          <button onClick={() => void doUndo()} data-testid="deck-undo" className="underline underline-offset-4 hover:text-white/60">
            Undo ({undoable.org_name}) · U
          </button>
        )}
      </div>

      {/* Left swipe asks why — one tap, and skipping without a reason is a tap
          too. Never a required field: a reason nobody wants to give becomes a
          reason nobody gives, and then nobody skips. */}
      {asking && (
        <div
          data-testid="deck-reason"
          className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-[#002030] p-4 sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:right-0 sm:mt-3 sm:rounded-xl sm:border"
        >
          <p className="text-sm text-white/70">Skip {card.org_name} for good. Why?</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {SKIP_REASONS.map((r) => (
              <button
                key={r}
                onClick={() => void decide('skip', r)}
                className="rounded-full border border-white/15 px-3 py-1.5 text-[13px] text-white/75 hover:border-[#D3FB52]/40 hover:text-white"
              >
                {r}
              </button>
            ))}
            <button
              onClick={() => void decide('skip')}
              data-testid="deck-skip-noreason"
              className="rounded-full bg-white/10 px-3 py-1.5 text-[13px] text-white/60"
            >
              Just skip
            </button>
          </div>
          <button
            onClick={() => { setAsking(false); setDrag(0); }}
            className="mt-3 text-xs text-white/35 underline underline-offset-4"
          >
            Never mind
          </button>
        </div>
      )}

      {toast && <Toast toast={toast} />}
    </div>
  );
}

function Edge({ side, on, label }: { side: 'left' | 'right'; on: boolean; label: string }) {
  return (
    <span
      className={`pointer-events-none absolute top-4 ${side === 'right' ? 'right-4' : 'left-4'} rounded-md border px-2 py-1 text-[11px] font-bold uppercase tracking-wider transition-opacity ${
        side === 'right' ? 'border-[#D3FB52] text-[#D3FB52]' : 'border-red-400 text-red-300'
      } ${on ? 'opacity-100' : 'opacity-0'}`}
    >
      {label}
    </span>
  );
}

function Button({
  children,
  onClick,
  tone,
  testid,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone: 'go' | 'skip' | 'quiet';
  testid: string;
  disabled?: boolean;
}) {
  const cls =
    tone === 'go'
      ? 'bg-[#D3FB52] text-[#001820] disabled:opacity-40'
      : tone === 'skip'
        ? 'border border-red-400/30 text-red-200'
        : 'border border-white/12 text-white/70';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      data-testid={testid}
      className={`rounded-lg px-2 py-2.5 text-sm font-semibold ${cls}`}
    >
      {children}
    </button>
  );
}

function Key({ children, dark }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <span className={`ml-1 hidden text-[11px] font-normal sm:inline ${dark ? 'text-[#001820]/50' : 'text-white/30'}`}>
      {children}
    </span>
  );
}

function Toast({ toast }: { toast: { text: string; bad?: boolean } }) {
  return (
    <div
      data-testid="deck-toast"
      className={`fixed bottom-4 left-1/2 z-30 w-[min(92vw,520px)] -translate-x-1/2 rounded-lg px-4 py-2.5 text-sm shadow-lg ${
        toast.bad ? 'bg-red-500 text-white' : 'bg-[#D3FB52] text-[#001820]'
      }`}
    >
      {toast.text}
    </div>
  );
}

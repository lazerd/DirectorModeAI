'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sparkles, X, Send, Loader2 } from 'lucide-react';
import { isClubPublicPath } from '@/lib/clubSite/publicPaths';

/**
 * Floating ClubMode Assistant — a chat bubble + panel mounted once in the root
 * layout, so it is available on every page. Talks to /api/assistant/chat, which
 * requires a logged-in user and meters each message as an AI action.
 */

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

/** Mirrors MeterSnapshot in lib/assistant/meter. */
interface Meter {
  spentUsd: number;
  includedUsd: number;
  overageUsd: number;
  capUsd: number;
  thisRequestUsd?: number;
  exempt: boolean;
  payg: boolean;
  needsPayg: boolean;
  notice?: string;
}

/** "4¢" under a dollar, "$1.23" above — a request should read as pennies. */
function money(usd: number): string {
  if (usd < 1) return `${Math.max(0, Math.round(usd * 100 * 10) / 10)}¢`;
  return `$${usd.toFixed(2)}`;
}

// Context-aware greeting — the matchup-action pitch only makes sense on a JTT
// matchup page; everywhere else it's confusing, so lead with general help.
function greetingFor(path: string | null): string {
  if (path && path.includes('/jtt/matchup/')) {
    return "Hi! I'm Ask Claude. On this matchup I can do it for you — \"check in the MCC 13s\" or \"add Brooke McGuire to MCC 12s.\"";
  }
  return "Hi! I'm Ask Claude. Tell me what you need and I'll do it — \"set up a Tuesday 6pm clinic for 10 weeks\", \"tonight's attendance was…\", \"block courts 3-6 Saturday afternoon\", \"what's happening today?\" I'll show you before I change anything.";
}

// Public marketing surfaces — the live assistant is for directors inside the app,
// not for prospects. The homepage advertises it instead. Add prefixes here to
// hide it elsewhere (e.g. participant share pages).
/**
 * Public pages. The assistant requires a session — /api/assistant/chat returns
 * 401 "Please log in" — so on a marketing page the bubble is an invitation to
 * tap your headline AI feature and receive an auth error. Tokenized player
 * pages are excluded for the same reason plus a second one: a parent entering a
 * score has no account and never will.
 */
const PUBLIC = [
  '/pricing', '/captainmode', '/terms', '/privacy',
  '/login', '/register', '/verify-email', '/forgot-password', '/reset-password',
  '/tournaments/player', '/leagues/line', '/leagues/match', '/leagues/roster',
  '/leagues/confirm-partner', '/quads/match', '/quads/player', '/swim-family',
  '/captain/availability', '/captain/intake', '/captain/claim', '/captain/confirm',
  '/pathway/p', '/pathway/curriculum', '/book', '/join', '/event', '/nps',
  // Premier Tennis League. A standalone product — a bubble offering to help
  // with "events, courts, leagues, billing" on a league site is an advert for
  // a different product, and on the projected draft board it is a bug.
  '/ptl',
  // Club-owned public websites. "Ask ClubMode" on a club's own homepage tells
  // their visitors whose software it is, which is not the club's to give away.
  '/c',
];
const HIDDEN_PATHS = (path: string) =>
  path === '/' || isClubPublicPath(path) || PUBLIC.some((p) => path === p || path.startsWith(p + '/'));

export default function AssistantWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meter, setMeter] = useState<Meter | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [paygUrl, setPaygUrl] = useState<string | null>(null);
  // null = not known yet; false = not on the $75 plan, show the upgrade card.
  const [entitled, setEntitled] = useState<boolean | null>(null);
  const [upgrade, setUpgrade] = useState<{ message: string; url: string | null } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
      inputRef.current?.focus();
    }
  }, [open, messages, sending]);

  // Show the meter the moment the panel opens, before anything is spent.
  useEffect(() => {
    if (!open || meter || entitled === false) return;
    fetch('/api/assistant/chat')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.entitled === false) {
          setEntitled(false);
          setUpgrade({ message: j.message, url: j.upgradeUrl ?? null });
          return;
        }
        if (j?.entitled) setEntitled(true);
        if (j?.meter) setMeter(j.meter);
        if (j?.paygUrl) setPaygUrl(j.paygUrl);
      })
      .catch(() => {});
  }, [open, meter]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setError(null);
    const nextHistory = [...messages, { role: 'user' as const, content: text }];
    setMessages(nextHistory);
    setInput('');
    setSending(true);
    try {
      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: messages.slice(-10),
          page: pathname,
        }),
      });
      const data = await res.json().catch(() => null);
      if (data?.kind === 'upgrade') {
        setEntitled(false);
        setUpgrade({ message: data.message, url: data.upgradeUrl ?? null });
        return;
      }
      if (data?.paygUrl) setPaygUrl(data.paygUrl);
      if (data?.meter) {
        setMeter(data.meter);
        if (data.meter.notice) setNotice(data.meter.notice);
      }
      if (!res.ok || data?.kind === 'error') {
        setError(data?.message ?? 'Something went wrong. Please try again.');
      } else {
        setMessages([...nextHistory, { role: 'assistant', content: data.text }]);
      }
    } catch {
      setError('Could not reach the assistant. Check your connection and try again.');
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  if (pathname && HIDDEN_PATHS(pathname)) return null;

  return (
    <>
      {/* Launcher */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open Ask Claude"
          // Above the demo bar when there is one (DemoBanner sets the var).
          style={{ bottom: 'calc(1.25rem + var(--demo-bar-h, 0px))' }}
          className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-yellow-300 text-[#001820] shadow-lg shadow-black/30 px-4 py-3 font-medium hover:bg-yellow-200 transition-colors"
        >
          <Sparkles size={18} />
          <span className="hidden sm:inline text-sm">Ask Claude</span>
        </button>
      )}

      {/* Panel */}
      {open && (
        <div
          style={{ bottom: 'calc(1.25rem + var(--demo-bar-h, 0px))' }}
          className="fixed bottom-5 right-5 z-50 w-[calc(100vw-2.5rem)] max-w-sm h-[32rem] max-h-[calc(100vh-2.5rem)] flex flex-col rounded-2xl border border-white/10 bg-[#001820] text-white shadow-2xl shadow-black/50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08] bg-[#002838]">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-yellow-300/20 flex items-center justify-center">
                <Sparkles size={15} className="text-yellow-300" />
              </div>
              <span className="font-medium text-sm">Ask Claude</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
              className="text-white/50 hover:text-white p-1"
            >
              <X size={18} />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            <Bubble role="assistant">{greetingFor(pathname)}</Bubble>
            {messages.map((m, i) => (
              <Bubble key={i} role={m.role}>
                {m.content}
              </Bubble>
            ))}
            {sending && (
              <div className="flex items-center gap-2 text-white/50 text-sm">
                <Loader2 size={14} className="animate-spin" /> Thinking…
              </div>
            )}
            {entitled === false && upgrade && (
              <div className="rounded-xl border border-yellow-300/30 bg-yellow-300/[0.06] p-3 text-sm text-white/85 space-y-2.5">
                <p>{upgrade.message}</p>
                {upgrade.url && (
                  <a
                    href={upgrade.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-lg bg-yellow-300 text-[#001820] font-medium text-center px-3 py-2 hover:bg-yellow-200"
                  >
                    Upgrade to unlock Ask Claude
                  </a>
                )}
              </div>
            )}
            {notice && (
              <div className="rounded-lg bg-yellow-300/10 border border-yellow-300/30 text-yellow-100 text-sm px-3 py-2">
                {notice}
              </div>
            )}
            {meter?.needsPayg && paygUrl && (
              <a
                href={paygUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-lg bg-yellow-300 text-[#001820] text-sm font-medium text-center px-3 py-2 hover:bg-yellow-200"
              >
                Turn on pay-as-you-go
              </a>
            )}
            {error && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/20 text-red-200 text-sm px-3 py-2">
                {error}
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-white/[0.08] p-3">
            <div className="flex items-end gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 focus-within:border-yellow-300/40">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                placeholder="Tell me what you need done…"
                className="flex-1 resize-none bg-transparent text-sm placeholder-white/30 focus:outline-none max-h-24"
              />
              <button
                onClick={send}
                disabled={!input.trim() || sending}
                aria-label="Send"
                className="text-yellow-300 disabled:text-white/20 hover:text-yellow-200 transition-colors pb-0.5"
              >
                <Send size={18} />
              </button>
            </div>
            <MeterBar meter={meter} />
          </div>
        </div>
      )}
    </>
  );
}

/**
 * The live meter. Darrin, 2026-10-09: it has to be obvious that Ask Claude costs
 * money, and seeing that a request costs a few cents is what makes it enticing.
 */
function MeterBar({ meter }: { meter: Meter | null }) {
  if (!meter) {
    return <p className="mt-1.5 text-[10px] text-white/30 text-center">Ask Claude is metered: $5 a month included.</p>;
  }
  const pct = Math.min(100, (meter.spentUsd / meter.includedUsd) * 100);
  const over = meter.overageUsd > 0;
  return (
    <div className="mt-2 px-0.5">
      <div className="h-1 rounded-full bg-white/10 overflow-hidden">
        <div
          className={`h-full ${over ? 'bg-orange-400' : 'bg-yellow-300'}`}
          style={{ width: `${over ? 100 : pct}%` }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-white/45">
        <span>
          {meter.exempt
            ? `This month ${money(meter.spentUsd)} · your club is not billed`
            : over
              ? `This month ${money(meter.spentUsd)} · ${money(meter.overageUsd)} over $${meter.includedUsd} included, billed with your plan`
              : `This month ${money(meter.spentUsd)} of $${meter.includedUsd} included`}
        </span>
        {meter.thisRequestUsd !== undefined && <span>last answer {money(meter.thisRequestUsd)}</span>}
      </div>
    </div>
  );
}

function Bubble({ role, children }: { role: 'user' | 'assistant'; children: React.ReactNode }) {
  const isUser = role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap leading-relaxed ${
          isUser
            ? 'bg-yellow-300 text-[#001820]'
            : 'bg-white/[0.06] text-white/90 border border-white/[0.06]'
        }`}
      >
        {children}
      </div>
    </div>
  );
}

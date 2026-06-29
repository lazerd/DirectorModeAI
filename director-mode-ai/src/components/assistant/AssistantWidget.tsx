'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sparkles, X, Send, Loader2 } from 'lucide-react';

/**
 * Floating ClubMode Assistant — a chat bubble + panel mounted once in the root
 * layout, so it is available on every page. Talks to /api/assistant/chat, which
 * requires a logged-in user and meters each message as an AI action.
 */

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

const GREETING =
  "Hi! I'm your ClubMode Assistant. Ask me how to do anything — run a mixer, read the Board Report, score a JTT line, set up lessons.";

// Public marketing surfaces — the live assistant is for directors inside the app,
// not for prospects. The homepage advertises it instead. Add prefixes here to
// hide it elsewhere (e.g. participant share pages).
const HIDDEN_PATHS = (path: string) => path === '/' || path.startsWith('/pricing');

export default function AssistantWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
      inputRef.current?.focus();
    }
  }, [open, messages, sending]);

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
          aria-label="Open ClubMode Assistant"
          className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-yellow-300 text-[#001820] shadow-lg shadow-black/30 px-4 py-3 font-medium hover:bg-yellow-200 transition-colors"
        >
          <Sparkles size={18} />
          <span className="hidden sm:inline text-sm">Ask ClubMode</span>
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="fixed bottom-5 right-5 z-50 w-[calc(100vw-2.5rem)] max-w-sm h-[32rem] max-h-[calc(100vh-2.5rem)] flex flex-col rounded-2xl border border-white/10 bg-[#001820] text-white shadow-2xl shadow-black/50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08] bg-[#002838]">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-yellow-300/20 flex items-center justify-center">
                <Sparkles size={15} className="text-yellow-300" />
              </div>
              <span className="font-medium text-sm">ClubMode Assistant</span>
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
            <Bubble role="assistant">{GREETING}</Bubble>
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
                placeholder="Ask anything about running your club…"
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
            <p className="mt-1.5 text-[10px] text-white/30 text-center">
              Each answer counts as one AI action on your plan.
            </p>
          </div>
        </div>
      )}
    </>
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

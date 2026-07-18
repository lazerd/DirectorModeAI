'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Send } from 'lucide-react';

export type HubMsg = {
  id: string;
  author_name: string;
  persona_id: string | null;
  is_persona: boolean;
  body: string;
  reply_to: string | null;
  created_at: string;
};

// Deterministic avatar color from a name (personas and humans look identical).
const AVATAR_COLORS = [
  '#D3FB52', '#22d3ee', '#fb923c', '#60a5fa', '#a78bfa', '#f472b6',
  '#34d399', '#2dd4bf', '#f59e0b', '#38bdf8', '#f87171', '#c084fc',
];
function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return t;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${t}`;
}

export default function ClubHubRoom({
  initialMessages, myName,
}: {
  initialMessages: HubMsg[];
  myName: string;
}) {
  const [messages, setMessages] = useState<HubMsg[]>(initialMessages);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const seen = useRef<Set<string>>(new Set(initialMessages.map((m) => m.id)));

  const addMessages = useCallback((incoming: HubMsg[]) => {
    setMessages((prev) => {
      const fresh = incoming.filter((m) => !seen.current.has(m.id));
      if (!fresh.length) return prev;
      fresh.forEach((m) => seen.current.add(m.id));
      return [...prev, ...fresh].sort((a, b) => a.created_at.localeCompare(b.created_at));
    });
  }, []);

  // Keep the room current via two paths: Supabase Realtime for instant inserts,
  // plus a short poll as a fallback (realtime can miss a burst if it fires before
  // the channel is subscribed, or isn't enabled). addMessages de-dupes by id, so
  // the two coexist safely.
  useEffect(() => {
    const supabase = createClient();
    let active = true;

    const refetch = async () => {
      try {
        const res = await fetch('/api/club-hub/messages?limit=60', { cache: 'no-store' });
        if (active && res.ok) {
          const { messages: latest } = await res.json();
          if (Array.isArray(latest)) addMessages(latest);
        }
      } catch { /* keep what we have */ }
    };

    refetch();
    const poll = setInterval(refetch, 10_000);

    const channel = supabase
      .channel('club-hub')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'club_hub_messages' },
        (payload) => addMessages([payload.new as HubMsg]),
      )
      .subscribe();

    return () => { active = false; clearInterval(poll); supabase.removeChannel(channel); };
  }, [addMessages]);

  // Keep the room alive while someone's here: ping the throttled refresh on open
  // and periodically. The server only actually generates when the room has gone
  // quiet, so this can't spam regardless of how many people are watching.
  useEffect(() => {
    const ping = () => { fetch('/api/club-hub/refresh', { method: 'POST' }).catch(() => {}); };
    ping();
    const iv = setInterval(ping, 60_000);
    return () => clearInterval(iv);
  }, []);

  // Keep pinned to the newest message.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    const body = input.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/club-hub/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error || 'Could not send.'); return; }
      setInput('');
      if (data?.message) addMessages([data.message as HubMsg]); // optimistic; realtime echo de-dupes
      // Nudge the personas to reply right away instead of waiting for the poll.
      fetch('/api/club-hub/refresh', { method: 'POST' }).catch(() => {});
    } catch {
      setError('Could not send — check your connection.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-1rem)] max-w-3xl mx-auto px-3 sm:px-4">
      {/* Header */}
      <div className="py-4 border-b border-white/10">
        <h1 className="text-xl font-semibold text-slate-100">Club Hub</h1>
        <p className="text-sm text-slate-400">
          Where racquet-club directors talk shop — stories, questions, best practices, and good jabber.
        </p>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-slate-500 text-sm mt-10">
            It’s quiet in here… start the conversation.
          </div>
        )}
        {messages.map((m) => {
          const mine = !m.is_persona && m.author_name === myName;
          const color = colorFor(m.author_name);
          return (
            <div key={m.id} className="flex gap-3">
              <div
                className="mt-0.5 h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-sm font-bold text-[#002838]"
                style={{ backgroundColor: color }}
                aria-hidden
              >
                {m.author_name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium text-slate-100">{m.author_name}</span>
                  {mine && <span className="text-[10px] uppercase tracking-wide text-slate-500">you</span>}
                  <span className="text-xs text-slate-500">{timeLabel(m.created_at)}</span>
                </div>
                <div className="text-slate-200 whitespace-pre-wrap break-words leading-relaxed">
                  {m.body}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="border-t border-white/10 py-3">
        {error && <div className="text-sm text-red-400 mb-2">{error}</div>}
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            rows={1}
            placeholder={`Message the Hub as ${myName}…`}
            className="flex-1 resize-none rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#D3FB52]/50 max-h-40"
          />
          <button
            onClick={send}
            disabled={sending || !input.trim()}
            className="shrink-0 rounded-xl bg-[#D3FB52] text-[#002838] font-semibold px-4 py-2.5 disabled:opacity-40 hover:brightness-95 transition"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

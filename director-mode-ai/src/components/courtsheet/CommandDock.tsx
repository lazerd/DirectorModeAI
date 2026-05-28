'use client';

/**
 * Floating AI command dock — wired to /api/courtsheet/ai/chat.
 *
 * Flow:
 *   - User types or speaks → submit() → POST /ai/chat
 *   - Response { kind: 'plan' }   → open PlanPreview, await confirm
 *   - Response { kind: 'message' } → show inline as the assistant turn
 *   - Response { kind: 'slots' }   → show the slot list inline
 *   - Confirm → POST /ai/confirm → sheet refreshes (onApplied)
 *   - Undo button on toast → engine.undo via plan_id
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Sparkles, Loader2, Send, X, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import type { Plan } from '@/lib/courtsheet/types';
import PlanPreview from './PlanPreview';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  tool_calls?: Array<{ id: string; name: string; input: unknown }>;
  tool_results?: Array<{ tool_use_id: string; content: string }>;
}

interface ChatResponse {
  kind: 'plan' | 'slots' | 'message' | 'error';
  plan?: Plan;
  summary?: string;
  ai_message?: string | null;
  text?: string;
  slots?: Array<{
    court: string;
    date: string;
    start: string;
    end: string;
    duration_minutes: number;
  }>;
  message?: string;
  tool_calls?: Array<{ id: string; name: string; input: unknown }>;
  tool_results?: Array<{ tool_use_id: string; content: string }>;
}

interface Props {
  /** Called after a plan is successfully applied so the sheet refetches. */
  onApplied?: () => void;
}

export default function CommandDock({ onApplied }: Props = {}) {
  const [listening, setListening] = useState(false);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [history, setHistory] = useState<Message[]>([]);
  const [open, setOpen] = useState(false); // chat panel
  const [pendingPlan, setPendingPlan] = useState<{
    plan: Plan;
    summary: string | null;
    aiMessage: string | null;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);

  // ⌘K / Ctrl+K opens & focuses.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      if (e.key === 'Escape' && open && !pendingPlan) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, pendingPlan]);

  const submit = useCallback(async () => {
    const message = draft.trim();
    if (!message || submitting) return;
    setSubmitting(true);
    const userTurn: Message = { role: 'user', content: message };
    setHistory((h) => [...h, userTurn]);
    setDraft('');

    try {
      const res = await fetch('/api/courtsheet/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history }),
      });
      const data = (await res.json()) as ChatResponse;

      if (data.kind === 'error') {
        toast.error(data.message ?? 'Something went wrong');
        return;
      }

      if (data.kind === 'plan' && data.plan) {
        setPendingPlan({
          plan: data.plan,
          summary: data.summary ?? null,
          aiMessage: data.ai_message ?? null,
        });
        const assistantTurn: Message = {
          role: 'assistant',
          content: data.ai_message ?? data.summary ?? 'Preview ready.',
          tool_calls: data.tool_calls,
          tool_results: data.tool_results,
        };
        setHistory((h) => [...h, assistantTurn]);
        return;
      }

      if (data.kind === 'slots' && data.slots) {
        const lines = data.slots.slice(0, 6).map((s) => `${s.date} ${s.court}: ${s.start}-${s.end}`);
        const slotsContent = data.ai_message
          ? `${data.ai_message}\n${lines.join('\n')}`
          : data.slots.length > 0
          ? `Open times:\n${lines.join('\n')}${data.slots.length > 6 ? `\n…and ${data.slots.length - 6} more` : ''}`
          : 'No open times found for that window.';
        setHistory((h) => [
          ...h,
          {
            role: 'assistant',
            content: slotsContent,
            tool_calls: data.tool_calls,
            tool_results: data.tool_results,
          },
        ]);
        return;
      }

      // Plain message (clarifying question or status).
      setHistory((h) => [
        ...h,
        {
          role: 'assistant',
          content: data.text ?? 'I need more details.',
          tool_calls: data.tool_calls,
          tool_results: data.tool_results,
        },
      ]);
    } catch (err) {
      toast.error('AI command failed');
    } finally {
      setSubmitting(false);
    }
  }, [draft, history, submitting]);

  const startVoice = useCallback(() => {
    const SR =
      (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SR) {
      toast.error('Voice not supported — try Chrome or Edge.');
      return;
    }
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }
    const rec = new SR();
    rec.lang = 'en-US';
    rec.continuous = false;
    rec.interimResults = true;
    rec.onstart = () => setListening(true);
    rec.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    rec.onerror = () => setListening(false);
    rec.onresult = (ev: any) => {
      const transcript = Array.from(ev.results)
        .map((r: any) => r[0].transcript)
        .join(' ');
      setDraft(transcript);
    };
    rec.start();
    recognitionRef.current = rec;
  }, []);

  const confirmPlan = useCallback(
    async ({ skipConflicting }: { skipConflicting: boolean }) => {
      if (!pendingPlan) return;
      const res = await fetch('/api/courtsheet/ai/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: pendingPlan.plan, skipConflicting }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? 'Apply failed');
        return;
      }
      const data = await res.json();
      const created = data.result?.created_ids?.length ?? 0;
      const modified = data.result?.modified_ids?.length ?? 0;
      const cancelled = data.result?.cancelled_ids?.length ?? 0;
      const parts = [
        created > 0 && `${created} created`,
        modified > 0 && `${modified} modified`,
        cancelled > 0 && `${cancelled} cancelled`,
      ].filter(Boolean);
      const planId = pendingPlan.plan.plan_id;
      toast.success(parts.join(' · ') || 'Applied', {
        action: {
          label: 'Undo',
          onClick: async () => {
            await fetch(`/api/courtsheet/undo`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ plan_id: planId }),
            });
            onApplied?.();
            toast('Undone');
          },
        },
        duration: 8000,
      });
      setPendingPlan(null);
      onApplied?.();
    },
    [pendingPlan, onApplied]
  );

  return (
    <>
      {/* Inline chat panel (anchored above the dock when open) */}
      {open && history.length > 0 && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-30 w-[92vw] max-w-md max-h-[40vh] overflow-y-auto rounded-2xl bg-[#001820]/95 backdrop-blur-md border border-white/10 shadow-2xl p-3 space-y-2">
          {history.slice(-6).map((m, i) => (
            <div
              key={i}
              className={[
                'rounded-xl px-3 py-2 text-sm whitespace-pre-wrap',
                m.role === 'user'
                  ? 'bg-[#D3FB52]/10 border border-[#D3FB52]/15 text-white/90 ml-6'
                  : 'bg-white/[0.04] border border-white/[0.06] text-white/80 mr-6',
              ].join(' ')}
            >
              {m.content}
            </div>
          ))}
        </div>
      )}

      {/* The dock */}
      <div className="cs-dock px-3 py-2 flex items-center gap-2 min-w-[280px] sm:min-w-[420px]">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={[
            'h-7 w-7 rounded-full flex items-center justify-center transition',
            open
              ? 'bg-[#D3FB52]/20 text-[#D3FB52]'
              : 'bg-white/[0.06] text-white/60 hover:bg-white/10',
          ].join(' ')}
          aria-label="Toggle chat history"
        >
          {open ? <X size={13} /> : <MessageSquare size={13} />}
        </button>
        <Sparkles size={14} className="text-[#D3FB52] shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={listening ? 'Listening…' : 'Book courts 1–6 weekdays 8–12 for camp…'}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          disabled={submitting}
          className="flex-1 bg-transparent text-sm text-white placeholder:text-white/30 focus:outline-none disabled:opacity-50"
        />
        <kbd className="hidden sm:inline text-[10px] uppercase tracking-widest text-white/30 border border-white/10 rounded px-1.5 py-0.5">
          ⌘K
        </kbd>
        <button
          type="button"
          onClick={startVoice}
          className={[
            'h-8 w-8 rounded-full flex items-center justify-center transition',
            listening
              ? 'bg-[#D3FB52] text-[#001820] cs-mic-listening'
              : 'bg-white/[0.06] text-white/70 hover:bg-white/10',
          ].join(' ')}
          aria-label={listening ? 'Listening' : 'Voice command'}
        >
          <Mic size={14} />
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!draft.trim() || submitting}
          className="h-8 w-8 rounded-full flex items-center justify-center bg-[#D3FB52] text-[#001820] hover:bg-[#c5f035] disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Send"
        >
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={13} />}
        </button>
      </div>

      <PlanPreview
        open={!!pendingPlan}
        plan={pendingPlan?.plan ?? null}
        summary={pendingPlan?.summary ?? null}
        aiMessage={pendingPlan?.aiMessage ?? null}
        onClose={() => setPendingPlan(null)}
        onConfirm={confirmPlan}
      />
    </>
  );
}

'use client';

/**
 * Floating AI command dock — the visible home of the AI assistant.
 *
 * Phase 2 ships the DOCK only. The Phase 4 brain wires the parse/plan/
 * preview loop into the existing /api/courtsheet/reservations/plan and
 * /apply routes. For now, click → toast "AI command coming in Phase 4".
 */

import { useEffect, useRef, useState } from 'react';
import { Mic, Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function CommandDock() {
  const [listening, setListening] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K focuses the dock.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onSubmit = () => {
    if (!draft.trim()) return;
    toast('AI command lands in Phase 4', {
      description: `"${draft.trim()}" will be parsed into a Plan you preview before applying.`,
    });
    setDraft('');
  };

  const startVoice = () => {
    const SR =
      (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SR) {
      toast.error('Voice not supported in this browser yet — try Chrome or Edge.');
      return;
    }
    const rec = new SR();
    rec.lang = 'en-US';
    rec.continuous = false;
    rec.interimResults = true;
    rec.onstart = () => setListening(true);
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    rec.onresult = (ev: any) => {
      const transcript = Array.from(ev.results)
        .map((r: any) => r[0].transcript)
        .join(' ');
      setDraft(transcript);
    };
    rec.start();
  };

  return (
    <div className="cs-dock px-3 py-2 flex items-center gap-2 min-w-[280px] sm:min-w-[420px]">
      <Sparkles size={14} className="text-[#D3FB52] shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Book courts 1–6 weekdays 8–12 for camp…"
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit();
        }}
        className="flex-1 bg-transparent text-sm text-white placeholder:text-white/30 focus:outline-none"
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
        title="Voice command"
      >
        {listening ? <Loader2 size={14} className="animate-spin" /> : <Mic size={14} />}
      </button>
    </div>
  );
}

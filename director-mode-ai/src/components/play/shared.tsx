'use client';

import Link from 'next/link';

/** Brand colors from the signed-out homepage (Kevin's design). */
export const C = { paper: '#f4f5ef', ink: '#103c32', muted: '#6a7b71', lime: '#d4ff49', line: '#173b2c22', card: '#ffffff' };

export function PlayHeader({ right }: { right?: React.ReactNode }) {
  return (
    <header className="mx-auto flex h-16 w-full max-w-xl items-center justify-between px-5">
      <Link href="/" className="inline-flex items-center gap-2 text-[19px] font-semibold tracking-tight" style={{ color: C.ink }}>
        <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className="h-7 w-7">
          <rect width="32" height="32" rx="11" fill={C.lime} />
          <path d="M18 7 10 17h7l-3 8 9-12h-7l2-6Z" stroke={C.ink} strokeWidth="1.7" strokeLinejoin="round" />
        </svg>
        CourtConnect
      </Link>
      {right}
    </header>
  );
}

/* ---------- keys this browser holds: host key / player key per event ---------- */
const STORE = 'cc_play_keys_v1';
export function getKey(code: string): string | null {
  try { return (JSON.parse(localStorage.getItem(STORE) || '{}') as Record<string, string>)[code] ?? null; } catch { return null; }
}
export function setKey(code: string, key: string) {
  try { const m = JSON.parse(localStorage.getItem(STORE) || '{}'); m[code] = key; localStorage.setItem(STORE, JSON.stringify(m)); } catch { /* private mode */ }
}
const NAME = 'cc_play_name_v1';
export const getName = () => { try { return localStorage.getItem(NAME) || ''; } catch { return ''; } };
export const setName = (n: string) => { try { localStorage.setItem(NAME, n); } catch { /* */ } };

/** Browser speech-to-text where it exists (Chrome, Safari). Returns a stop function. */
export function listen(onText: (t: string, final: boolean) => void, onEnd: () => void): (() => void) | null {
  const W = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
  const Rec = W.SpeechRecognition ?? W.webkitSpeechRecognition;
  if (!Rec) return null;
  const r = new Rec();
  r.lang = 'en-US'; r.interimResults = true; r.continuous = false;
  r.onresult = (e) => {
    let t = ''; let fin = false;
    for (let i = 0; i < e.results.length; i++) { t += e.results[i][0].transcript; if (e.results[i].isFinal) fin = true; }
    onText(t, fin);
  };
  r.onend = onEnd; r.onerror = onEnd;
  r.start();
  return () => r.stop();
}
type SpeechRec = {
  lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void;
  onend: () => void; onerror: () => void;
};
export const canListen = () => typeof window !== 'undefined' && !!((window as unknown as Record<string, unknown>).SpeechRecognition || (window as unknown as Record<string, unknown>).webkitSpeechRecognition);

export async function api<T = unknown>(url: string, body?: unknown, key?: string | null): Promise<T> {
  const r = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { 'x-play-key': key } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || 'Something went wrong');
  return j as T;
}

'use client';

/**
 * MaintenanceMode — small shared pieces: API calls, phone photo upload, the
 * bottom sheet, pills.
 *
 * NOTE ON INPUTS: globals.css styles bare form controls outside Tailwind's
 * layers and wins the cascade, so on this dark UI every input sets its colour
 * and background inline (FIELD) or it renders white-on-white.
 */
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Camera, Loader2, X } from 'lucide-react';
import { shrinkImage } from '@/lib/captain/shrinkImage';
import type { Priority } from '@/lib/maintenance/types';

export const ACCENT = '#f59e0b';
export const FIELD: CSSProperties = { color: '#ffffff', backgroundColor: '#001820' };
export const fieldCls =
  'w-full rounded-xl border border-white/10 px-3 py-3 text-[15px] placeholder-white/30 focus:border-amber-400/60 focus:outline-none';

/** JSON fetch that turns a platform error (plain-text 413/504) into words. */
export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(j.error || `Something went wrong (${res.status}).`);
  return j as T;
}

export type Photo = { path: string; url: string };

/** Shrink on the phone (a raw photo is 3–8 MB), then upload. */
export async function uploadPhoto(file: File): Promise<Photo> {
  const { data, mediaType } = await shrinkImage(file);
  const blob = await (await fetch(`data:${mediaType};base64,${data}`)).blob();
  const fd = new FormData();
  fd.append('file', new File([blob], 'photo.jpg', { type: mediaType }));
  const res = await fetch('/api/maintenance/upload', { method: 'POST', body: fd });
  const j = (await res.json().catch(() => ({}))) as { error?: string; path?: string; url?: string };
  if (!res.ok || !j.path || !j.url) throw new Error(j.error || 'The photo did not upload.');
  return { path: j.path, url: j.url };
}

export function PhotoPicker({
  value,
  onChange,
  label = 'Add a photo',
}: {
  value: Photo | null;
  onChange: (p: Photo | null) => void;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setBusy(true);
          setErr(null);
          try {
            onChange(await uploadPhoto(f));
          } catch (x) {
            setErr((x as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
      {value ? (
        <div className="relative inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value.url} alt="" className="h-28 w-28 rounded-xl object-cover" />
          <button
            type="button"
            onClick={() => onChange(null)}
            className="absolute -right-2 -top-2 rounded-full bg-black/80 p-1 text-white"
            aria-label="Remove photo"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          className="inline-flex min-h-[48px] items-center gap-2 rounded-xl border border-dashed border-white/20 px-4 text-[14px] text-white/70 hover:border-amber-400/50 hover:text-white disabled:opacity-60"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
          {busy ? 'Uploading…' : label}
        </button>
      )}
      {err && <p className="mt-1 text-[13px] text-red-300">{err}</p>}
    </div>
  );
}

/** Bottom sheet on phones, centred panel on desktop. */
export function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-white/10 bg-[#002838] p-5 pb-8 sm:max-w-lg sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="text-[17px] font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-white/50 hover:text-white" aria-label="Close">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const PRIORITY_STYLE: Record<Priority, string> = {
  urgent: 'bg-red-500/20 text-red-300 border-red-400/40',
  high: 'bg-orange-500/15 text-orange-300 border-orange-400/40',
  normal: 'bg-white/5 text-white/70 border-white/15',
  low: 'bg-white/5 text-white/45 border-white/10',
};

export function PriorityPill({ p }: { p: Priority }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11.5px] font-semibold uppercase tracking-wide ${PRIORITY_STYLE[p]}`}>
      {p}
    </span>
  );
}

export function Pill({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'amber' | 'red' | 'green' }) {
  const cls =
    tone === 'amber'
      ? 'border-amber-400/40 bg-amber-400/10 text-amber-200'
      : tone === 'red'
        ? 'border-red-400/40 bg-red-500/15 text-red-200'
        : tone === 'green'
          ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200'
          : 'border-white/15 bg-white/5 text-white/60';
  return <span className={`rounded-full border px-2 py-0.5 text-[12px] ${cls}`}>{children}</span>;
}

export const primaryBtn =
  'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-amber-400 px-5 text-[15px] font-semibold text-[#1a1200] transition hover:brightness-95 disabled:opacity-50';
export const ghostBtn =
  'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-white/15 px-4 text-[15px] text-white/80 transition hover:border-white/35 hover:text-white disabled:opacity-50';

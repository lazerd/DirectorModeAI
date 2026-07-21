'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Trophy, Plus, X, Copy, Check, ExternalLink, Loader2 } from 'lucide-react';

type Hub = { slug: string; title: string; count: number };

/**
 * Action-bar control to put a tournament into a shareable HUB (a page that lists
 * every event sharing a hub_slug, with Standings/Enter/Draw + QR posters). If
 * the event is already in a hub, links to it; otherwise lets the director create
 * a new hub or add the event to one they already own.
 */
export default function HubButton({
  eventId,
  hubSlug: initialSlug,
  hubTitle: initialTitle,
  eventName,
}: {
  eventId: string;
  hubSlug: string | null;
  hubTitle: string | null;
  eventName: string;
}) {
  const [slug, setSlug] = useState(initialSlug);
  const [title, setTitle] = useState(initialTitle);
  const [open, setOpen] = useState(false);
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [name, setName] = useState(eventName.replace(/\s*[—·].*$/, '').trim() || eventName);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const hubHref = slug === 'season-end-2026' ? '/tournaments/season-end' : `/tournaments/hub/${slug}`;

  const openMenu = async () => {
    setOpen(true);
    setErr(null);
    try {
      const r = await fetch('/api/tournaments/hub');
      const d = await r.json();
      if (r.ok) setHubs(d.hubs || []);
    } catch {
      /* non-fatal */
    }
  };

  const submit = async (mode: 'create' | 'join', joinSlug?: string) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/tournaments/hub', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'create' ? { eventId, mode, title: name } : { eventId, mode, slug: joinSlug }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed');
      setSlug(d.slug);
      setTitle(d.title);
      setOpen(false);
    } catch (e: any) {
      setErr(e.message || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  if (slug) {
    return (
      <span className="inline-flex items-center gap-1 flex-shrink-0">
        <Link
          href={hubHref}
          target="_blank"
          className="inline-flex items-center gap-1 px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold"
          title={title || 'Tournament Hub'}
        >
          <Trophy size={12} />
          Hub
          <ExternalLink size={11} />
        </Link>
        <button
          onClick={() => {
            const origin = typeof window !== 'undefined' ? window.location.origin : '';
            navigator.clipboard.writeText(`${origin}${hubHref}`);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="inline-flex items-center gap-1 px-2 py-1 bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 rounded text-xs font-semibold"
          title="Copy hub link"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </span>
    );
  }

  return (
    <span className="relative inline-block flex-shrink-0">
      <button
        onClick={openMenu}
        className="inline-flex items-center gap-1 px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold"
      >
        <Plus size={12} />
        Add to Hub
      </button>

      {open && (
        <div className="absolute z-30 mt-1 right-0 w-72 bg-white border border-gray-200 rounded-xl shadow-xl p-3 text-left">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-bold text-gray-900">Tournament Hub</div>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700">
              <X size={14} />
            </button>
          </div>

          <label className="block text-[11px] font-semibold text-gray-600 mb-1">Create a new hub</label>
          <div className="flex gap-1.5 mb-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Hub name"
              className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm"
              style={{ color: '#111827' }}
            />
            <button
              onClick={() => submit('create')}
              disabled={busy || !name.trim()}
              className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold disabled:opacity-50"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : 'Create'}
            </button>
          </div>

          {hubs.length > 0 && (
            <>
              <label className="block text-[11px] font-semibold text-gray-600 mb-1">Or add to an existing hub</label>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {hubs.map((h) => (
                  <button
                    key={h.slug}
                    onClick={() => submit('join', h.slug)}
                    disabled={busy}
                    className="w-full flex items-center justify-between px-2 py-1.5 border border-gray-200 rounded hover:border-blue-400 hover:bg-blue-50 text-sm disabled:opacity-50"
                    style={{ color: '#111827' }}
                  >
                    <span className="truncate">{h.title}</span>
                    <span className="text-[10px] text-gray-500 flex-shrink-0 ml-2">{h.count} event{h.count === 1 ? '' : 's'}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {err && <div className="mt-2 text-xs text-red-600">{err}</div>}
        </div>
      )}
    </span>
  );
}

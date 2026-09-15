'use client';

/**
 * Snippets, allowed sites and a live preview for embedding a club's pages.
 *
 * Written for the person who maintains a club website as a volunteer, not for
 * a developer: every step is "copy this, paste it there", the Wild Apricot
 * steps are spelled out click by click, and the one setting (which websites
 * may show the pages) is optional — the snippets work before it is touched.
 */

import { useCallback, useEffect, useState } from 'react';
import { APP_URL } from '@/lib/appUrl';
import { embedSnippet, embedSrc, type EmbedSection } from '@/lib/clubSite/embed';

type Club = { id: string; slug: string; name: string };

const SECTIONS: { key: EmbedSection | 'all'; label: string; blurb: string }[] = [
  { key: 'programs', label: 'Classes & sign-up', blurb: 'Every class with its dates, and the sign-up form.' },
  { key: 'calendar', label: 'Event calendar', blurb: 'Your published year of events, month by month.' },
  { key: 'courts', label: 'Court time & booking', blurb: 'Hours, rates and the Book a court button.' },
  { key: 'about', label: 'About the club', blurb: 'Your About text, on its own.' },
  { key: 'team', label: 'Your team', blurb: 'Pros and staff, with photos and bios.' },
  { key: 'all', label: 'Whole club page', blurb: 'Everything on your club page, without its header.' },
];

export default function EmbedSettings() {
  const [club, setClub] = useState<Club | null>(null);
  const [origins, setOrigins] = useState('');
  const [savedOrigins, setSavedOrigins] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<EmbedSection | 'all'>('programs');
  const [copied, setCopied] = useState<string | null>(null);
  const [previewHeight, setPreviewHeight] = useState(520);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/club-site', { cache: 'no-store' });
      const j = (await res.json().catch(() => ({}))) as {
        site?: { embed_origins?: string[] };
        club?: Club;
        error?: string;
      };
      if (!res.ok) setError(j.error || 'Could not load your site.');
      else {
        setClub(j.club ?? null);
        const list = j.site?.embed_origins ?? [];
        setSavedOrigins(list);
        setOrigins(list.join('\n'));
      }
      setLoading(false);
    })();
  }, []);

  // The preview is one of our own pages, so it posts its height like any
  // embed would; listening here shows the director the real auto-resize.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data as { type?: string; height?: number };
      if (d?.type === 'clubmode:resize' && typeof d.height === 'number') {
        setPreviewHeight(Math.max(200, Math.min(d.height, 4000)));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const saveOrigins = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const list = origins
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch('/api/club-site', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embed_origins: list }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        site?: { embed_origins?: string[] };
      };
      if (!res.ok) {
        setError(j.error || 'Could not save.');
        return;
      }
      const saved = j.site?.embed_origins ?? [];
      setSavedOrigins(saved);
      setOrigins(saved.join('\n'));
      // The framing header is cached for about a minute per club.
      setNotice(
        saved.length
          ? 'Saved. Give it a minute, then reload your website.'
          : 'Saved. Any website can show your pages.',
      );
    } finally {
      setBusy(false);
    }
  }, [origins]);

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  }

  if (loading) return <p className="text-white/40">Loading…</p>;
  if (!club) return <p className="text-red-300">{error || 'Could not load your club.'}</p>;

  const field =
    'w-full rounded-lg border border-white/10 bg-[#001820] px-3 py-2 text-sm focus:border-[#D3FB52]/50 focus:outline-none';

  return (
    <div className="space-y-10">
      {/* --------------------------------------------------- Wild Apricot */}
      <section className="rounded-2xl border border-[#D3FB52]/20 bg-[#D3FB52]/[0.04] p-5">
        <h2 className="font-display text-xl text-white">How to add it</h2>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-white/70">
          <li>Pick what you want to show below, and press <b>Copy</b>.</li>
          <li>Open the page of your website where it should appear.</li>
          <li>Add a block that takes HTML or &quot;embed code&quot;, and paste.</li>
        </ol>
        <div className="mt-4 rounded-xl border border-white/10 bg-[#001820] p-4 text-sm">
          <div className="font-semibold text-white">For Wild Apricot</div>
          <p className="mt-1 text-white/60">
            Website → Pages → open your page → add a <b>Custom HTML</b> gadget → paste → Save.
            If the box looks empty while you are editing, save and look at the page the way a
            visitor would.
          </p>
          <div className="mt-3 font-semibold text-white">Squarespace, Wix or WordPress</div>
          <p className="mt-1 text-white/60">
            Add an <b>Embed</b>, <b>Code</b> or <b>Custom HTML</b> block and paste into it.
          </p>
        </div>
      </section>

      {/* -------------------------------------------------------- snippets */}
      <section>
        <h2 className="font-display text-xl text-white">What to show</h2>
        <p className="mt-1 text-sm text-white/45">
          One box per page of your website. Each one grows to fit, so there is no scrollbar
          inside your page. Sign-in for members opens in its own window — browsers do not allow it
          inside another site.
        </p>
        <div className="mt-4 space-y-3">
          {SECTIONS.map((s) => {
            const code = embedSnippet({
              appUrl: APP_URL,
              slug: club.slug,
              section: s.key,
              title: `${s.label} — ${club.name}`,
            });
            return (
              <div key={s.key} className="rounded-xl border border-white/[0.08] bg-[#002838] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-white">{s.label}</div>
                    <div className="text-sm text-white/45">{s.blurb}</div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setPreview(s.key)}
                      className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                        preview === s.key
                          ? 'border-[#D3FB52]/50 text-[#D3FB52]'
                          : 'border-white/15 text-white/70 hover:text-white'
                      }`}
                    >
                      Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => copy(s.key, code)}
                      className="rounded-lg bg-[#D3FB52] px-3 py-1.5 text-sm font-semibold text-[#001820]"
                    >
                      {copied === s.key ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
                <pre className="mt-3 overflow-x-auto whitespace-pre rounded-lg border border-white/10 bg-[#001820] p-3 text-xs text-white/70">
                  {code}
                </pre>
              </div>
            );
          })}
        </div>
      </section>

      {/* --------------------------------------------------------- preview */}
      <section>
        <h2 className="font-display text-xl text-white">Preview</h2>
        <p className="mt-1 text-sm text-white/45">
          {SECTIONS.find((s) => s.key === preview)?.label} — exactly what appears inside your page.
        </p>
        <div className="mt-4 overflow-hidden rounded-xl border border-white/10 bg-white">
          <iframe
            key={preview}
            // An empty base keeps the preview same-origin on any deploy.
            src={embedSrc('', club.slug, preview)}
            title="Embed preview"
            style={{ width: '100%', height: previewHeight, border: 0, display: 'block' }}
          />
        </div>
      </section>

      {/* ---------------------------------------------------- allowed sites */}
      <section>
        <h2 className="font-display text-xl text-white">Which websites may show these</h2>
        <p className="mt-1 max-w-2xl text-sm text-white/45">
          Optional. Leave it empty and any website can show your public pages — they are the same
          pages anyone can already open. Add your own addresses, one per line, and only those
          sites can. On Wild Apricot, add both your own address and your
          <span className="whitespace-nowrap"> …wildapricot.org</span> one.
        </p>
        <textarea
          rows={3}
          value={origins}
          onChange={(e) => setOrigins(e.target.value)}
          placeholder={'www.yourclub.com\nyourclub.wildapricot.org'}
          style={{ color: '#ffffff' }}
          className={`${field} mt-3 max-w-xl font-mono`}
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={saveOrigins}
            disabled={busy}
            className="rounded-lg bg-[#D3FB52] px-4 py-2 text-sm font-semibold text-[#001820] disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save websites'}
          </button>
          <span className="text-sm text-white/50">
            {savedOrigins.length
              ? `Only ${savedOrigins.length === 1 ? 'this site' : `these ${savedOrigins.length} sites`} (and ClubMode)`
              : 'Any website'}
          </span>
        </div>
        {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
        {notice && <p className="mt-2 text-sm text-[#D3FB52]">{notice}</p>}
      </section>
    </div>
  );
}

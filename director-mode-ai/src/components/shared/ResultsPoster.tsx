'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import type { Sponsor } from '@/config/sponsors';
import SponsorWordmark from '@/components/quads/SponsorWordmark';
import { QrCode, Printer, Download, Copy, X, Check } from 'lucide-react';

// One button, every program. Tap it on any MixerMode, TournamentMode or
// LeagueMode event and get a print-ready poster with a big QR code — tape it to
// the fence and players scan straight to the live public results/standings.
//
// Self-contained: generates the QR client-side, prints only the poster (a
// scoped print stylesheet hides the rest of the app), and works off whatever
// public URL the calling surface hands it. No per-program setup.

export default function ResultsPoster({
  url,
  title,
  subtitle,
  tagline = 'Scan for live results & standings',
  clubName,
  buttonLabel = 'Poster',
  variant = 'light',
  sponsor = null,
}: {
  /** Absolute or path-only public URL. Path-only is resolved against the origin. */
  url: string;
  /** Big line on the poster — the event or league name. */
  title: string;
  /** Optional second line: division, venue, date. */
  subtitle?: string;
  tagline?: string;
  clubName?: string;
  buttonLabel?: string;
  /** 'light' = bordered button for dark bars; 'dark' = filled for light UIs. */
  variant?: 'light' | 'dark';
  /** A sponsored event prints in the sponsor's colors (config/sponsors.ts). */
  sponsor?: Sponsor | null;
}) {
  const [open, setOpen] = useState(false);

  const btnStyle =
    variant === 'dark'
      ? { background: '#0f172a', color: '#fff', border: '1px solid #0f172a' }
      : { background: 'transparent', color: 'inherit', border: '1px solid currentColor' };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium"
        style={btnStyle}
        title="Printable QR poster to the public results page"
      >
        <QrCode className="w-4 h-4" /> {buttonLabel}
      </button>
      {open && (
        <PosterModal
          url={url}
          title={title}
          subtitle={subtitle}
          tagline={tagline}
          clubName={clubName}
          sponsor={sponsor}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function PosterModal({
  url, title, subtitle, tagline, clubName, sponsor, onClose,
}: {
  url: string; title: string; subtitle?: string; tagline: string; clubName?: string; sponsor: Sponsor | null; onClose: () => void;
}) {
  const [qr, setQr] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const fullUrl = useRef<string>(url);

  useEffect(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const abs = /^https?:\/\//.test(url) ? url : `${origin}${url.startsWith('/') ? '' : '/'}${url}`;
    fullUrl.current = abs;
    QRCode.toDataURL(abs, { width: 1000, margin: 1, errorCorrectionLevel: 'M' })
      .then(setQr)
      .catch(() => setQr(''));
  }, [url]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const prettyUrl = fullUrl.current.replace(/^https?:\/\//, '');

  async function copy() {
    try {
      await navigator.clipboard.writeText(fullUrl.current);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked — the QR still works */ }
  }

  function download() {
    if (!qr) return;
    const a = document.createElement('a');
    a.href = qr;
    a.download = `${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-qr.png`;
    a.click();
  }

  /*
   * Portaled to <body> so printing can drop the whole app with display:none.
   * The old version hid the app with visibility:hidden, which still lays it
   * out: a 3-page admin screen printed 3 pages, and Chrome repeats a
   * position:fixed overlay on every one of them -- three QR codes.
   */
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="rp-overlay fixed inset-0 z-[100] flex items-center justify-center p-4"
         style={{ background: 'rgba(2,12,18,.72)' }} onClick={onClose}>
      <div className="rp-sheet relative w-full max-w-md rounded-2xl overflow-hidden"
           style={{ background: '#fff', color: '#0f172a' }} onClick={(e) => e.stopPropagation()}>

        {/* toolbar — hidden when printing */}
        <div className="rp-tools flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: '#e5e7eb' }}>
          <span className="text-sm font-semibold text-slate-500 mr-auto">Results poster</span>
          <button onClick={copy} className="p-2 rounded-lg hover:bg-slate-100" title="Copy link">
            {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4 text-slate-600" />}
          </button>
          <button onClick={download} disabled={!qr} className="p-2 rounded-lg hover:bg-slate-100 disabled:opacity-40" title="Download QR">
            <Download className="w-4 h-4 text-slate-600" />
          </button>
          <button onClick={() => window.print()} className="px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5"
                  style={{ background: '#0f172a', color: '#fff' }}>
            <Printer className="w-4 h-4" /> Print
          </button>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100" title="Close">
            <X className="w-4 h-4 text-slate-600" />
          </button>
        </div>

        {/* the poster itself — this is what prints */}
        {sponsor ? (
          <SponsorPoster sponsor={sponsor} title={title} subtitle={subtitle} qr={qr} prettyUrl={prettyUrl} />
        ) : (
        <div className="rp-poster px-8 py-10 text-center">
          {clubName && (
            <div className="text-xs font-bold tracking-[0.18em] uppercase text-slate-400 mb-4">{clubName}</div>
          )}
          <h1 className="text-3xl font-extrabold leading-tight text-slate-900" style={{ textWrap: 'balance' }}>{title}</h1>
          {subtitle && <p className="text-slate-500 mt-1 text-lg">{subtitle}</p>}

          <div className="my-7 inline-block p-3 rounded-2xl" style={{ background: '#fff', border: '3px solid #0f172a' }}>
            {qr
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={qr} alt="Scan for results" className="w-56 h-56 block" />
              : <div className="w-56 h-56 grid place-items-center text-slate-300 text-sm">generating…</div>}
          </div>

          <p className="text-xl font-bold text-slate-900">{tagline}</p>
          <p className="text-sm text-slate-400 mt-1 break-all">{prettyUrl}</p>

          <div className="mt-6 text-[11px] tracking-widest uppercase text-slate-300 font-semibold">
            Powered by ClubMode
          </div>
        </div>
        )}
      </div>

      {/* Print only the poster, on exactly one page. */}
      <style>{`
        @media print {
          @page { size: letter portrait; margin: 0; }
          html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
          body > *:not(.rp-overlay) { display: none !important; }
          .rp-overlay { position: static !important; display: block !important; padding: 0 !important; background: #fff !important; }
          .rp-sheet { position: static !important; max-width: none !important; width: 100% !important; box-shadow: none !important; border-radius: 0 !important; }
          .rp-tools { display: none !important; }
          .rp-poster { padding-top: 12vh !important; break-inside: avoid; }
          /* Pinned to the page corner: with the app gone the document is one
             page, so a fixed element prints exactly once. */
          .rp-sponsor { position: fixed !important; top: 0; left: 0; width: 8.5in !important; height: 11in !important; box-sizing: border-box; overflow: hidden; }
          .rp-sponsor * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .rp-sponsor .rp-qr { width: 4.1in !important; height: 4.1in !important; }
          .rp-sponsor .rp-title { font-size: 38pt !important; }
          .rp-sponsor .rp-scan { font-size: 26pt !important; }
          .rp-sponsor .rp-steps { font-size: 14pt !important; max-width: 6.5in !important; }
          .rp-sponsor .rp-prize { max-width: 6.5in !important; font-size: 15pt !important; }
        }
      `}</style>
    </div>,
    document.body,
  );
}

/**
 * The sponsor's version: their palette and wordmark, one big QR, and three
 * plain steps a 10-year-old can follow. Built for a letter page taped to the
 * fence; the on-screen preview is the same layout, smaller.
 */
function SponsorPoster({
  sponsor, title, subtitle, qr, prettyUrl,
}: {
  sponsor: Sponsor; title: string; subtitle?: string; qr: string; prettyUrl: string;
}) {
  const c = sponsor.colors;
  const rounded = 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Segoe UI", system-ui, sans-serif';
  const dots = ['#FF6E0C', '#DA1884', '#FFC0DC', '#FFB066', '#8B5A2B'];
  return (
    <div className="rp-sponsor relative flex flex-col text-center" style={{ background: c.cream, color: c.ink, fontFamily: rounded }}>
      {/* sprinkle band */}
      <div className="h-3 w-full" style={{ background: `repeating-linear-gradient(90deg, ${c.primary} 0 28px, ${c.secondary} 28px 56px)` }} />

      <div className="px-6 pt-5 pb-4" style={{ background: c.primary, color: '#fff' }}>
        <div className="text-[11px] font-bold uppercase tracking-[0.25em] opacity-90">{sponsor.presentedBy}</div>
        <div className="mt-1"><SponsorWordmark sponsor={sponsor} size="lg" onDark /></div>
      </div>

      <div className="flex-1 flex flex-col items-center px-6 pt-5 pb-4">
        <h1 className="rp-title text-3xl font-extrabold leading-[1.05]" style={{ color: c.ink, textWrap: 'balance' as never, letterSpacing: '-0.02em' }}>
          {title}
        </h1>
        {subtitle && <p className="mt-2 text-base font-semibold" style={{ color: c.secondary }}>{subtitle}</p>}

        <p className="rp-scan mt-4 text-2xl font-extrabold" style={{ color: c.primary }}>
          Scan for live scores &amp; standings
        </p>

        <div className="relative mt-3">
          {/* donut ring around the code */}
          <div className="rounded-[28px] p-3" style={{ background: c.surface, border: `10px solid ${c.primary}`, boxShadow: `0 0 0 6px ${c.secondary}` }}>
            {qr
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={qr} alt="Scan for live scores and standings" className="rp-qr w-52 h-52 block" />
              : <div className="rp-qr w-52 h-52 grid place-items-center text-sm" style={{ color: c.primary }}>generating…</div>}
          </div>
          {dots.map((d, i) => (
            <span key={i} aria-hidden className="absolute rounded-full" style={{
              background: d, width: 10, height: 4, transform: `rotate(${i * 37}deg)`,
              top: ['-14px', '18%', '96%', '44%', '-10px'][i], left: ['12%', '-18px', '30%', 'calc(100% + 10px)', '82%'][i],
            }} />
          ))}
        </div>

        <ol className="rp-steps mt-5 grid grid-cols-3 gap-3 text-sm font-bold w-full max-w-md">
          {[['📱', 'Point your camera here'], ['🔎', 'Find your name'], ['🏆', 'Follow your quad live']].map(([e, t], i) => (
            <li key={t} className="rounded-2xl px-2 py-3" style={{ background: c.surface, border: `2px solid ${i === 1 ? c.secondary : c.primary}` }}>
              <div className="text-2xl leading-none">{e}</div>
              <div className="mt-1 leading-tight">{t}</div>
            </li>
          ))}
        </ol>

        <div className="rp-prize mt-4 rounded-2xl px-4 py-3 w-full max-w-md" style={{ background: c.secondary, color: '#fff' }}>
          <div className="text-base font-extrabold">🍩 {sponsor.prize.headline}</div>
        </div>

        <p className="mt-3 text-xs font-semibold break-all" style={{ color: c.ink, opacity: 0.6 }}>{prettyUrl}</p>
      </div>

      <div className="px-6 pb-3 text-[9px] leading-snug" style={{ color: c.ink, opacity: 0.55 }}>
        {sponsor.legal}
      </div>
      <div className="h-3 w-full" style={{ background: `repeating-linear-gradient(90deg, ${c.secondary} 0 28px, ${c.primary} 28px 56px)` }} />
    </div>
  );
}

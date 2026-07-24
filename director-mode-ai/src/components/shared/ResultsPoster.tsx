'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
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
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function PosterModal({
  url, title, subtitle, tagline, clubName, onClose,
}: {
  url: string; title: string; subtitle?: string; tagline: string; clubName?: string; onClose: () => void;
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

  return (
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
      </div>

      {/* Print only the poster; hide the app and the toolbar. */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .rp-overlay, .rp-overlay * { visibility: visible !important; }
          .rp-overlay { position: fixed; inset: 0; background: #fff !important; padding: 0 !important; display: block !important; }
          .rp-sheet { position: absolute; inset: 0; max-width: none !important; box-shadow: none !important; border-radius: 0 !important; }
          .rp-tools { display: none !important; }
          .rp-poster { padding-top: 12vh !important; }
        }
      `}</style>
    </div>
  );
}

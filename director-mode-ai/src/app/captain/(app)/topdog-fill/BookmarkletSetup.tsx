'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The draggable "Fill from ClubMode" bookmark.
 *
 * The bookmark is a tiny LOADER that fetches public/topdog-fill.js fresh every
 * time it is tapped. The first version inlined the whole script, and a bookmark
 * freezes whatever code it was dragged with: on 9/16 Darrin kept getting the
 * original "ClubMode doesn't have their names" message after the opponent-name
 * fill had shipped. TopDog sends no Content-Security-Policy, so the load works.
 *
 * React refuses javascript: hrefs in JSX, so the link's href is set on the DOM
 * node directly.
 */
function loaderFor(origin: string): string {
  const src =
    "(function(){var s=document.createElement('script');" +
    `s.src='${origin}/topdog-fill.js?v='+Date.now();` +
    "s.onerror=function(){alert('Could not load Fill from ClubMode. Check your connection and try again.')};" +
    'document.body.appendChild(s)})()';
  return 'javascript:' + encodeURIComponent(src);
}

export default function BookmarkletSetup() {
  const linkRef = useRef<HTMLAnchorElement>(null);
  const [href, setHref] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setHref(loaderFor(window.location.origin));
  }, []);

  useEffect(() => {
    if (href && linkRef.current) linkRef.current.setAttribute('href', href);
  }, [href]);

  const copy = async () => {
    if (!href) return;
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="mt-6 rounded-xl border border-white/[0.08] bg-[#002838] p-5">
      <h2 className="text-white font-semibold">One-time setup</h2>
      <p className="mt-2 text-sm text-white/60">
        <b className="text-white">On a computer:</b> show your bookmarks bar (Ctrl+Shift+B, or
        ⌘+Shift+B on a Mac), then drag this button onto it. It always runs the latest version, so you
        only ever do this once.
      </p>
      <p className="mt-2 text-sm text-amber-200/80">
        Dragged it before September 16? Delete that old bookmark and drag this one. The old one
        can&apos;t fill the other team&apos;s players.
      </p>
      <div className="mt-4">
        <a
          ref={linkRef}
          onClick={(e) => e.preventDefault()}
          draggable
          className={`inline-block px-5 py-3 rounded-xl font-semibold text-sm bg-[#D3FB52] text-[#001820] cursor-grab ${href ? '' : 'opacity-50'}`}
        >
          Fill from ClubMode
        </a>
        <span className="ml-3 text-xs text-white/40">← drag me to your bookmarks bar</span>
      </div>
      <p className="mt-5 text-sm text-white/60">
        <b className="text-white">On a phone or tablet:</b> bookmark any page, then edit that
        bookmark: name it <i>Fill from ClubMode</i> and replace its address with the code below.
      </p>
      <button
        onClick={copy}
        disabled={!href}
        className="mt-3 px-4 py-2.5 rounded-xl font-semibold text-sm border border-white/10 text-white/70 hover:text-white hover:border-white/25 disabled:opacity-50"
      >
        {copied ? 'Copied ✓' : 'Copy the bookmark code'}
      </button>
    </div>
  );
}

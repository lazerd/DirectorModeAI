'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The draggable "Fill from ClubMode" bookmark.
 *
 * The code is public/topdog-fill.js, fetched rather than inlined so there is one
 * copy of it. React refuses javascript: hrefs in JSX, so the link's href is set
 * on the DOM node directly.
 */
export default function BookmarkletSetup() {
  const linkRef = useRef<HTMLAnchorElement>(null);
  const [href, setHref] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch('/topdog-fill.js', { cache: 'no-store' })
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then((src) => setHref('javascript:' + encodeURIComponent(src)))
      .catch(() => setFailed(true));
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
      {failed ? (
        <p className="mt-2 text-sm text-red-300">Couldn&apos;t load the bookmark. Refresh the page.</p>
      ) : (
        <>
          <p className="mt-2 text-sm text-white/60">
            <b className="text-white">On a computer:</b> show your bookmarks bar
            (Ctrl+Shift+B, or ⌘+Shift+B on a Mac), then drag this button onto it.
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
        </>
      )}
    </div>
  );
}

'use client';

/**
 * What an embedded club page does to live inside someone else's website.
 *
 * Rendered only when the page is `?embed=1`. Renders nothing visible; three
 * jobs, all of which exist because the page is in an <iframe> on a site we do
 * not control:
 *
 *  1. HEIGHT. An iframe does not grow with its content, so the club would
 *     have to guess a height and get either a scrollbar-in-a-scrollbar or a
 *     gap. This posts the real height to the parent, where /embed.js sizes the
 *     frame. It measures the BODY rather than the document: a document is
 *     never shorter than its viewport, so measuring it could only ever grow
 *     the frame and never shrink it back when an accordion closes.
 *
 *  2. LINKS. Every club page links with plain `/c/<slug>/…` paths. Followed
 *     as-is inside the frame they would drop embed mode, and the club's own
 *     header and our footer would appear inside their website. So a click on
 *     a club page is rewritten to keep `embed=1`; a click on anything that
 *     needs a sign-in, or on another site (checkout included), opens a new
 *     window — see embedLinkAction for why sign-in cannot happen in the frame.
 *
 *  3. LAYOUT. Full-height pages (`min-h-screen`) would pin the frame to at
 *     least the height it was first given; that is released here.
 *
 * Clicks are caught on `window` in the CAPTURE phase so this runs before
 * next/link's own handler, which would otherwise soft-navigate to the path
 * without embed=1. Hrefs and targets are also written onto the anchors
 * themselves, so a long-press "open in new tab" and the status bar agree with
 * what a click does.
 */

import { useEffect } from 'react';
import { embedLinkAction } from '@/lib/clubSite/embed';

const MESSAGE_TYPE = 'clubmode:resize';

const EMBED_CSS = [
  'html,body{background:transparent}',
  '.min-h-screen{min-height:0!important}',
].join('\n');

export default function EmbedRuntime() {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-clubmode-embed', '1');

    const style = document.createElement('style');
    style.setAttribute('data-clubmode-embed', '1');
    style.textContent = EMBED_CSS;
    document.head.appendChild(style);

    /* ------------------------------------------------------------ height */
    let last = 0;
    let frame = 0;
    const post = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const body = document.body;
        const rect = body.getBoundingClientRect();
        const cs = getComputedStyle(body);
        const height = Math.ceil(
          rect.height + parseFloat(cs.marginTop || '0') + parseFloat(cs.marginBottom || '0'),
        );
        if (height === last || height <= 0) return;
        last = height;
        // '*' is deliberate: the page cannot know which site framed it (that
        // is the point of an embed), and the message carries a number, not
        // anything a stranger could use.
        window.parent?.postMessage({ type: MESSAGE_TYPE, height, href: location.href }, '*');
      });
    };
    const ro = new ResizeObserver(post);
    ro.observe(document.body);
    window.addEventListener('load', post);
    post();

    /* ------------------------------------------------------------- links */
    const decorate = (a: HTMLAnchorElement) => {
      const href = a.getAttribute('href');
      if (!href || a.dataset.embedChecked === href) return;
      const action = embedLinkAction(href, location.href);
      if (action.kind === 'frame') {
        a.setAttribute('href', action.href);
      } else if (action.kind === 'new-window') {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
        if (!a.title) a.title = 'Opens in a new window';
      }
      a.dataset.embedChecked = a.getAttribute('href') || '';
    };
    const decorateAll = () => document.querySelectorAll('a[href]').forEach((a) => decorate(a as HTMLAnchorElement));
    decorateAll();
    const mo = new MutationObserver(decorateAll);
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['href'] });

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.hasAttribute('download')) return;
      const action = embedLinkAction(a.getAttribute('href') || '', location.href);
      if (action.kind === 'leave') return;
      e.preventDefault();
      e.stopPropagation();
      if (action.kind === 'frame') {
        // A full load rather than a client-side push: the next page's server
        // render has to see embed=1 to leave the chrome off.
        window.location.assign(action.href);
      } else {
        window.open(new URL(a.getAttribute('href') || '', location.href).toString(), '_blank', 'noopener');
      }
    };
    window.addEventListener('click', onClick, true);

    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener('load', post);
      window.removeEventListener('click', onClick, true);
      cancelAnimationFrame(frame);
      style.remove();
      root.removeAttribute('data-clubmode-embed');
    };
  }, []);

  return null;
}

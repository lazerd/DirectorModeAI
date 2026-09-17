'use client';

/**
 * DrawSheetZoom — zoom and pan for a draw sheet.
 *
 * A 16-player compass has to fit the page, which leaves the names small on a
 * desktop screen. The first attempt at this was a magnifying lens, and it was
 * wrong: you don't read a draw sheet through a porthole. You want a REGION of
 * it — a whole direction, a whole quadrant — at a size you can read.
 *
 * So this zooms the sheet itself and lets you move around it: +/- buttons, a
 * Fit button, and click-drag to pan once you're in past the edges.
 *
 * The sheet is scaled with a CSS transform rather than by growing its width,
 * because the sheets cap their own maxWidth at natural size and a transform
 * ignores that. A sizer div behind it carries the scaled dimensions so the
 * scrollbars are honest.
 *
 * Controls are hidden when printing and the sheet prints unscaled.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const STEPS = [1, 1.25, 1.5, 2, 2.5, 3, 4];

export default function DrawSheetZoom({ children }: { children: React.ReactNode }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [z, setZ] = useState(1);
  const [base, setBase] = useState<{ w: number; h: number } | null>(null);

  // Natural (unscaled) size. A CSS transform doesn't affect layout, so these
  // stay put as z changes and the sizer can be derived from them.
  useEffect(() => {
    const vp = viewportRef.current;
    const inner = innerRef.current;
    if (!vp || !inner) return;
    const measure = () => setBase({ w: vp.clientWidth, h: inner.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(vp);
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  /** Zoom about the middle of what you're currently looking at. */
  const zoomTo = useCallback((next: number) => {
    const vp = viewportRef.current;
    setZ((prev) => {
      if (vp) {
        const cx = (vp.scrollLeft + vp.clientWidth / 2) / prev;
        const cy = (vp.scrollTop + vp.clientHeight / 2) / prev;
        requestAnimationFrame(() => {
          vp.scrollLeft = cx * next - vp.clientWidth / 2;
          vp.scrollTop = cy * next - vp.clientHeight / 2;
        });
      }
      return next;
    });
  }, []);

  const step = (dir: 1 | -1) => {
    const i = STEPS.indexOf(z);
    const at = i === -1 ? STEPS.findIndex((s) => s >= z) : i;
    const next = STEPS[Math.min(STEPS.length - 1, Math.max(0, at + dir))];
    if (next !== z) zoomTo(next);
  };

  // Click-drag to pan. Mouse and pen only — touch already scrolls natively.
  const drag = useRef<{ x: number; y: number; l: number; t: number } | null>(null);
  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' || z === 1) return;
    const vp = viewportRef.current;
    if (!vp) return;
    drag.current = { x: e.clientX, y: e.clientY, l: vp.scrollLeft, t: vp.scrollTop };
    vp.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const vp = viewportRef.current;
    if (!d || !vp) return;
    vp.scrollLeft = d.l - (e.clientX - d.x);
    vp.scrollTop = d.t - (e.clientY - d.y);
  };
  const onUp = (e: React.PointerEvent) => {
    drag.current = null;
    viewportRef.current?.releasePointerCapture?.(e.pointerId);
  };

  const btn =
    'w-7 h-7 inline-flex items-center justify-center rounded border border-gray-300 ' +
    'text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-transparent leading-none';

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-gray-500 print:hidden">
        <button type="button" className={btn} onClick={() => step(-1)} disabled={z <= STEPS[0]} aria-label="Zoom out">−</button>
        <span className="w-11 text-center tabular-nums text-gray-700">{Math.round(z * 100)}%</span>
        <button type="button" className={btn} onClick={() => step(1)} disabled={z >= STEPS[STEPS.length - 1]} aria-label="Zoom in">+</button>
        <button
          type="button"
          className="ml-1 px-2 h-7 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          onClick={() => zoomTo(1)}
          disabled={z === 1}
        >
          Fit
        </button>
        {z > 1 && <span className="ml-1 text-gray-400">Drag to move around the draw.</span>}
      </div>

      <div
        ref={viewportRef}
        className="overflow-auto print:overflow-visible"
        style={{ maxHeight: z > 1 ? '78vh' : undefined, cursor: z > 1 ? 'grab' : undefined }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {/* carries the scaled footprint so the scrollbars match what you see */}
        <div
          style={base ? { width: base.w * z, height: base.h * z } : undefined}
          className="print:!w-auto print:!h-auto"
        >
          <div
            ref={innerRef}
            style={{ transformOrigin: '0 0', transform: z === 1 ? undefined : `scale(${z})`, width: base?.w }}
            className="print:!transform-none print:!w-auto"
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

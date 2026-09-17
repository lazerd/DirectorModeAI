'use client';

/**
 * DrawSheetLens — a magnifier over a draw sheet.
 *
 * A 16-player compass has to fit the page, which makes the names and scores
 * small. Rather than trade the whole-sheet view away for pan-and-zoom, this
 * keeps the sheet exactly as it is and lets you hold a lens over it.
 *
 * It works by rendering the SAME children a second time, scaled up, inside a
 * round clipped window that follows the pointer — so it needs to know nothing
 * about the SVG's internals and adds no props to the sheet itself. The sheet
 * stays hookless and server-renderable; only this wrapper is a client
 * component.
 *
 * Mouse and pen only. A phone or tablet already pinch-zooms the page, and
 * claiming the touch stream here would take that away to replace it with
 * something worse — so on touch this does nothing and native zoom stands.
 *
 * Hidden when printing: on paper you already have the full-size sheet.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

type Point = { x: number; y: number };

export default function DrawSheetLens({
  children,
  zoom = 2.4,
  radius = 116,
}: {
  children: React.ReactNode;
  /** How much to magnify under the lens. */
  zoom?: number;
  /** Lens radius in CSS pixels. */
  radius?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<Point | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [on, setOn] = useState(true);

  // The magnified copy is laid out at the host's exact size, so a point in the
  // copy maps to the same point in the original before scaling.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const move = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Leave touch alone so pinch-zoom keeps working on phones and tablets.
    if (!on || e.pointerType === 'touch') return;
    const r = e.currentTarget.getBoundingClientRect();
    setAt({ x: e.clientX - r.left, y: e.clientY - r.top });
  }, [on]);

  const showLens = on && at && size;

  return (
    <div className="relative">
      <div className="mb-1 flex items-center gap-3 text-[11px] text-gray-500 print:hidden">
        <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={on}
            onChange={(e) => { setOn(e.target.checked); if (!e.target.checked) setAt(null); }}
            className="accent-gray-700"
          />
          Magnifier
        </label>
        {on && (
          <span className="text-gray-400">
            Hover the draw to enlarge it. <span className="hidden sm:inline">On a phone or tablet, pinch to zoom as usual.</span>
          </span>
        )}
      </div>

      <div
        ref={hostRef}
        className="relative"
        style={{ cursor: on ? 'crosshair' : undefined }}
        onPointerMove={move}
        onPointerLeave={() => setAt(null)}
      >
        {children}

        {showLens && (
          <div
            aria-hidden
            className="print:hidden"
            style={{
              position: 'absolute',
              left: at!.x - radius,
              top: at!.y - radius,
              width: radius * 2,
              height: radius * 2,
              borderRadius: '50%',
              overflow: 'hidden',
              border: '2px solid rgba(17,24,39,0.75)',
              boxShadow: '0 8px 24px rgba(15,23,42,0.28)',
              background: '#fff',
              pointerEvents: 'none',
              zIndex: 20,
            }}
          >
            <div
              style={{
                position: 'absolute',
                width: size!.w,
                height: size!.h,
                transformOrigin: '0 0',
                transform: `scale(${zoom})`,
                left: radius - at!.x * zoom,
                top: radius - at!.y * zoom,
              }}
            >
              {children}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

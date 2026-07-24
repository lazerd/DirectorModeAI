'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Scroll container that makes wide draws actually navigable:
 *   - click-and-drag to pan (grab cursor, like a map)
 *   - mouse wheel scrolls horizontally when the content is wider than tall
 *   - fade shadows on each edge that has more content off-screen
 *   - native touch scrolling on mobile (untouched)
 *
 * Progressive enhancement: server-renders as a plain scroll box, so it's safe
 * inside the server-rendered print route. On print it drops the max-height and
 * shadows so the whole draw lays out for paper.
 */
export default function PanScroll({
  children,
  className = '',
  maxHeightClass = 'max-h-[80vh]',
}: {
  children: React.ReactNode;
  className?: string;
  maxHeightClass?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [edge, setEdge] = useState({ l: false, r: false, t: false, b: false });

  const recomputeEdges = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdge({
      l: el.scrollLeft > 2,
      r: el.scrollLeft < el.scrollWidth - el.clientWidth - 2,
      t: el.scrollTop > 2,
      b: el.scrollTop < el.scrollHeight - el.clientHeight - 2,
    });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    recomputeEdges();
    const ro = new ResizeObserver(recomputeEdges);
    ro.observe(el);

    // Non-passive wheel: turn a vertical wheel into horizontal panning when the
    // strip is wider than tall (the compass / bracket case) and can't scroll
    // vertically — so a normal mouse wheel walks the bracket left↔right.
    const onWheel = (e: WheelEvent) => {
      const canX = el.scrollWidth > el.clientWidth + 2;
      const canY = el.scrollHeight > el.clientHeight + 2;
      if (canX && !canY && e.deltaY !== 0 && Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        el.scrollLeft += e.deltaY;
        e.preventDefault();
        recomputeEdges();
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', onWheel);
    };
  }, [recomputeEdges]);

  // Drag-to-pan (mouse only; touch keeps native momentum scrolling).
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const el = ref.current;
    if (!el) return;
    // Don't hijack drags that start on interactive controls.
    if ((e.target as HTMLElement).closest('a,button,input,select,textarea')) return;
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, moved: false };
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = drag.current;
      const el = ref.current;
      if (!d || !el) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) > 3) {
        d.moved = true;
        setDragging(true);
      }
      if (d.moved) {
        el.scrollLeft = d.left - dx;
        el.scrollTop = d.top - dy;
        recomputeEdges();
        e.preventDefault();
      }
    };
    const onUp = () => {
      drag.current = null;
      setDragging(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [recomputeEdges]);

  const fade =
    'pointer-events-none absolute z-10 from-black/10 to-transparent transition-opacity duration-200 print:hidden';

  return (
    <div className="relative">
      <div
        ref={ref}
        onScroll={recomputeEdges}
        onMouseDown={onMouseDown}
        className={`overflow-auto overscroll-contain ${maxHeightClass} ${dragging ? 'cursor-grabbing select-none' : 'cursor-grab'} print:overflow-visible print:max-h-none print:cursor-auto ${className}`}
      >
        {children}
      </div>
      <div className={`${fade} left-0 top-0 bottom-0 w-8 bg-gradient-to-r ${edge.l ? 'opacity-100' : 'opacity-0'}`} />
      <div className={`${fade} right-0 top-0 bottom-0 w-8 bg-gradient-to-l ${edge.r ? 'opacity-100' : 'opacity-0'}`} />
      <div className={`${fade} left-0 right-0 top-0 h-6 bg-gradient-to-b ${edge.t ? 'opacity-100' : 'opacity-0'}`} />
      <div className={`${fade} left-0 right-0 bottom-0 h-6 bg-gradient-to-t ${edge.b ? 'opacity-100' : 'opacity-0'}`} />
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';

/**
 * Types a word, holds it, deletes it, types the next — the rotating keyword in
 * the homepage headline ("Run your ___ from one screen").
 *
 * Pass a module-level array: a new array identity on every render restarts the
 * timer. Screen readers get the first word once, not a stream of keystrokes.
 */
export default function RotatingWord({ words, className = '' }: { words: readonly string[]; className?: string }) {
  const [i, setI] = useState(0);
  const [n, setN] = useState(words[0].length);
  const [deleting, setDeleting] = useState(false);
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    setReduce(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);

  useEffect(() => {
    const word = words[i];
    let t: ReturnType<typeof setTimeout> | undefined;
    if (reduce) {
      // No typing, just a calm swap.
      t = setTimeout(() => {
        const next = (i + 1) % words.length;
        setI(next);
        setN(words[next].length);
      }, 2600);
    } else if (!deleting && n === word.length) {
      t = setTimeout(() => setDeleting(true), 1900);
    } else if (deleting && n === 0) {
      setDeleting(false);
      setI((i + 1) % words.length);
    } else {
      t = setTimeout(() => setN(n + (deleting ? -1 : 1)), deleting ? 36 : 72);
    }
    return () => clearTimeout(t);
  }, [i, n, deleting, reduce, words]);

  return (
    <span className="whitespace-nowrap">
      <span aria-hidden className={className}>{words[i].slice(0, n)}</span>
      <span aria-hidden className="hm-caret" />
      <span className="sr-only">{words[0]}</span>
    </span>
  );
}

'use client';

/**
 * Where the game is: a location field that suggests real places (ones other
 * games used, then the map), a small map once it's pinned, and directions.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, MapPin, Navigation } from 'lucide-react';
import { directionsUrl, type PlayDraft } from '@/lib/play/core';
import { C } from './shared';

export type Place = Pick<PlayDraft, 'location' | 'place_address' | 'place_lat' | 'place_lng'>;
type Hit = { name: string; address: string | null; lat: number | null; lng: number | null; source: 'used' | 'map'; games?: number };

export function PlacePicker({ value, onChange, dark = true, autoFocus }: { value: Place; onChange: (p: Place) => void; dark?: boolean; autoFocus?: boolean }) {
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const typed = useRef(false); // only search after the person types, not on a prefilled value
  const seq = useRef(0);
  const q = value.location ?? '';
  const pinned = value.place_lat != null;

  // The sentence named a place ("…at Heather Farm"): offer the best map match as one tap.
  const [guess, setGuess] = useState<Hit | null>(null);
  const guessedFor = useRef('');
  useEffect(() => {
    if (pinned || typed.current || q.trim().length < 3 || guessedFor.current === q) return;
    guessedFor.current = q;
    fetch(`/api/p/places?q=${encodeURIComponent(q.trim())}`).then((r) => r.json()).then((j: { places?: Hit[] }) => {
      const h = (j.places ?? []).find((x) => x.lat != null);
      if (h && guessedFor.current === q) setGuess(h);
    }).catch(() => {});
  }, [q, pinned]);

  useEffect(() => {
    if (!typed.current || q.trim().length < 3) { setHits([]); return; }
    const n = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/p/places?q=${encodeURIComponent(q.trim())}`);
        const j = (await r.json()) as { places?: Hit[] };
        if (n === seq.current) { setHits(j.places ?? []); setActive(-1); }
      } catch { /* offline: plain text still works */ } finally { if (n === seq.current) setLoading(false); }
    }, 280);
    return () => clearTimeout(t);
  }, [q]);

  const pick = (h: Hit) => {
    typed.current = false; setGuess(null);
    onChange({ location: h.name, place_address: h.address, place_lat: h.lat, place_lng: h.lng });
    setOpen(false); setHits([]);
  };

  const fg = dark ? '#fff' : C.ink, sub = dark ? '#9fb3a6' : C.muted;
  return (
    <div className="relative w-full min-w-0">
      <div className="flex items-center gap-2">
        <input
          value={q} autoFocus={autoFocus} aria-label="Where" placeholder="Where? (courts, park, club)" autoComplete="off"
          onChange={(e) => { typed.current = true; setGuess(null); setOpen(true); onChange({ location: e.target.value, place_address: null, place_lat: null, place_lng: null }); }}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 180)}
          onKeyDown={(e) => {
            if (!open || !hits.length) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(hits.length - 1, a + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(hits[active]); }
            else if (e.key === 'Escape') setOpen(false);
          }}
          className="w-full bg-transparent outline-none" style={{ color: fg }}
        />
        {loading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" style={{ color: sub }} /> : pinned ? <Check className="h-4 w-4 shrink-0" style={{ color: C.lime }} aria-label="Pinned on the map" /> : null}
      </div>
      {value.place_address && <div className="mt-0.5 truncate text-[12px]" style={{ color: sub }}>{value.place_address}</div>}
      {guess && !pinned && (
        <button type="button" onClick={() => pick(guess)} className="mt-1.5 flex max-w-full items-center gap-1.5 rounded-full px-3 py-1.5 text-left text-[12px] font-semibold"
          style={{ background: dark ? '#ffffff1f' : '#fff', color: fg }}>
          <MapPin className="h-3.5 w-3.5 shrink-0" style={{ color: dark ? C.lime : C.ink }} />
          <span className="truncate">Pin it: {guess.name}{guess.address ? ` · ${guess.address}` : ''}</span>
        </button>
      )}
      {open && hits.length > 0 && (
        <ul role="listbox" className="absolute inset-x-0 top-full z-30 mt-2 max-h-72 overflow-y-auto rounded-2xl bg-white p-1 text-left shadow-2xl" style={{ color: C.ink }}>
          {hits.map((h, i) => (
            <li key={`${h.name}|${h.address}|${i}`} role="option" aria-selected={i === active}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(h)}
                className="flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left" style={i === active ? { background: '#eef1e8' } : {}}>
                <MapPin className="mt-0.5 h-4 w-4 shrink-0" style={{ color: h.source === 'used' ? '#2e7d32' : C.muted }} />
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-semibold">{h.name}</span>
                  <span className="block truncate text-[12px]" style={{ color: C.muted }}>
                    {h.source === 'used' ? `${h.games && h.games > 1 ? `${h.games} games here` : 'Used for a game here'}${h.address ? ' · ' + h.address : ''}` : h.address ?? 'On the map'}
                  </span>
                </span>
              </button>
            </li>
          ))}
          <li className="px-3 pb-1.5 pt-1 text-[10px]" style={{ color: '#8a978d' }}>Map data © OpenStreetMap contributors</li>
        </ul>
      )}
    </div>
  );
}

/** A small map of the pin, plus Directions. Free (OpenStreetMap), no key. */
export function PlaceMap({ e, className = '' }: { e: Place; className?: string }) {
  if (e.place_lat == null || e.place_lng == null) return null;
  const lat = e.place_lat, lng = e.place_lng, d = 0.0045;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${lng - d * 1.4},${lat - d},${lng + d * 1.4},${lat + d}&layer=mapnik&marker=${lat},${lng}`;
  return (
    <section className={`overflow-hidden rounded-3xl bg-white shadow-sm ${className}`}>
      <iframe title={`Map: ${e.location ?? 'the courts'}`} src={src} loading="lazy" className="block h-48 w-full border-0" referrerPolicy="no-referrer" />
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold" style={{ color: C.ink }}>{e.location}</div>
          {e.place_address && <div className="truncate text-[12px]" style={{ color: C.muted }}>{e.place_address}</div>}
        </div>
        <Directions e={e} />
      </div>
    </section>
  );
}

/** Opens the phone's own maps app: Apple Maps on iPhone and Mac, Google everywhere else. */
export function Directions({ e, light }: { e: Place; light?: boolean }) {
  const [apple, setApple] = useState(false);
  useEffect(() => { setApple(/iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)); }, []);
  const href = directionsUrl(e, apple);
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-semibold"
      style={light ? { background: '#ffffff24', color: '#fff' } : { background: C.lime, color: C.ink }}>
      <Navigation className="h-3.5 w-3.5" />Directions
    </a>
  );
}

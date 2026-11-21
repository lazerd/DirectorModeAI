'use client';

/**
 * /play/near: open games near you that need a player, at your level.
 * Starts from the visitor's rough area (IP); "Use my location" sharpens it.
 * Below the list: "tell me when a game near me needs one" (email).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, Check, Crosshair, Loader2, MapPin, Users } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import type { Map as LMap, LayerGroup } from 'leaflet';
import { SPORT_LABEL, whenLine, type Sport } from '@/lib/play/core';
import { getMyLevel, levelLabel, setMyLevel } from '@/lib/play/levels';
import { LevelChips } from './Levels';
import { C, PlayHeader } from './shared';

type Game = {
  code: string; title: string; sport: Sport; starts_at: string | null; when_text: string | null; location: string | null; place_address: string | null;
  lat: number; lng: number; miles: number; level: string | null; level_min: number | null; level_max: number | null; fits: boolean; spots: number | null; in: number; open: number; host: string | null;
};
type Origin = { lat: number; lng: number; source: 'device' | 'ip'; label: string | null };
const SPORTS: Sport[] = ['tennis', 'pickleball', 'padel'];
const SPORT_KEY = 'cc_play_sport_v1';

export default function NearClient() {
  const [sport, setSport] = useState<Sport>('tennis');
  const [level, setLevel] = useState<number | null>(null);
  const [radius, setRadius] = useState(15);
  const [onlyMine, setOnlyMine] = useState(true);
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [device, setDevice] = useState<{ lat: number; lng: number } | null>(null);
  const [games, setGames] = useState<Game[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [locErr, setLocErr] = useState('');
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    const s = (() => { try { return localStorage.getItem(SPORT_KEY); } catch { return null; } })();
    const q = new URLSearchParams(location.search).get('sport');
    const pick = (SPORTS as string[]).includes(q ?? '') ? (q as Sport) : (SPORTS as string[]).includes(s ?? '') ? (s as Sport) : 'tennis';
    setSport(pick); setLevel(getMyLevel(pick));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const u = new URLSearchParams({ sport, radius: String(radius) });
    if (device) { u.set('lat', String(device.lat)); u.set('lng', String(device.lng)); }
    if (level != null) u.set('level', String(level));
    try {
      const r = await fetch(`/api/p/near?${u}`, { cache: 'no-store' });
      const j = (await r.json()) as { origin: Origin | null; games: Game[] };
      setOrigin(j.origin); setGames(j.games);
    } catch { setGames([]); }
    setLoading(false);
  }, [sport, radius, device, level]);
  useEffect(() => { load(); }, [load]);

  const chooseSport = (s: Sport) => { setSport(s); setLevel(getMyLevel(s)); try { localStorage.setItem(SPORT_KEY, s); } catch { /* */ } };
  const chooseLevel = (v: number | null) => { setLevel(v); setMyLevel(sport, v); if (v != null) setOnlyMine(true); };
  const locate = () => {
    if (!navigator.geolocation) { setLocErr('This browser can’t share a location.'); return; }
    setLocating(true); setLocErr('');
    navigator.geolocation.getCurrentPosition(
      (p) => { setDevice({ lat: p.coords.latitude, lng: p.coords.longitude }); setLocating(false); },
      () => { setLocErr('Location is off. Showing games near your area instead.'); setLocating(false); },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  };

  const shown = (games ?? []).filter((g) => !onlyMine || level == null || g.fits);
  const hidden = (games?.length ?? 0) - shown.length;

  return (
    <div className="min-h-screen pb-16" style={{ background: C.paper, color: C.ink }}>
      <PlayHeader right={<Link href="/play/new" className="rounded-full px-3 py-1.5 text-[13px] font-semibold" style={{ background: C.lime }}>Start a game</Link>} />
      <main className="mx-auto w-full max-w-xl px-4">
        <h1 className="mt-2 text-[34px] font-medium leading-[1.05] tracking-[-1px]">Games near you that need a player.</h1>
        <p className="mt-2 text-[15px]" style={{ color: C.muted }}>Open spots at your level. Tap in, no app, no account.</p>

        <section className="mt-5 rounded-3xl bg-white p-4 shadow-sm">
          <div className="flex gap-1 rounded-full p-1" style={{ background: '#eef1e8' }}>
            {SPORTS.map((s) => (
              <button key={s} onClick={() => chooseSport(s)} className="flex-1 rounded-full py-2 text-[14px] font-semibold" style={sport === s ? { background: C.ink, color: '#fff' } : {}}>{SPORT_LABEL[s]}</button>
            ))}
          </div>
          <div className="mt-3 text-[13px] font-semibold">My level</div>
          <div className="mt-1.5"><LevelChips sport={sport} value={level} onChange={chooseLevel} /></div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
            <span className="flex items-center gap-1" style={{ color: C.muted }}><MapPin className="h-3.5 w-3.5" />
              {origin ? (origin.source === 'device' ? 'Near you' : `Near ${origin.label ?? 'your area'}`) : 'Finding your area…'}
            </span>
            <select value={radius} onChange={(x) => setRadius(Number(x.target.value))} aria-label="Distance" className="rounded-lg px-2 py-1 font-semibold" style={{ background: '#eef1e8' }}>
              {[5, 10, 15, 25, 50].map((r) => <option key={r} value={r}>within {r} mi</option>)}
            </select>
            {!device && (
              <button onClick={locate} className="flex items-center gap-1 rounded-lg px-2 py-1 font-semibold" style={{ background: '#eef1e8' }}>
                {locating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crosshair className="h-3.5 w-3.5" />}Use my location
              </button>
            )}
          </div>
          {locErr && <p className="mt-2 text-[12px]" style={{ color: '#b4432f' }}>{locErr}</p>}
        </section>

        <NearMap origin={origin} games={shown} radius={radius} />

        <section className="mt-4 grid gap-3">
          {loading && games == null ? (
            <div className="flex items-center justify-center gap-2 py-10 text-[14px]" style={{ color: C.muted }}><Loader2 className="h-4 w-4 animate-spin" />Looking around…</div>
          ) : shown.length ? shown.map((g) => <GameRow key={g.code} g={g} level={level} />) : (
            <div className="rounded-3xl bg-white p-6 text-center shadow-sm">
              <div className="text-[18px] font-semibold">{games?.length ? 'Nothing at your level right now.' : `No open ${SPORT_LABEL[sport].toLowerCase()} games nearby yet.`}</div>
              <p className="mt-1 text-[14px]" style={{ color: C.muted }}>Start one and it shows up here for everyone near you, or get an email when one does.</p>
              <Link href={`/play/new?q=${encodeURIComponent(`${SPORT_LABEL[sport]} doubles Saturday 9am${level != null ? `, ${levelLabel({ min: level, max: level }, sport, false)}` : ''}`)}`}
                className="mt-4 inline-block rounded-2xl px-5 py-3 text-[15px] font-semibold" style={{ background: C.lime }}>Start a game</Link>
            </div>
          )}
          {hidden > 0 && (
            <button onClick={() => setOnlyMine(false)} className="text-[13px] font-semibold underline underline-offset-4" style={{ color: C.muted }}>
              Show {hidden} more outside my level
            </button>
          )}
        </section>

        <AlertBox sport={sport} level={level} radius={radius} origin={origin} />
      </main>
    </div>
  );
}

function GameRow({ g, level }: { g: Game; level: number | null }) {
  const when = whenLine({ starts_at: g.starts_at, when_text: g.when_text } as never);
  const range = { min: g.level_min, max: g.level_max };
  return (
    <Link href={`/p/${g.code}`} className="block rounded-3xl bg-white p-4 shadow-sm transition-transform active:scale-[.99]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold uppercase tracking-[1.2px]" style={{ color: C.muted }}>{when ?? 'Time TBD'}</div>
          <div className="mt-0.5 truncate text-[18px] font-semibold">{g.title}</div>
          <div className="mt-0.5 truncate text-[14px]" style={{ color: C.muted }}>{g.location} · {g.miles < 1 ? '<1' : g.miles.toFixed(1)} mi</div>
        </div>
        <div className="shrink-0 rounded-2xl px-3 py-2 text-center" style={{ background: C.lime }}>
          <div className="text-[20px] font-bold leading-none">{g.spots == null ? 'All' : g.open}</div>
          <div className="text-[10px] font-semibold uppercase">{g.spots == null ? 'welcome' : g.open === 1 ? 'spot' : 'spots'}</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] font-semibold">
        <span className="rounded-full px-2.5 py-1" style={level != null && g.fits ? { background: C.ink, color: C.lime } : { background: '#eef1e8' }}>
          {level != null && g.fits && <Check className="mr-1 inline h-3 w-3" />}{levelLabel(range, g.sport)}
        </span>
        <span className="flex items-center gap-1 rounded-full px-2.5 py-1" style={{ background: '#eef1e8' }}><Users className="h-3 w-3" />{g.spots == null ? `${g.in} in` : `${g.in} of ${g.spots} in`}</span>
        {g.host && <span style={{ color: C.muted }}>Hosted by {g.host.split(' ')[0]}</span>}
      </div>
    </Link>
  );
}

/** Pins for every game, you in the middle. Leaflet + OpenStreetMap tiles: free, no key. */
function NearMap({ origin, games, radius }: { origin: Origin | null; games: Game[]; radius: number }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  useEffect(() => {
    let off = false;
    (async () => {
      if (!origin || !el.current) return;
      const L = (await import('leaflet')).default;
      if (off) return;
      if (!map.current) {
        map.current = L.map(el.current, { zoomControl: false, attributionControl: true, scrollWheelZoom: false }).setView([origin.lat, origin.lng], 11);
        map.current.attributionControl.setPrefix(false);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap contributors' }).addTo(map.current);
        layer.current = L.layerGroup().addTo(map.current);
      }
      const m = map.current, lg = layer.current!;
      lg.clearLayers();
      L.circleMarker([origin.lat, origin.lng], { radius: 7, color: '#fff', weight: 3, fillColor: '#2f7cf6', fillOpacity: 1 }).addTo(lg);
      const pts: [number, number][] = [[origin.lat, origin.lng]];
      for (const g of games) {
        const icon = L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15], html: `<div style="width:30px;height:30px;border-radius:999px;background:#d4ff49;border:2px solid #103c32;display:grid;place-items:center;font:700 13px system-ui;color:#103c32">${g.open}</div>` });
        L.marker([g.lat, g.lng], { icon }).addTo(lg).bindPopup(`<b>${g.title.replace(/</g, '&lt;')}</b><br>${(g.location ?? '').replace(/</g, '&lt;')}<br><a href="/p/${g.code}">Open the game ›</a>`);
        pts.push([g.lat, g.lng]);
      }
      if (pts.length > 1) m.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 14 });
      else m.setView([origin.lat, origin.lng], radius <= 5 ? 13 : radius <= 15 ? 11 : 10);
    })();
    return () => { off = true; };
  }, [origin, games, radius]);
  useEffect(() => () => { map.current?.remove(); map.current = null; }, []);
  if (!origin) return null;
  return <div ref={el} className="mt-4 h-56 w-full overflow-hidden rounded-3xl shadow-sm" style={{ background: '#e7ebe2', zIndex: 0 }} />;
}

function AlertBox({ sport, level, radius, origin }: { sport: Sport; level: number | null; radius: number; origin: Origin | null }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'' | 'busy' | 'done' | string>('');
  if (!origin) return null;
  const go = async () => {
    setState('busy');
    try {
      const r = await fetch('/api/p/alerts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, sport, level, lat: origin.lat, lng: origin.lng, radius, label: origin.label }) });
      const j = await r.json().catch(() => ({}));
      setState(r.ok ? 'done' : (j as { error?: string }).error || 'Something went wrong');
    } catch { setState('Something went wrong'); }
  };
  return (
    <section className="mt-6 rounded-3xl p-5 text-white shadow-lg" style={{ background: C.ink }}>
      <div className="flex items-center gap-2 text-[17px] font-semibold"><Bell className="h-5 w-5" style={{ color: C.lime }} />Tell me when a game needs one</div>
      <p className="mt-1 text-[14px]" style={{ color: '#bccdbb' }}>
        {SPORT_LABEL[sport]}, {level != null ? levelLabel({ min: level, max: level }, sport) : 'any level'}, within {radius} mi. One email when a nearby game has a spot. Stop anytime.
      </p>
      {state === 'done' ? (
        <div className="mt-3 flex items-center gap-2 rounded-2xl p-3 text-[15px] font-semibold" style={{ background: C.lime, color: C.ink }}><Check className="h-5 w-5" />You’re on the list.</div>
      ) : (
        <form className="mt-3 flex gap-2" onSubmit={(x) => { x.preventDefault(); if (email.trim()) go(); }}>
          <input type="email" value={email} onChange={(x) => setEmail(x.target.value)} placeholder="you@email.com" aria-label="Email" className="min-w-0 flex-1 rounded-xl px-3 py-3 text-[16px] outline-none" style={{ color: C.ink }} />
          <button disabled={state === 'busy' || !email.trim()} className="rounded-xl px-4 text-[15px] font-semibold disabled:opacity-60" style={{ background: C.lime, color: C.ink }}>
            {state === 'busy' ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Alert me'}
          </button>
        </form>
      )}
      {state && state !== 'busy' && state !== 'done' && <p className="mt-2 text-[13px]" style={{ color: '#ffb4a2' }}>{state}</p>}
    </section>
  );
}

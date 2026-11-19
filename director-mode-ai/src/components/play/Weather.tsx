'use client';

/**
 * Game-time weather for a pinned game (Open-Meteo: free, no key), and the
 * nudge a host needs when rain is coming: "Rain check: move it".
 */
import { useEffect, useState } from 'react';
import { CloudRain } from 'lucide-react';
import type { PlayEvent } from '@/lib/play/core';
import { C } from './shared';

export type Forecast = { temp: number; rain: number; wind: number; code: number; precipIn: number };

const SKY: [number[], string, string][] = [
  [[0], '☀️', 'Clear'], [[1], '🌤️', 'Mostly clear'], [[2], '⛅', 'Partly cloudy'], [[3], '☁️', 'Cloudy'],
  [[45, 48], '🌫️', 'Fog'], [[51, 53, 55, 56, 57], '🌦️', 'Drizzle'], [[61, 63, 66, 80, 81], '🌧️', 'Rain'],
  [[65, 67, 82], '🌧️', 'Heavy rain'], [[71, 73, 75, 77, 85, 86], '🌨️', 'Snow'], [[95, 96, 99], '⛈️', 'Thunderstorms'],
];
const sky = (c: number) => SKY.find(([cs]) => cs.includes(c)) ?? [[c], '🌡️', 'Weather'];

export function useForecast(e: Pick<PlayEvent, 'place_lat' | 'place_lng' | 'starts_at' | 'status'>): Forecast | null {
  const [f, setF] = useState<Forecast | null>(null);
  const lat = e.place_lat, lng = e.place_lng, at = e.starts_at;
  useEffect(() => {
    setF(null);
    if (lat == null || lng == null || !at || e.status === 'done') return;
    const t = Date.parse(at), now = Date.now();
    if (t < now - 3 * 3600e3 || t > now + 15 * 864e5) return; // forecasts go ~16 days out
    const day = new Date(t).toISOString().slice(0, 10);
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=GMT&start_date=${day}&end_date=${day}`;
    let off = false;
    fetch(u).then((r) => r.json()).then((j: { hourly?: { time: string[]; temperature_2m: number[]; precipitation_probability: (number | null)[]; precipitation: number[]; weather_code: number[]; wind_speed_10m: number[] } }) => {
      const h = j.hourly; if (!h || off) return;
      // the game's first two hours: worst rain chance, typical temperature
      const idx = h.time.map((x, i) => ({ i, dt: Date.parse(x + 'Z') - t })).filter((x) => x.dt >= -30 * 60e3 && x.dt < 2 * 3600e3).map((x) => x.i);
      const at0 = idx[0] ?? h.time.map((x, i) => ({ i, d: Math.abs(Date.parse(x + 'Z') - t) })).sort((a, b) => a.d - b.d)[0]?.i;
      if (at0 == null) return;
      const use = idx.length ? idx : [at0];
      setF({
        temp: Math.round(h.temperature_2m[at0]),
        rain: Math.max(...use.map((i) => h.precipitation_probability[i] ?? 0)),
        wind: Math.round(Math.max(...use.map((i) => h.wind_speed_10m[i]))),
        code: Math.max(...use.map((i) => h.weather_code[i])),
        precipIn: use.reduce((s, i) => s + (h.precipitation[i] ?? 0), 0),
      });
    }).catch(() => {});
    return () => { off = true; };
  }, [lat, lng, at, e.status]);
  return f;
}

export const rainy = (f: Forecast | null) => !!f && (f.rain >= 50 || (f.rain >= 35 && f.precipIn >= 0.04) || f.code >= 61);

export function WeatherCard({ e, isHost, onRainCheck }: { e: PlayEvent; isHost: boolean; onRainCheck?: () => void }) {
  const f = useForecast(e);
  if (!f) return null;
  const [, icon, word] = sky(f.code);
  const wet = rainy(f);
  return (
    <section className="mt-4 rounded-3xl p-4 shadow-sm" style={{ background: wet ? '#fff4d6' : '#fff' }}>
      <div className="flex items-center gap-3">
        <div className="text-[34px] leading-none">{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold uppercase tracking-[1.5px]" style={{ color: C.muted }}>At game time</div>
          <div className="text-[17px] font-semibold">{f.temp}°F · {word}</div>
          <div className="text-[13px]" style={{ color: C.muted }}>{f.rain}% chance of rain · wind {f.wind} mph</div>
        </div>
      </div>
      {wet && (
        <div className="mt-3 rounded-2xl p-3 text-[14px]" style={{ background: '#ffe9a8' }}>
          <div className="flex items-center gap-1.5 font-semibold"><CloudRain className="h-4 w-4" />Rain is likely around game time.</div>
          {isHost && onRainCheck ? (
            <button onClick={onRainCheck} className="mt-2 w-full rounded-xl py-2.5 text-[15px] font-semibold text-white" style={{ background: C.ink }}>Rain check: move it</button>
          ) : (
            <div className="mt-1" style={{ color: '#6b5a1f' }}>Check back here. If the host moves it, this page updates.</div>
          )}
        </div>
      )}
      <div className="mt-2 text-right text-[10px]" style={{ color: '#9aa79c' }}>Forecast: Open-Meteo</div>
    </section>
  );
}

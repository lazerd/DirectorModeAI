/**
 * Browser helpers for the check-in phone pages. No server imports.
 *
 * localStorage is a convenience here and nothing more: it remembers names so a
 * regular does not retype "Mary Benin" every morning, and it remembers the
 * group's page so a re-scan finds the running timer. Private browsing, a
 * cleared phone or a blocked storage API must all still work, so every access
 * is wrapped.
 */

const read = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string | null) => {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: carry on without remembering */
  }
};

/** A random id for this phone, used only for rate limits and "one court per phone". */
export function deviceId(): string {
  const existing = read('checkin:device');
  if (existing && /^[a-zA-Z0-9-]{8,64}$/.test(existing)) return existing;
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  write('checkin:device', id);
  return id;
}

export function rememberedNames(): string[] {
  try {
    const v = JSON.parse(read('checkin:names') || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 12) : [];
  } catch {
    return [];
  }
}

export function rememberNames(names: string[]) {
  const merged = [...names, ...rememberedNames()].filter((n, i, all) => n && all.findIndex((x) => x.toLowerCase() === n.toLowerCase()) === i);
  write('checkin:names', JSON.stringify(merged.slice(0, 12)));
}

export const rememberedEmail = () => read('checkin:email') || '';
export const rememberEmail = (email: string) => write('checkin:email', email || null);

export const groupFor = (clubSlug: string) => read(`checkin:group:${clubSlug}`);
export const rememberGroup = (clubSlug: string, token: string | null) => write(`checkin:group:${clubSlug}`, token);

export async function api<T>(url: string, init?: { method?: string; body?: unknown }): Promise<{ ok: boolean; status: number; data: T & { error?: string; code?: string; until?: string | null } }> {
  const res = await fetch(url, {
    method: init?.method ?? 'GET',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'x-checkin-device': deviceId() },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  return { ok: res.ok, status: res.status, data };
}

/** 10:30 AM, in the club's zone (the phone is at the club, but say so anyway). */
export function clock(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

/** 1:05:09 or 12:30 */
export function countdown(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export const PLAY_LABEL: Record<string, string> = {
  singles: 'Singles',
  doubles: 'Doubles',
  other: 'Ball machine / other',
  visit: 'Visit',
};

/** Ask for location only when the club requires it; resolve null on refusal. */
export function location(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  });
}

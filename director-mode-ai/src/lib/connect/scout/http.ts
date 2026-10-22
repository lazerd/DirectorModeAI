/**
 * Scout — the one polite fetcher every adapter and the contact finder use.
 * Sequential per host, a ≥1s gap (or the site's Crawl-delay, capped), a clear
 * User-Agent, a timeout, robots.txt checked before every path, and it never
 * throws: failures come back as { ok: false }.
 */
import { isAllowed, parseRobots, type RobotsPolicy } from './robots';

export const USER_AGENT = 'ClubModeBot/1.0 (+https://clubmode.ai/connect)';
const MIN_GAP_MS = 1000;
const MAX_GAP_MS = 60_000;
const TIMEOUT_MS = 15_000;
const MAX_BYTES = 2_000_000;

export type FetchResult =
  | { ok: true; status: number; url: string; body: string; contentType: string }
  | { ok: false; status: number; url: string; error: string; blockedByRobots?: boolean };

const robotsCache = new Map<string, RobotsPolicy | null>();
const lastHit = new Map<string, number>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rawGet(url: string, accept: string): Promise<FetchResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: accept, 'Accept-Language': 'en-US,en;q=0.8' },
      redirect: 'follow',
      signal: ctrl.signal,
      cache: 'no-store',
    } as RequestInit);
    const contentType = res.headers.get('content-type') || '';
    let body = await res.text();
    if (body.length > MAX_BYTES) body = body.slice(0, MAX_BYTES);
    if (!res.ok) return { ok: false, status: res.status, url: res.url || url, error: `HTTP ${res.status}` };
    return { ok: true, status: res.status, url: res.url || url, body, contentType };
  } catch (e) {
    return { ok: false, status: 0, url, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(t);
  }
}

const hostQueue = new Map<string, Promise<void>>();

/** Serialize requests per host (even if callers run concurrently) with the gap between them. */
function waitTurn(host: string, delaySec: number | null): Promise<void> {
  const gap = Math.min(MAX_GAP_MS, Math.max(MIN_GAP_MS, (delaySec ?? 0) * 1000));
  const prev = hostQueue.get(host) ?? Promise.resolve();
  const next = prev.then(async () => {
    const last = lastHit.get(host);
    if (last != null) {
      const wait = last + gap - Date.now();
      if (wait > 0) await sleep(wait);
    }
    lastHit.set(host, Date.now());
  });
  hostQueue.set(host, next);
  return next;
}

/** robots.txt for an origin (cached for the process). null = none / unreachable → allowed. */
export async function robotsFor(origin: string): Promise<RobotsPolicy | null> {
  if (robotsCache.has(origin)) return robotsCache.get(origin)!;
  // robots.txt itself is not rate-counted (one tiny file per origin per run).
  const r = await rawGet(`${origin}/robots.txt`, 'text/plain,*/*');
  // 4xx → no robots file → allowed. Network/5xx → treat as allowed but note none.
  const policy = r.ok && !/<html/i.test(r.body.slice(0, 500)) ? parseRobots(r.body) : null;
  robotsCache.set(origin, policy);
  return policy;
}

/** GET a URL politely. Checks robots.txt first; respects Crawl-delay (capped at 60s). */
export async function politeGet(url: string, accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'): Promise<FetchResult> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, status: 0, url, error: 'bad url' };
  }
  const policy = await robotsFor(u.origin);
  if (policy && !isAllowed(policy, u.pathname + u.search)) {
    return { ok: false, status: 0, url, error: 'disallowed by robots.txt', blockedByRobots: true };
  }
  await waitTurn(u.host, policy?.crawlDelaySec ?? null);
  return rawGet(url, accept);
}

/** For tests / long-lived processes. */
export function resetFetchState() {
  robotsCache.clear();
  lastHit.clear();
  hostQueue.clear();
}

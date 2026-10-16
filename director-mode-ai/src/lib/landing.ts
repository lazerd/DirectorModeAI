/**
 * Campaign landing-page tracking, shared by /mixermode, /try, /pulse and
 * /benchmarks/pulse. The letter's ?r= code is remembered for the tab
 * (sessionStorage) so a visitor who lands on /mixermode and then runs a round
 * on /try is still tied to the letter that brought them.
 */
export const LANDING_PAGES = ['mixermode', 'pulse'] as const;
export const LANDING_EVENTS = ['view', 'cta', 'first_round', 'submitted'] as const;
export type LandingPage = (typeof LANDING_PAGES)[number];
export type LandingEvent = (typeof LANDING_EVENTS)[number];

const KEY = 'clubmode_landing_ref';

/** The ref from the URL (and remember it), else the one remembered this tab. */
export function landingRef(): string | null {
  if (typeof window === 'undefined') return null;
  const fromUrl = new URLSearchParams(window.location.search).get('r');
  try {
    if (fromUrl) window.sessionStorage.setItem(KEY, fromUrl);
    return fromUrl || window.sessionStorage.getItem(KEY);
  } catch {
    return fromUrl;
  }
}

/** Fire-and-forget. Never throws, never blocks the page. */
export function logLanding(page: LandingPage, event: LandingEvent): void {
  if (typeof window === 'undefined') return;
  try {
    const body = JSON.stringify({ page, event, ref: landingRef() });
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/landing/visit', new Blob([body], { type: 'application/json' }));
    } else {
      void fetch('/api/landing/visit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
    }
  } catch {
    // Logging only.
  }
}

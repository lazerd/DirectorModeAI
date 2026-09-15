/**
 * Run work after the response has gone.
 *
 * A member who taps "I'm in" must see "You're in" the moment the claim commits,
 * not after we have paced emails to the whole group through Resend (2 a second).
 *
 * Next 14 has neither `after()` nor `waitUntil` in next/server, and
 * @vercel/functions is not a dependency. Vercel exposes the same hook its
 * package wraps on the global request context, so we read it directly. Locally
 * (`next dev` / `next start`) the process outlives the request, so a caught
 * floating promise is enough.
 */

type RequestContext = { get?: () => { waitUntil?: (p: Promise<unknown>) => void } | undefined };

export function background(label: string, work: () => Promise<unknown>): void {
  const p = work().catch((err) => console.error(`[courtconnect] ${label} failed`, err));
  // '@vercel/request-context' is what @vercel/functions reads; '@next/request-context'
  // is the one Next's own server reads (base-server.js). Either keeps the function alive.
  const g = globalThis as Record<symbol, RequestContext | undefined>;
  for (const key of ['@vercel/request-context', '@next/request-context']) {
    const store = g[Symbol.for(key)]?.get?.();
    if (store?.waitUntil) {
      store.waitUntil(p);
      return;
    }
  }
}

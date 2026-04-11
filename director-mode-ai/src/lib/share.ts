/**
 * Client-side sharing helpers that wrap the Web Share API with a clipboard
 * fallback.
 *
 * Usage:
 *   const result = await shareMixerEvent({ eventName, eventCode });
 *   if (result === "copied") toast("Link copied");
 *   else if (result === "failed") toast("Share failed");
 *
 * Result values:
 *   - "shared"    — the native OS share sheet completed successfully
 *   - "copied"    — Web Share unavailable, link was copied to clipboard
 *   - "cancelled" — user opened the share sheet and dismissed it
 *   - "failed"    — neither share nor clipboard worked (display an error)
 */

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

type ShareInput = {
  title: string;
  text: string;
  url: string;
};

/**
 * Core share helper. Tries `navigator.share` first (gives the user the OS
 * share sheet on mobile — SMS, WhatsApp, email, etc.); falls back to
 * clipboard if the API isn't available or isn't allowed on this origin.
 */
export async function nativeShare(input: ShareInput): Promise<ShareResult> {
  // navigator.share is available on modern mobile browsers + Safari on macOS.
  // It's gated to secure contexts (HTTPS or localhost).
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({
        title: input.title,
        text: input.text,
        url: input.url,
      });
      return 'shared';
    } catch (err: any) {
      // AbortError is the user dismissing the native share sheet — that's
      // not a failure, they just changed their mind. Don't fall through to
      // clipboard in that case.
      if (err && err.name === 'AbortError') return 'cancelled';
      // Other errors (e.g. NotAllowedError when running over HTTP) fall
      // through to the clipboard path below.
    }
  }

  // Clipboard fallback. Copies the URL so the director can paste it
  // anywhere manually.
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === 'function'
  ) {
    try {
      await navigator.clipboard.writeText(input.url);
      return 'copied';
    } catch {
      return 'failed';
    }
  }

  return 'failed';
}

/**
 * Build a shareable package for a mixer event and invoke the native share.
 */
export function shareMixerEvent(input: {
  eventName: string;
  eventCode: string;
}): Promise<ShareResult> {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const url = `${origin}/event/${input.eventCode}`;
  return nativeShare({
    title: input.eventName,
    text: `Live scores & standings for ${input.eventName} — tap to watch the event.`,
    url,
  });
}

/**
 * Build a shareable package for a league bracket and invoke the native share.
 * Used by the director dashboard and anywhere a viewer wants to fling the
 * bracket URL at a group chat.
 */
export function shareLeagueBracket(input: {
  leagueName: string;
  leagueSlug: string;
}): Promise<ShareResult> {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const url = `${origin}/leagues/${input.leagueSlug}/bracket`;
  return nativeShare({
    title: input.leagueName,
    text: `Live bracket & standings for ${input.leagueName} — tap to view.`,
    url,
  });
}

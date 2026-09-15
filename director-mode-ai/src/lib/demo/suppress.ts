/**
 * Gathers the facts for the demo email guard (emailGuard.ts) and logs a hold.
 *
 * Called from safeResendSend, which every outbound email in the app goes
 * through, and from sendBilledEmail(s) before credits are spent. Never throws:
 * a guard that can crash a send path is worse than no guard.
 */

import { cookies } from 'next/headers';
import { createClient as createSsrClient } from '@/lib/supabase/server';
import { suppressionReason, isExampleAddress, type SuppressReason } from './emailGuard';
import { DEMO_COOKIE, demoSnapshot } from './server';

export type EmailAttribution = {
  /** The club this email is for, when the caller knows it. */
  clubId?: string | null;
  clubSlug?: string | null;
  /** Whose email credits pay for it — for club sends usually the owner, for CaptainMode the captain. */
  billToUserId?: string | null;
};

/**
 * The signed-in user behind this request, remembered per request so a paced
 * batch of fifty does not ask Supabase fifty times. Keyed on the request's
 * cookie store, which Next keeps for the life of one request.
 */
const actorMemo = new WeakMap<object, Promise<string | null>>();

async function requestActor(): Promise<{ userId: string | null; demoToken: string | null } | null> {
  let store: Awaited<ReturnType<typeof cookies>>;
  try {
    store = await cookies();
  } catch {
    return null; // cron, script, or after the request scope is gone
  }
  const demoToken = store.get(DEMO_COOKIE)?.value ?? null;
  const hasSession = store.getAll().some((c) => c.name.startsWith('sb-') && c.name.includes('auth-token'));
  if (!hasSession) return { userId: null, demoToken };
  let pending = actorMemo.get(store as object);
  if (!pending) {
    pending = (async () => {
      try {
        const supabase = await createSsrClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        return user?.id ?? null;
      } catch {
        return null;
      }
    })();
    actorMemo.set(store as object, pending);
  }
  return { userId: await pending, demoToken };
}

export async function demoEmailHold(
  recipients: (string | null | undefined)[],
  who: EmailAttribution = {},
): Promise<SuppressReason | null> {
  // The one rule that needs no lookup goes first, so it holds even if the
  // database is unreachable.
  if (recipients.some(isExampleAddress)) return 'example_recipient';
  try {
    const snap = await demoSnapshot();
    const clubIsDemo =
      (!!who.clubId && snap.clubIds.has(who.clubId)) || (!!who.clubSlug && snap.clubSlugs.has(who.clubSlug));

    let actorIsDemo = !!who.billToUserId && snap.userIds.has(who.billToUserId);
    if (!actorIsDemo && snap.userIds.size) {
      const actor = await requestActor();
      if (actor) {
        actorIsDemo = actor.userId
          ? snap.userIds.has(actor.userId)
          : // Signed out, but carrying a demo link's cookie: a prospect on a
            // public page they reached from the tour.
            !!actor.demoToken && snap.tokens.has(actor.demoToken);
      }
    }
    return suppressionReason({ recipients, clubIsDemo, actorIsDemo, demoEmails: snap.emails });
  } catch (err) {
    console.error('[demo] email guard failed', err);
    return null;
  }
}

/**
 * Texts: no addresses to inspect, so only the actor rules apply. Texting is
 * blocked on A2P 10DLC registration today anyway; this keeps a demo from
 * being the first thing that goes out the day it is not.
 */
export async function demoSmsHold(billToUserId: string | null | undefined): Promise<boolean> {
  try {
    const snap = await demoSnapshot();
    if (!snap.userIds.size) return false;
    if (billToUserId && snap.userIds.has(billToUserId)) return true;
    const actor = await requestActor();
    return !!actor?.userId && snap.userIds.has(actor.userId);
  } catch {
    return false;
  }
}

/** One line per held email, so a demo can be audited from the server log. */
export function logDemoHold(reason: SuppressReason, to: string, subject: string) {
  const masked = to.replace(/^(.).*(@.*)$/, '$1***$2');
  console.info(`[demo] email suppressed (${reason}) to=${masked} subject="${subject.slice(0, 80)}"`);
}

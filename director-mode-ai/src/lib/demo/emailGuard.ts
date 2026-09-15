/**
 * Should this email be held back because it belongs to a demo?
 *
 * The demo tour promises "Nothing you do here emails anyone", and the demo runs
 * on a real club row whose owner and contact address are real people. So the
 * decision is made at the lowest layer every send shares (safeResendSend), and
 * it errs toward holding back. Any ONE of these is enough:
 *
 *   example_recipient  an address at example.com (every invented resident)
 *   demo_recipient     a demo login, or the contact address of a demo club
 *   demo_club          the send is attributed to a club in demo mode
 *   demo_actor         billed to, or triggered by, a demo account
 *
 * Pure so it can be tested; lib/demo/suppress.ts gathers the facts.
 */

export type SuppressReason = 'example_recipient' | 'demo_recipient' | 'demo_club' | 'demo_actor';

export type SuppressFacts = {
  recipients: (string | null | undefined)[];
  /** The club the send is for, if the caller said, and whether it is a demo. */
  clubIsDemo: boolean;
  /** The billed user or the signed-in user is a demo account. */
  actorIsDemo: boolean;
  /** Lower-cased addresses that must never be mailed from a demo. */
  demoEmails: ReadonlySet<string>;
};

const EXAMPLE = /@(?:[a-z0-9-]+\.)*example\.(?:com|org|net)$/i;

export function isExampleAddress(email: string | null | undefined): boolean {
  return !!email && EXAMPLE.test(email.trim());
}

export function suppressionReason(f: SuppressFacts): SuppressReason | null {
  const to = f.recipients.map((r) => (r || '').trim().toLowerCase()).filter(Boolean);
  if (to.some((r) => EXAMPLE.test(r))) return 'example_recipient';
  if (to.some((r) => f.demoEmails.has(r))) return 'demo_recipient';
  if (f.clubIsDemo) return 'demo_club';
  if (f.actorIsDemo) return 'demo_actor';
  return null;
}

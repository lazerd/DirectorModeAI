/**
 * Marketing contact lists that outlive any one event (table promo_contacts).
 *
 * First use: a Dunkin' list — every family that played in, signed up for, or
 * was invited to a Dunkin'-sponsored event — so the next event in a series is
 * promoted to one accumulated list rather than rebuilt from whichever past
 * events happen to be ticked. Signups onto any sponsored event join their
 * sponsor's list automatically; the list shows up as a source in "Invite past
 * players". Opt-outs are honoured at send time (email_unsubscribes), not here.
 */

import { getSponsor } from '@/config/sponsors';

export const CONTACT_LIST_PREFIX = 'list:';

export function sponsorListKey(sponsorId: string): string {
  return `sponsor:${sponsorId}`;
}

/** Add a signup's family to their event's sponsor list. Never throws. */
export async function addSignupToSponsorList(
  admin: any,
  args: {
    ownerId: string;
    sponsorId: string | null | undefined;
    eventSlug: string;
    email: string | null | undefined;
    parentName?: string | null;
    playerName?: string | null;
    division?: string | null;
  }
): Promise<void> {
  if (!args.sponsorId || !args.email?.trim()) return;
  try {
    await admin.rpc('upsert_promo_contact', {
      p_owner: args.ownerId,
      p_list: sponsorListKey(args.sponsorId),
      p_email: args.email,
      p_parent: args.parentName ?? null,
      p_player: args.playerName ?? null,
      p_source: `quad:${args.eventSlug}`,
      p_division: args.division ?? null,
    });
  } catch (err) {
    console.error('promo contact upsert failed:', err);
  }
}

/** The director's contact lists, shaped like the promo panel's other sources. */
export async function contactListSources(
  admin: any,
  userId: string
): Promise<Array<{ id: string; name: string; eventDate: string | null; paidCount: number }>> {
  const { data } = await admin.from('promo_contacts').select('list_key').eq('owner_id', userId);
  const counts = new Map<string, number>();
  for (const r of (data as Array<{ list_key: string }>) || []) {
    counts.set(r.list_key, (counts.get(r.list_key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, n]) => ({
    id: `${CONTACT_LIST_PREFIX}${key}`,
    name: listLabel(key),
    eventDate: null,
    paidCount: n,
  }));
}

/** Rows of the chosen lists, in the same shape as a paid entry. */
export async function contactListRows(
  admin: any,
  userId: string,
  listKeys: string[]
): Promise<Array<Record<string, string | null>>> {
  if (!listKeys.length) return [];
  const { data } = await admin
    .from('promo_contacts')
    .select('email, parent_name, players')
    .eq('owner_id', userId)
    .in('list_key', listKeys);
  return ((data as Array<{ email: string; parent_name: string | null; players: string[] }>) || []).map((r) => ({
    parent_email: r.email,
    parent_name: r.parent_name,
    // One child's name is enough for "Hi Will's family" when there's no parent name.
    player_name: r.players?.[0] ?? null,
    player_email: null,
  }));
}

function listLabel(key: string): string {
  if (key.startsWith('sponsor:')) {
    const sponsor = getSponsor(key.slice('sponsor:'.length));
    return `${sponsor?.name ?? key.slice('sponsor:'.length)} player list`;
  }
  return key;
}

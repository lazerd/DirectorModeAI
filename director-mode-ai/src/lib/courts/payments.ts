/**
 * Resolving how a club wants to be paid, for one thing being sold.
 *
 * Deliberately one function used by both classes and court bookings, because
 * the answer has to be the same in three places that a customer sees within a
 * minute of each other: the page, the confirmation email, and the receipt. Two
 * implementations of "does this club take cards?" is how one of them ends up
 * saying Pay now and another saying pay at the desk.
 *
 * PRECEDENCE, most specific first:
 *   1. the class's own external_payment_url — a class with its own checkout
 *   2. the club's default payment_link — one paste covering everything
 *   3. nothing, which means the club settles up in person
 *
 * A per-club processor connection would slot in above all three; it is
 * reported as unavailable until one exists rather than guessed at.
 */

import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { isPaymentLink } from '@/config/payments';

export type ClubPayments = {
  payment_link: string | null;
  payment_link_label: string | null;
  payment_note: string | null;
  link_on_programs: boolean;
  link_on_courts: boolean;
  provider: 'none' | 'square' | 'stripe';
  provider_status: 'disconnected' | 'pending' | 'connected' | 'revoked';
};

export const DEFAULT_PAYMENTS: ClubPayments = {
  payment_link: null,
  payment_link_label: null,
  payment_note: null,
  link_on_programs: true,
  link_on_courts: true,
  provider: 'none',
  provider_status: 'disconnected',
};

export async function getClubPayments(clubId: string): Promise<ClubPayments> {
  const { data } = await getSupabaseAdmin()
    .from('club_payments')
    .select(
      'payment_link, payment_link_label, payment_note, link_on_programs, link_on_courts, provider, provider_status',
    )
    .eq('club_id', clubId)
    .maybeSingle();
  if (!data) return DEFAULT_PAYMENTS;
  return { ...DEFAULT_PAYMENTS, ...(data as Partial<ClubPayments>) };
}

export type PaymentOffer =
  /** Send them to a checkout the club owns. */
  | { kind: 'link'; url: string; label: string; note: string | null }
  /** Nothing owed. */
  | { kind: 'free' }
  /** Owed, but the club has no online checkout — settle up in person. */
  | { kind: 'in_person'; note: string | null };

/**
 * What to offer someone who owes money.
 *
 * `surface` matters because a club may want its link on class sign-ups and not
 * on casual court time, or the reverse — and a court booked five minutes from
 * now is usually paid at the desk whatever the club's policy is.
 */
export function paymentOffer(opts: {
  amountCents: number;
  clubPayments: ClubPayments;
  surface: 'program' | 'court';
  /** The class's own link, where it has one. */
  ownLink?: string | null;
}): PaymentOffer {
  if (opts.amountCents <= 0) return { kind: 'free' };

  const allowed =
    opts.surface === 'program'
      ? opts.clubPayments.link_on_programs
      : opts.clubPayments.link_on_courts;

  // A class's own link beats the club default, and is honoured even where the
  // club has switched the default off for this surface — setting it on the
  // class IS the club saying yes for that class.
  const own = (opts.ownLink || '').trim();
  if (own && isPaymentLink(own)) {
    return {
      kind: 'link',
      url: own,
      label: opts.clubPayments.payment_link_label?.trim() || 'Pay now',
      note: opts.clubPayments.payment_note,
    };
  }

  const club = (opts.clubPayments.payment_link || '').trim();
  if (allowed && club && isPaymentLink(club)) {
    return {
      kind: 'link',
      url: club,
      label: opts.clubPayments.payment_link_label?.trim() || 'Pay now',
      note: opts.clubPayments.payment_note,
    };
  }

  return { kind: 'in_person', note: opts.clubPayments.payment_note };
}

/**
 * One sentence about paying, for a page or an email.
 *
 * Exists so the wording cannot drift between the two. A customer who reads
 * "settle up at the desk" on the page and "pay now" in the email has been told
 * two different things by the same club.
 */
export function paymentSentence(offer: PaymentOffer, surface: 'program' | 'court'): string {
  if (offer.kind === 'free') return '';
  if (offer.kind === 'link') {
    return (
      offer.note ||
      (surface === 'court'
        ? 'Your court is held — pay now to lock it in.'
        : 'Your spot is held — pay now to lock it in.')
    );
  }
  return (
    offer.note ||
    (surface === 'court'
      ? 'Settle up at the desk when you arrive.'
      : 'Your spot is held — the club will be in touch about payment.')
  );
}

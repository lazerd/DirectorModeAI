/**
 * payments.ts — who may use the platform's own payment rails.
 *
 * SQUARE_ACCESS_TOKEN belongs to ONE seller account: Sleepy Hollow's. Before
 * this existed every club's paid entry went through it, so another club's
 * entry fees would have landed in Sleepy Hollow's Square. Square-hosted checkout
 * is now only used for events owned by this account or by staff of a club it
 * owns (see squareEnabledForEventOwner in lib/square). Every other club takes
 * paid entry through the payment link the director pastes on the event.
 *
 * Client-safe (no imports) so the create forms can skip the payment-link
 * requirement for the Square owner. A user id is not a secret.
 */
export const SQUARE_ACCOUNT_OWNER_ID = '7ff5078a-ee6d-46b7-9af7-20b35f62729d';

/** A pasted payment link must at least be an https URL. */
export function isPaymentLink(url: string): boolean {
  return /^https:\/\/\S+\.\S+$/i.test(url.trim());
}

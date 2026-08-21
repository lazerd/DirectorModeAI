/**
 * Event sponsors — brand theming for public event pages.
 *
 * An event opts in by setting `events.sponsor_id` to a key in SPONSORS. The
 * public Quads landing + results pages then render in the sponsor's palette
 * with their perks, locations and prize copy.
 *
 * Logos: we deliberately do NOT ship anyone's trademarked logo file. Each
 * sponsor renders as a styled wordmark in their own colors until the sponsor's
 * rep supplies an approved asset — drop it in /public and set `logoUrl`.
 */

export type SponsorLocation = {
  label: string;
  street: string;
  city: string;
  mapUrl: string;
};

export type Sponsor = {
  id: string;
  /** Brand name exactly as the sponsor writes it (apostrophes matter). */
  name: string;
  /** Short line under the wordmark, e.g. "Presented by". */
  presentedBy: string;
  tagline: string;
  colors: {
    primary: string; // headlines, buttons
    secondary: string; // accents
    ink: string; // body text on light backgrounds
    cream: string; // page background
    surface: string; // card background
  };
  /** Optional approved logo asset in /public. Falls back to a styled wordmark. */
  logoUrl?: string;
  /** What the sponsor is putting on the table at the event. */
  perks: Array<{ emoji: string; title: string; body: string }>;
  prize: {
    headline: string;
    body: string;
  };
  locations: SponsorLocation[];
  /** Required trademark / non-affiliation footnote. */
  legal: string;
};

export const SPONSORS: Record<string, Sponsor> = {
  dunkin: {
    id: 'dunkin',
    name: "Dunkin'",
    presentedBy: 'Presented by',
    tagline: "America Runs on Dunkin'. So does this quad.",
    colors: {
      primary: '#FF6E0C', // Dunkin' orange
      secondary: '#DA1884', // Dunkin' magenta
      ink: '#3B2314',
      cream: '#FFF7EF',
      surface: '#FFFFFF',
    },
    perks: [
      {
        emoji: '🍩',
        title: 'Donuts on the deck',
        body: "A box of Dunkin' donuts courtesy of your local Concord and Walnut Creek shops — players and parents, help yourselves.",
      },
      {
        emoji: '☕',
        title: 'Coffee for the parents',
        body: "Hot and iced Dunkin' coffee served courtside for the whole two-hour block. Nobody watches junior tennis un-caffeinated.",
      },
      {
        emoji: '🧃',
        title: 'Juice for the players',
        body: 'Cold juice and water between rounds so the kids stay fueled through all four matches.',
      },
    ],
    prize: {
      headline: "Win your quad, win a Dunkin' gift card",
      body: "Every quad of four crowns a champion, and every champion walks away with a Dunkin' gift card redeemable at the Concord and Walnut Creek locations.",
    },
    locations: [
      {
        label: 'Concord',
        street: '4383 Clayton Rd Ste 10',
        city: 'Concord, CA 94521',
        mapUrl:
          'https://www.google.com/maps/search/?api=1&query=' +
          encodeURIComponent("Dunkin', 4383 Clayton Rd Ste 10, Concord, CA 94521"),
      },
      {
        label: 'Walnut Creek',
        street: '1250 Newell Ave K',
        city: 'Walnut Creek, CA 94596',
        mapUrl:
          'https://www.google.com/maps/search/?api=1&query=' +
          encodeURIComponent("Dunkin', 1250 Newell Ave K, Walnut Creek, CA 94596"),
      },
    ],
    legal:
      "Dunkin' is a registered trademark of DD IP Holder LLC. This event is sponsored by the Concord and Walnut Creek franchise locations.",
  },
};

export function getSponsor(id: string | null | undefined): Sponsor | null {
  if (!id) return null;
  return SPONSORS[id] ?? null;
}

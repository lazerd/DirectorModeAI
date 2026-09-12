/**
 * Shapes for the jsonb lists on club_site.
 *
 * These columns are jsonb because they are pure display lists — never queried
 * across clubs, never joined, saved a whole list at a time from a form with
 * add/remove rows. The cost of that choice is that Postgres will not tell us
 * when the editor and the renderer disagree, so this file is the contract
 * instead: the PATCH route validates through it, and the renderer trusts it.
 *
 * Everything is permissive about MISSING and strict about WRONG. A club part
 * way through filling in its staff list must be able to save; a staff entry
 * whose name is a number must not reach the page.
 */

import { z } from 'zod';

/** Trimmed, length-capped text. Empty becomes undefined so blanks don't render. */
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s.length ? s : undefined))
    .optional();

const requiredText = (max: number) => z.string().trim().min(1).max(max);

/**
 * A link a club can publish. Anything but http(s) is dropped rather than
 * rejected — a director pasting "www.carmenpickleball.com" should get a working
 * link, and a `javascript:` URL should never reach an anchor tag.
 */
const url = z
  .string()
  .trim()
  .max(500)
  .transform((s) => {
    if (!s) return undefined;
    const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
    try {
      const u = new URL(withScheme);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : undefined;
    } catch {
      return undefined;
    }
  })
  .optional();

const email = z
  .string()
  .trim()
  .max(200)
  .transform((s) => (s.length ? s.toLowerCase() : undefined))
  .refine((s) => s === undefined || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s), 'Not an email address')
  .optional();

export const amenitySchema = z.object({
  label: requiredText(120),
  detail: text(240),
  /** Key into the renderer's icon map; unknown keys fall back to a dot. */
  icon_key: text(40),
});

export const membershipTierSchema = z.object({
  name: requiredText(80),
  /**
   * A STRING, not cents. Clubs price memberships in ways a number cannot hold
   * — "from $130", "$115 + initiation", "Call for rates" — and forcing cents
   * here would make the field unusable for the thing it exists for.
   */
  price_display: text(60),
  period: text(40),
  includes: z.array(requiredText(160)).max(20).default([]),
  cta_label: text(60),
  cta_href: url,
});

export const staffMemberSchema = z.object({
  name: requiredText(120),
  title: text(120),
  bio: text(2000),
  photo_url: url,
  email,
  phone: text(40),
});

/** Another pro's own program, linked out rather than sold here. */
export const partnerLinkSchema = z.object({
  name: requiredText(120),
  blurb: text(400),
  href: url,
  sport: text(40),
  photo_url: url,
});

export const documentSchema = z.object({
  label: requiredText(120),
  href: url,
  /** 'pdf' | 'link' | anything — only used to pick an icon. */
  kind: text(20),
});

export const serviceSchema = z.object({
  name: requiredText(120),
  blurb: text(600),
  price_note: text(120),
  cta_label: text(60),
  cta_href: url,
});

/**
 * A court rate for a slice of the day. Phase 1 PUBLISHES these; phase 2 prices
 * a booking against them. Cents here, because unlike a membership tier these
 * become arithmetic.
 */
export const courtRateSchema = z.object({
  label: requiredText(80),
  /** Human window: "Weekdays before 4pm", "Weekends & evenings". */
  window: text(120),
  member_cents: z.number().int().min(0).max(1_000_000).nullable().optional(),
  public_cents: z.number().int().min(0).max(1_000_000).nullable().optional(),
  note: text(200),
});

export const navLinkSchema = z.object({
  label: requiredText(40),
  href: requiredText(300),
});

/** The jsonb columns, each capped so one club cannot publish a megabyte. */
export const clubSiteListsSchema = z.object({
  amenities: z.array(amenitySchema).max(30),
  membership_tiers: z.array(membershipTierSchema).max(12),
  staff: z.array(staffMemberSchema).max(40),
  partner_links: z.array(partnerLinkSchema).max(20),
  documents: z.array(documentSchema).max(20),
  services: z.array(serviceSchema).max(20),
  court_rates: z.array(courtRateSchema).max(20),
  nav_links: z.array(navLinkSchema).max(10),
});

/** A hex color, or undefined. A bad value falls back to the default theme. */
const hexColor = z
  .string()
  .trim()
  .transform((s) => (s.length ? s : undefined))
  .refine((s) => s === undefined || /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(s), 'Not a hex color')
  .optional();

export const FONT_CHOICES = ['sans', 'serif', 'condensed'] as const;

/**
 * What the editor may PATCH. Every key optional — the editor autosaves one
 * section at a time, so a partial body is the normal case, not an error.
 */
export const clubSitePatchSchema = z
  .object({
    color_primary: hexColor,
    color_secondary: hexColor,
    color_ink: hexColor,
    color_cream: hexColor,
    color_surface: hexColor,
    font_choice: z.enum(FONT_CHOICES).optional(),

    hero_headline: text(160),
    hero_subhead: text(400),
    hero_image_url: url,
    hero_cta_label: text(60),
    hero_cta_href: url,

    about_body: text(6000),
    courts_blurb: text(2000),
    booking_policy_body: text(3000),

    status: z.enum(['draft', 'published']).optional(),
    seo_title: text(120),
    seo_description: text(320),
  })
  .merge(clubSiteListsSchema.partial())
  .strict();

export type ClubSitePatch = z.infer<typeof clubSitePatchSchema>;
export type Amenity = z.infer<typeof amenitySchema>;
export type MembershipTier = z.output<typeof membershipTierSchema>;
export type StaffMember = z.infer<typeof staffMemberSchema>;
export type PartnerLink = z.infer<typeof partnerLinkSchema>;
export type ClubDocument = z.infer<typeof documentSchema>;
export type ClubService = z.infer<typeof serviceSchema>;
export type CourtRate = z.infer<typeof courtRateSchema>;
export type NavLink = z.infer<typeof navLinkSchema>;

/**
 * Read a jsonb list from a row for RENDERING.
 *
 * Deliberately forgiving: a row written before a schema change, or hand-seeded
 * by a migration, must not blank a club's live website. Bad entries are
 * dropped one at a time and the rest of the list renders.
 */
export function parseList<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S>[] {
  if (!Array.isArray(value)) return [];
  const out: z.output<S>[] = [];
  for (const entry of value) {
    const parsed = schema.safeParse(entry);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

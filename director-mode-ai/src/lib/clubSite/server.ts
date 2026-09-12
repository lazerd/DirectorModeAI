/**
 * Loading a club's public site.
 *
 * One read, shared by the page, its generateMetadata and its OG image — all
 * three run for the same request and all three need the same two rows.
 *
 * getSupabaseAdmin() and NOT createServiceClient(): the latter forwards the
 * visitor's auth cookie, so @supabase/ssr sends their JWT and RLS applies.
 * That would make a club's public homepage render differently depending on who
 * was looking, which is the one thing a public homepage must never do.
 */

import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { CLUB_TZ } from '@/lib/captain/clubTime';
import {
  amenitySchema,
  courtRateSchema,
  documentSchema,
  membershipTierSchema,
  navLinkSchema,
  parseList,
  partnerLinkSchema,
  serviceSchema,
  staffMemberSchema,
  type Amenity,
  type ClubDocument,
  type ClubService,
  type CourtRate,
  type MembershipTier,
  type NavLink,
  type PartnerLink,
  type StaffMember,
} from './schema';
import { resolveTheme, type ClubTheme } from './theme';

export type ClubFacts = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  sports: string[] | null;
  timezone: string;
  is_public: boolean;
  owner_id: string;
  open_lessons_enabled: boolean | null;
};

export type ClubSiteContent = {
  status: 'draft' | 'published';
  hero_headline: string | null;
  hero_subhead: string | null;
  hero_image_url: string | null;
  hero_cta_label: string | null;
  hero_cta_href: string | null;
  about_body: string | null;
  courts_blurb: string | null;
  booking_policy_body: string | null;
  seo_title: string | null;
  seo_description: string | null;
  amenities: Amenity[];
  membership_tiers: MembershipTier[];
  staff: StaffMember[];
  partner_links: PartnerLink[];
  documents: ClubDocument[];
  services: ClubService[];
  court_rates: CourtRate[];
  nav_links: NavLink[];
};

export type ClubProgram = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  sport: string;
  audience: string;
  age_min: number | null;
  age_max: number | null;
  level_note: string | null;
  range_start: string;
  range_end: string;
  days_of_week: number[] | null;
  exclusions: string[] | null;
  time_start: string;
  time_end: string;
  price_cents: number;
  member_price_cents: number | null;
  drop_in_price_cents: number | null;
  price_note: string | null;
  capacity: number | null;
  waitlist_enabled: boolean;
  registration_opens_at: string | null;
  registration_closes_at: string | null;
  registration_mode: 'online' | 'email' | 'closed';
  external_payment_url: string | null;
  description: string | null;
  coach_name: string | null;
  location_note: string | null;
  image_url: string | null;
  display_order: number;
  status: string;
};

export type ClubSiteBundle = {
  club: ClubFacts;
  site: ClubSiteContent;
  theme: ClubTheme;
  /** Published programs, in the order the club arranged them. */
  programs: ClubProgram[];
  /** True when the site row is a draft — staff previewing their own work. */
  isDraft: boolean;
};

/** Defaults so a club with no club_site row still renders something honest. */
const emptyContent = (): ClubSiteContent => ({
  status: 'draft',
  hero_headline: null,
  hero_subhead: null,
  hero_image_url: null,
  hero_cta_label: null,
  hero_cta_href: null,
  about_body: null,
  courts_blurb: null,
  booking_policy_body: null,
  seo_title: null,
  seo_description: null,
  amenities: [],
  membership_tiers: [],
  staff: [],
  partner_links: [],
  documents: [],
  services: [],
  court_rates: [],
  nav_links: [],
});

function toContent(row: Record<string, unknown> | null): ClubSiteContent {
  if (!row) return emptyContent();
  return {
    status: (row.status as 'draft' | 'published') ?? 'draft',
    hero_headline: (row.hero_headline as string) ?? null,
    hero_subhead: (row.hero_subhead as string) ?? null,
    hero_image_url: (row.hero_image_url as string) ?? null,
    hero_cta_label: (row.hero_cta_label as string) ?? null,
    hero_cta_href: (row.hero_cta_href as string) ?? null,
    about_body: (row.about_body as string) ?? null,
    courts_blurb: (row.courts_blurb as string) ?? null,
    booking_policy_body: (row.booking_policy_body as string) ?? null,
    seo_title: (row.seo_title as string) ?? null,
    seo_description: (row.seo_description as string) ?? null,
    // parseList drops a malformed entry rather than blanking the whole list —
    // a hand-seeded row must never take a club's live site down.
    amenities: parseList(amenitySchema, row.amenities),
    membership_tiers: parseList(membershipTierSchema, row.membership_tiers),
    staff: parseList(staffMemberSchema, row.staff),
    partner_links: parseList(partnerLinkSchema, row.partner_links),
    documents: parseList(documentSchema, row.documents),
    services: parseList(serviceSchema, row.services),
    court_rates: parseList(courtRateSchema, row.court_rates),
    nav_links: parseList(navLinkSchema, row.nav_links),
  };
}

/**
 * The club, its site content and its published programs — or null.
 *
 * Null means "no such public club site", which the caller turns into a 404.
 * A DRAFT site still returns, flagged `isDraft`, so staff can preview their
 * own work at the real URL; the page is responsible for refusing a stranger.
 */
export async function getClubSite(slug: string): Promise<ClubSiteBundle | null> {
  const clean = (slug || '').trim().toLowerCase();
  if (!clean) return null;

  const db = getSupabaseAdmin();
  const { data: clubRow } = await db
    .from('cc_clubs')
    .select(
      'id, slug, name, description, logo_url, cover_image_url, website, phone, email, address, city, state, zip, sports, timezone, is_public, owner_id, open_lessons_enabled',
    )
    .eq('slug', clean)
    .maybeSingle();

  if (!clubRow) return null;
  const club = clubRow as unknown as ClubFacts;
  club.timezone = club.timezone || CLUB_TZ;

  const [{ data: siteRow }, { data: programRows }] = await Promise.all([
    db.from('club_site').select('*').eq('club_id', club.id).maybeSingle(),
    db
      .from('club_programs')
      .select('*')
      .eq('club_id', club.id)
      .eq('status', 'published')
      .order('display_order')
      .order('range_start'),
  ]);

  const site = toContent(siteRow as Record<string, unknown> | null);

  return {
    club,
    site,
    theme: resolveTheme(siteRow as Record<string, unknown> | null),
    programs: (programRows as ClubProgram[] | null) ?? [],
    isDraft: site.status !== 'published',
  };
}

/** One published program by slug, for the detail page. */
export async function getClubProgram(
  clubId: string,
  programSlug: string,
): Promise<ClubProgram | null> {
  const { data } = await getSupabaseAdmin()
    .from('club_programs')
    .select('*')
    .eq('club_id', clubId)
    .eq('slug', (programSlug || '').trim().toLowerCase())
    .maybeSingle();
  return (data as ClubProgram | null) ?? null;
}

/**
 * How many spots are left, and whether the next person joins a waitlist.
 *
 * Counts 'enrolled' only: a waitlisted family is not occupying a spot, and a
 * cancelled one certainly is not. `null` capacity means unlimited, which is
 * the honest default for a club that has not thought about it.
 */
export async function programAvailability(
  program: Pick<ClubProgram, 'id' | 'capacity' | 'waitlist_enabled'>,
): Promise<{ enrolled: number; waitlisted: number; spotsLeft: number | null; full: boolean }> {
  const db = getSupabaseAdmin();
  const [{ count: enrolled }, { count: waitlisted }] = await Promise.all([
    db
      .from('club_program_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('program_id', program.id)
      .eq('status', 'enrolled'),
    db
      .from('club_program_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('program_id', program.id)
      .eq('status', 'waitlist'),
  ]);
  const taken = enrolled ?? 0;
  const spotsLeft = program.capacity == null ? null : Math.max(0, program.capacity - taken);
  return {
    enrolled: taken,
    waitlisted: waitlisted ?? 0,
    spotsLeft,
    full: spotsLeft !== null && spotsLeft === 0,
  };
}

/**
 * Is registration open right now?
 *
 * Separate from "is it full" because the answers lead to different sentences:
 * a closed window says come back, a full class offers the waitlist.
 */
export function registrationWindow(
  program: Pick<ClubProgram, 'registration_mode' | 'registration_opens_at' | 'registration_closes_at'>,
  now: Date = new Date(),
): { open: boolean; reason: 'ok' | 'closed' | 'not_yet' | 'ended' | 'email_only' } {
  if (program.registration_mode === 'closed') return { open: false, reason: 'closed' };
  if (program.registration_mode === 'email') return { open: false, reason: 'email_only' };
  if (program.registration_opens_at && new Date(program.registration_opens_at) > now) {
    return { open: false, reason: 'not_yet' };
  }
  if (program.registration_closes_at && new Date(program.registration_closes_at) < now) {
    return { open: false, reason: 'ended' };
  }
  return { open: true, reason: 'ok' };
}

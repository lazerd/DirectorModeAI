/**
 * What a director may send when creating or editing a class.
 *
 * The shape is boring on purpose. The valuable part of this feature is that
 * `exclusions` and the three price fields are ordinary editable columns rather
 * than a developer task, so the validation's job is to let a half-finished
 * draft save while refusing anything that would render wrong on a public page.
 */

import { z } from 'zod';
import { isPaymentLink } from '@/config/payments';

const ymd = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date');

/** HH:MM or HH:MM:SS — Postgres hands back seconds, forms send minutes. */
const hhmm = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Use a 24-hour time like 15:30')
  .transform((s) => s.slice(0, 5));

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s.length ? s : null))
    .nullable()
    .optional();

const cents = z.number().int().min(0).max(10_000_000);

/**
 * A pasted checkout link. Validated with the SAME isPaymentLink the event
 * forms use, so "what counts as a payment link" means one thing in the app.
 */
const paymentLink = z
  .string()
  .trim()
  .transform((s) => (s.length ? s : null))
  .nullable()
  .optional()
  .refine((s) => s == null || isPaymentLink(s), 'That does not look like a payment link (https://…)');

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Letters, numbers and dashes only');

/*
 * The fields, before the cross-field rules.
 *
 * Kept separate because .refine() returns a ZodEffects, which has no
 * .partial() — and the editor needs a partial version to autosave one field at
 * a time. So: base object here, rules bolted on below, partial derived from
 * the base.
 */
export const programBaseSchema = z
  .object({
    slug: slug.optional(),
    title: z.string().trim().min(1).max(160),
    subtitle: optionalText(240),
    sport: z.enum(['tennis', 'pickleball', 'padel', 'swim', 'fitness', 'other']).default('tennis'),
    audience: z.enum(['junior', 'adult', 'family', 'all']).default('all'),
    age_min: z.number().int().min(2).max(100).nullable().optional(),
    age_max: z.number().int().min(2).max(100).nullable().optional(),
    level_note: optionalText(200),

    range_start: ymd,
    range_end: ymd,
    // 0=Sun..6=Sat, deduped so a double-click on a checkbox cannot make a
    // class meet twice on the same day.
    days_of_week: z
      .array(z.number().int().min(0).max(6))
      .max(7)
      .transform((a) => [...new Set(a)].sort((x, y) => x - y))
      .default([]),
    exclusions: z
      .array(ymd)
      .max(120)
      .transform((a) => [...new Set(a)].sort())
      .default([]),
    time_start: hhmm,
    time_end: hhmm,

    price_cents: cents.default(0),
    member_price_cents: cents.nullable().optional(),
    drop_in_price_cents: cents.nullable().optional(),
    price_note: optionalText(160),

    capacity: z.number().int().min(1).max(1000).nullable().optional(),
    waitlist_enabled: z.boolean().default(true),
    registration_opens_at: z.string().datetime({ offset: true }).nullable().optional(),
    registration_closes_at: z.string().datetime({ offset: true }).nullable().optional(),
    registration_mode: z.enum(['online', 'email', 'closed']).default('online'),

    external_payment_url: paymentLink,

    description: optionalText(6000),
    coach_name: optionalText(120),
    location_note: optionalText(160),
    image_url: optionalText(500),
    display_order: z.number().int().min(0).max(9999).default(0),
    status: z.enum(['draft', 'published', 'archived']).default('draft'),
  });

export const programWriteSchema = programBaseSchema
  .refine((p) => p.range_end >= p.range_start, {
    message: 'The last date cannot be before the first',
    path: ['range_end'],
  })
  .refine((p) => p.time_end > p.time_start, {
    message: 'The end time has to be after the start time',
    path: ['time_end'],
  })
  .refine((p) => p.age_min == null || p.age_max == null || p.age_max >= p.age_min, {
    message: 'The oldest age cannot be below the youngest',
    path: ['age_max'],
  });

/**
 * Editing: the same field rules, one at a time.
 *
 * The cross-field rules are NOT here — a PATCH carrying only range_end has
 * nothing to compare it against. The route re-checks them against the stored
 * row after merging.
 */
export const programPatchSchema = programBaseSchema.partial().strict();

export type ProgramWrite = z.output<typeof programWriteSchema>;
export type ProgramPatch = z.output<typeof programPatchSchema>;

/** "After-School Juniors" → "after-school-juniors" */
export function slugifyTitle(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 70) || 'class'
  );
}

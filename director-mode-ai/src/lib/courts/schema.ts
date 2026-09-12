/**
 * What a director may send when setting up a court rate.
 *
 * Strict about the things that would produce a wrong price or an unbookable
 * page, permissive about everything else — a club part way through configuring
 * its rates must be able to save.
 */

import { z } from 'zod';

/** HH:MM or HH:MM:SS — Postgres hands back seconds, forms send minutes. */
const hhmm = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Use a 24-hour time like 16:00')
  .transform((s) => s.slice(0, 5));

export const rateCardBaseSchema = z.object({
  label: z.string().trim().min(1).max(80),
  applies_to: z.enum(['member', 'public']),
  days_of_week: z
    .array(z.number().int().min(0).max(6))
    .max(7)
    .transform((a) => [...new Set(a)].sort((x, y) => x - y))
    .default([]),
  time_start: hhmm.default('00:00'),
  time_end: hhmm.default('23:59'),
  /** Per hour. Zero is a real price — it is how members play free. */
  price_cents: z.number().int().min(0).max(1_000_000).default(0),
  advance_days: z.number().int().min(0).max(365).default(7),
  /**
   * Capped at a day. A club offering an 18-hour court booking has typed
   * something wrong, and the booking page would render a hundred buttons.
   */
  min_minutes: z.number().int().min(15).max(1440).nullable().optional(),
  max_minutes: z.number().int().min(15).max(1440).nullable().optional(),
  active: z.boolean().default(true),
  display_order: z.number().int().min(0).max(9999).default(0),
  note: z
    .string()
    .trim()
    .max(200)
    .transform((s) => (s.length ? s : null))
    .nullable()
    .optional(),
});

export const rateCardWriteSchema = rateCardBaseSchema
  .refine((r) => r.time_end > r.time_start, {
    message: 'The end time has to be after the start time',
    path: ['time_end'],
  })
  .refine((r) => r.min_minutes == null || r.max_minutes == null || r.max_minutes >= r.min_minutes, {
    message: 'The longest booking cannot be shorter than the shortest',
    path: ['max_minutes'],
  });

/**
 * Editing one field at a time. The cross-field rules live in the route, which
 * merges the patch onto the stored row before checking them — a PATCH carrying
 * only time_end has nothing of its own to compare against.
 */
export const rateCardPatchSchema = rateCardBaseSchema.partial().strict();

export type RateCardWrite = z.output<typeof rateCardWriteSchema>;

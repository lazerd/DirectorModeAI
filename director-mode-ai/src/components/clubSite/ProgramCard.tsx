/**
 * A class, as a parent sees it before clicking.
 *
 * The dated line is the part that matters. Every other club website in this
 * business says "Tuesdays, 10 weeks"; this says which ten Tuesdays, and which
 * one it skips — which is only possible because the skip dates are data rather
 * than a note in a paragraph somebody has to remember to update.
 */

import Link from 'next/link';
import type { ClubProgram } from '@/lib/clubSite/server';
import type { ClubTheme } from '@/lib/clubSite/theme';
import { readableOn, tint } from '@/lib/clubSite/theme';
import {
  daysLabel,
  formatPrice,
  formatSessionDate,
  formatTimeRange,
  programSessions,
} from '@/lib/programs/sessions';

export default function ProgramCard({
  program,
  clubSlug,
  theme,
  timeZone,
}: {
  program: ClubProgram;
  clubSlug: string;
  theme: ClubTheme;
  timeZone: string;
}) {
  const sessions = programSessions(program, timeZone);
  const first = sessions.dates[0];
  const last = sessions.dates[sessions.dates.length - 1];
  const ages =
    program.age_min && program.age_max
      ? `Ages ${program.age_min}–${program.age_max}`
      : program.age_min
        ? `Ages ${program.age_min}+`
        : null;

  return (
    <Link
      href={`/c/${clubSlug}/programs/${program.slug}`}
      className="block rounded-2xl border p-5 transition-shadow hover:shadow-md"
      style={{ background: theme.surface, borderColor: tint(theme.ink, 0.12) }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider"
              style={{ background: tint(theme.primary, 0.12), color: theme.primary }}
            >
              {program.sport}
            </span>
            {ages && (
              <span className="text-xs font-medium" style={{ color: tint(theme.ink, 0.55) }}>
                {ages}
              </span>
            )}
          </div>
          <h3
            className="mt-2 text-xl font-bold leading-tight"
            style={{ fontFamily: theme.headingFamily }}
          >
            {program.title}
          </h3>
          {program.subtitle && (
            <p className="mt-1 text-sm" style={{ color: tint(theme.ink, 0.65) }}>
              {program.subtitle}
            </p>
          )}
        </div>
        <div
          className="shrink-0 rounded-xl px-3 py-2 text-center"
          style={{ background: theme.primary, color: readableOn(theme.primary) }}
        >
          <div className="text-lg font-bold leading-none">{formatPrice(program.price_cents)}</div>
          {program.member_price_cents != null && (
            <div className="mt-0.5 text-[11px] opacity-80">
              {formatPrice(program.member_price_cents)} members
            </div>
          )}
        </div>
      </div>

      <dl className="mt-4 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        <div className="flex gap-2">
          <dt className="font-semibold">When</dt>
          <dd style={{ color: tint(theme.ink, 0.7) }}>
            {daysLabel(program.days_of_week)}, {formatTimeRange(program.time_start, program.time_end)}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-semibold">Dates</dt>
          <dd style={{ color: tint(theme.ink, 0.7) }}>
            {sessions.count === 0 ? (
              'No sessions scheduled'
            ) : (
              <>
                {sessions.count} {sessions.count === 1 ? 'session' : 'sessions'} ·{' '}
                {formatSessionDate(first, timeZone)}
                {last && last !== first ? `–${formatSessionDate(last, timeZone)}` : ''}
              </>
            )}
          </dd>
        </div>
        {program.coach_name && (
          <div className="flex gap-2">
            <dt className="font-semibold">Coach</dt>
            <dd style={{ color: tint(theme.ink, 0.7) }}>{program.coach_name}</dd>
          </div>
        )}
        {sessions.skipped.length > 0 && (
          <div className="flex gap-2">
            <dt className="font-semibold">We skip</dt>
            <dd style={{ color: tint(theme.ink, 0.7) }}>
              {sessions.skipped.map((d) => formatSessionDate(d, timeZone)).join(', ')}
            </dd>
          </div>
        )}
      </dl>

      <div className="mt-4 text-sm font-semibold" style={{ color: theme.primary }}>
        See dates &amp; sign up →
      </div>
    </Link>
  );
}

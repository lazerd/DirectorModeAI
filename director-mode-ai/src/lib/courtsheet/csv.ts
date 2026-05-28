/**
 * CourtSheet — CSV export.
 *
 * Flat-rows file: one row per reservation, with club-local date + time
 * (front desk reads it, not a machine — readable wins).
 */

import type { Court, Reservation } from './types';
import { utcToLocalDate, utcToLocalTime } from './timezones';
import { sourceLabel, typeLabel } from './theme';

const HEADER = [
  'Date',
  'Court',
  'Start',
  'End',
  'Title',
  'Type',
  'Source',
  'Signups',
  'Status',
];

export function reservationsToCsv(args: {
  courts: Court[];
  reservations: Reservation[];
  signupCountsById?: Record<string, number>;
  timezone: string;
}): string {
  const { courts, reservations, signupCountsById, timezone } = args;
  const byId: Record<string, Court> = {};
  for (const c of courts) byId[c.id] = c;

  const rows: string[] = [HEADER.join(',')];
  for (const r of reservations) {
    if (r.status === 'cancelled') continue;
    const court = byId[r.court_id];
    const courtLabel = court ? court.name ?? `Court ${court.number}` : '?';
    const count = signupCountsById?.[r.id] ?? 0;
    const signupCol = r.signups_open
      ? r.signups_capacity
        ? `${count}/${r.signups_capacity}`
        : `${count} open`
      : '';
    rows.push(
      [
        utcToLocalDate(r.starts_at, timezone),
        csvField(courtLabel),
        utcToLocalTime(r.starts_at, timezone),
        utcToLocalTime(r.ends_at, timezone),
        csvField(r.title),
        typeLabel(r.type),
        sourceLabel(r.source),
        csvField(signupCol),
        r.status,
      ].join(',')
    );
  }
  return rows.join('\r\n');
}

function csvField(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Browser-only convenience to trigger a CSV download. */
export function downloadReservationsCsv(args: {
  courts: Court[];
  reservations: Reservation[];
  signupCountsById?: Record<string, number>;
  timezone: string;
  filename?: string;
}): void {
  const csv = reservationsToCsv(args);
  const filename = args.filename ?? `courtsheet-${new Date().toISOString().slice(0, 10)}.csv`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

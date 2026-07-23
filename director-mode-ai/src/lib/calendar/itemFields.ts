/**
 * CalendarMode — the whitelist of client-settable fields on a calendar item.
 *
 * Every write to calendar_items from the browser passes through here, so a
 * stray field in a request body can never reach the row. Lives in lib rather
 * than beside the route because Next route files may only export handlers, and
 * both POST /items and PATCH /items/[id] need it.
 */

import { catalogEntry } from './catalog';
import { DEPARTMENTS, AUDIENCES } from './types';

export function itemOverrides(r: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const str = (v: unknown, max: number) =>
    (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
  const int = (v: unknown, min: number, max: number) => {
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : undefined;
  };
  const date = (v: unknown) => {
    if (v === null) return null;
    return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
  };

  const set = (k: string, v: unknown) => { if (v !== undefined) out[k] = v; };

  set('title', str(r.title, 200));
  set('description', str(r.description, 4000));
  set('notes', str(r.notes, 4000));
  set('anchor_rule', r.anchor_rule === null ? null : str(r.anchor_rule, 80));
  set('format_hint', r.format_hint === null ? null : str(r.format_hint, 60));
  set('target_date', date(r.target_date));
  set('target_end_date', date(r.target_end_date));
  set('duration_minutes', int(r.duration_minutes, 0, 24 * 60));
  set('courts_needed', int(r.courts_needed, 0, 100));
  set('staff_needed', int(r.staff_needed, 0, 100));
  set('expected_attendance', int(r.expected_attendance, 0, 5000));
  set('entry_fee_cents', int(r.entry_fee_cents, 0, 1_000_000));
  set('expected_revenue_cents', int(r.expected_revenue_cents, 0, 1_000_000_000));
  set('expected_cost_cents', int(r.expected_cost_cents, 0, 1_000_000_000));

  if (typeof r.start_time === 'string' && /^\d{2}:\d{2}$/.test(r.start_time)) out.start_time = r.start_time;
  else if (r.start_time === null) out.start_time = null;

  if (typeof r.department === 'string' && (DEPARTMENTS as readonly string[]).includes(r.department)) {
    out.department = r.department;
  }
  if (Array.isArray(r.audience)) {
    const clean = r.audience.filter((a: unknown) => (AUDIENCES as readonly string[]).includes(String(a)));
    out.audience = [...new Set(clean)].slice(0, 8);
  }
  if (['idea', 'scheduled', 'promoted', 'done', 'dropped'].includes(r.status)) {
    out.status = r.status;
  }

  // Scheduling and un-scheduling keep status honest without the client having
  // to remember to send both.
  if (out.target_date && out.status === undefined) out.status = 'scheduled';
  if (out.target_date === null && out.status === undefined) out.status = 'idea';

  // Seed the department from the catalog when a custom item names one but
  // skipped the details.
  if (typeof r.catalogKey === 'string') {
    const c = catalogEntry(r.catalogKey);
    if (c && out.department === undefined) out.department = c.department;
  }

  return out;
}

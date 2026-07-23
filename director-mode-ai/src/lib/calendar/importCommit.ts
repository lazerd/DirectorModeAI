/**
 * CalendarMode — writing reviewed import rows.
 *
 * Shared by every import path (.ics/CSV, the Claude vision reader, and the
 * ClubMode sweep) so there is exactly one write path and exactly one undo.
 * Lives in lib because Next route files may only export handlers.
 *
 * Constraints are attached to a calendar_imports record rather than written
 * loose: a school-calendar PDF that read badly is then one click to reverse
 * instead of forty rows to hunt down by hand.
 */

import type { ConstraintSource } from './types';

export const MAX_IMPORT_ROWS = 500;

export interface CommitResult {
  import?: { id: string; kind: string; label: string | null; item_count: number };
  count?: number;
  error?: string;
}

export async function commitConstraints(params: {
  db: any;
  clubId: string;
  userId: string;
  planId: string | null;
  kind: string;
  label: string;
  filename: string | null;
  rows: any[];
  source: ConstraintSource;
}): Promise<CommitResult> {
  const { db, clubId, userId, planId, kind, label, filename, rows, source } = params;

  const clean = rows
    .filter((r) => !r?.ignore)
    .map((r) => ({
      title: String(r?.title ?? '').trim().slice(0, 200),
      starts_on: String(r?.starts_on ?? ''),
      ends_on: String(r?.ends_on ?? r?.starts_on ?? ''),
      impact: ['blocking', 'heavy', 'light', 'favorable'].includes(r?.impact) ? r.impact : 'light',
      audience_tags: Array.isArray(r?.audience_tags) ? r.audience_tags.slice(0, 8) : [],
    }))
    .filter((r) => r.title && isDate(r.starts_on) && isDate(r.ends_on) && r.ends_on >= r.starts_on)
    .slice(0, MAX_IMPORT_ROWS);

  if (clean.length === 0) return { error: 'Nothing selected to import.' };

  const { data: imp, error: impErr } = await db
    .from('calendar_imports')
    .insert({
      club_id: clubId,
      plan_id: planId,
      kind,
      filename,
      label: label.slice(0, 120),
      item_count: clean.length,
      summary: `${clean.length} entries`,
      created_by: userId,
    })
    .select('id, kind, label, filename, item_count, created_at')
    .single();

  if (impErr || !imp) return { error: impErr?.message ?? 'Could not record the import.' };

  const { error: rowErr } = await db.from('calendar_constraints').insert(
    clean.map((r) => ({
      club_id: clubId,
      // Club-wide, not plan-scoped: a school calendar applies to every year the
      // director plans, and re-importing it per plan would be busywork.
      plan_id: null,
      import_id: imp.id,
      source,
      ...r,
    })),
  );

  if (rowErr) {
    // Roll the import record back so a failed write never leaves a phantom
    // entry claiming forty constraints that aren't there.
    await db.from('calendar_imports').delete().eq('id', imp.id);
    return { error: rowErr.message };
  }

  return { import: imp, count: clean.length };
}

function isDate(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

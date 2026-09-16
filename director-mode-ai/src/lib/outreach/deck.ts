/**
 * The deck: what the rep sees, and what a swipe does.
 *
 * Every decision in here is a status change on one queue row plus, sometimes,
 * one suppression row. That is the whole model, and it is deliberately small
 * enough that Undo can be honest: reverse the status, delete the suppression
 * this decision created, and the board is exactly as it was.
 *
 * Nothing in this file sends anything. A right swipe sets `approved` and an
 * `approved_at`; the sender is a separate module with a separate trigger, so
 * a bug in the UI can queue a bad email but can never put one in an inbox.
 */

import type { getSupabaseAdmin } from '@/lib/supabase/admin';
import { compose } from '@/lib/crm/compose';
import { postalAddress } from '@/lib/crm/send';
import type { Contact, Org } from '@/lib/crm/types';
import { QUEUE_COLS, type DeckCard, type QueueRow, type SuppressReason } from './types';
import { insideWindow, windowLabel, outreachToday } from './settings';
import { loadSettings } from './plan';

type Db = ReturnType<typeof getSupabaseAdmin>;

/** The one-tap reasons under a left swipe. Free text is allowed as well. */
export const SKIP_REASONS = [
  'Too small',
  'Wrong region',
  'Has a system already',
  'Contact looks wrong',
  'Not a fit',
] as const;

export interface DeckPayload {
  today: string;
  paused: boolean;
  cards: DeckCard[];
  /** Everything decided today, for the progress line and the end screen. */
  tally: { total: number; approved: number; rejected: number; snoozed: number; sent: number };
  /** Whether an Undo is available, and what it would put back. */
  undo: { queue_id: string; org_name: string; was: string } | null;
}

/**
 * Today's cards, oldest-planned first.
 *
 * `preview` is built by the same compose() the sender uses, so the text on the
 * card IS the text that goes out — signature, opt-out line and postal address
 * included. There is no second renderer to drift.
 */
export async function loadDeck(db: Db, repEmail: string, now: Date = new Date()): Promise<DeckPayload> {
  const today = outreachToday(now);
  const settings = await loadSettings(db);

  const { data } = await db
    .from('crm_outreach_queue')
    .select(QUEUE_COLS)
    .eq('status', 'planned')
    .lte('send_date', today)
    .order('created_at', { ascending: true })
    .limit(100);
  const rows = (data as QueueRow[] | null) ?? [];

  const cards: DeckCard[] = [];
  if (rows.length) {
    const orgIds = [...new Set(rows.map((r) => r.org_id))];
    const contactIds = rows.map((r) => r.contact_id).filter(Boolean) as string[];
    const [{ data: orgs }, { data: contacts }, { data: allContacts }] = await Promise.all([
      db.from('crm_orgs').select('*').in('id', orgIds),
      contactIds.length ? db.from('crm_contacts').select('*').in('id', contactIds) : Promise.resolve({ data: [] }),
      db.from('crm_contacts').select('id, org_id').in('org_id', orgIds),
    ]);
    const orgById = new Map(((orgs as unknown as (Org & { region?: string | null })[]) ?? []).map((o) => [o.id, o]));
    const contactById = new Map(((contacts as unknown as Contact[]) ?? []).map((c) => [c.id, c]));
    const counts = new Map<string, number>();
    for (const c of ((allContacts as { org_id: string }[] | null) ?? [])) {
      counts.set(c.org_id, (counts.get(c.org_id) ?? 0) + 1);
    }

    for (const row of rows) {
      const org = orgById.get(row.org_id);
      const contact = row.contact_id ? contactById.get(row.contact_id) : null;
      if (!org || !contact) continue;
      const built = compose({
        org,
        contact,
        repName: repEmail,
        replyTo: repEmail,
        subject: row.subject,
        body: row.body,
        postalAddress: postalAddress(),
      });
      cards.push({
        queue_id: row.id,
        org_id: org.id,
        org_name: org.name,
        org_region: org.region ?? null,
        org_website: org.website,
        org_city: org.city,
        org_state: org.state,
        contact_id: contact.id,
        contact_name: contact.full_name,
        contact_email: contact.email ?? '',
        contact_title: contact.title,
        other_contacts: Math.max(0, (counts.get(org.id) ?? 1) - 1),
        kind: row.kind,
        subject: row.subject,
        body: row.body,
        why: row.why ?? '',
        generated_by: row.generated_by,
        preview: built.text,
        blocks: built.blocks,
      });
    }
  }

  const tally = await tallyFor(db, today);
  return { today, paused: settings.paused, cards, tally, undo: await lastUndoable(db, repEmail, today) };
}

async function tallyFor(db: Db, today: string) {
  const { data } = await db
    .from('crm_outreach_queue')
    .select('status')
    .eq('send_date', today)
    .limit(500);
  const rows = ((data as { status: string }[] | null) ?? []);
  const n = (s: string) => rows.filter((r) => r.status === s).length;
  return {
    total: rows.length,
    approved: n('approved'),
    rejected: n('rejected'),
    snoozed: n('snoozed'),
    sent: n('sent'),
  };
}

/**
 * The most recent decision this rep can still take back.
 *
 * A `sent` row is never undoable — the email is in an inbox, and an Undo that
 * only changed a database row would be a lie on the screen.
 */
async function lastUndoable(db: Db, repEmail: string, today: string) {
  const { data } = await db
    .from('crm_outreach_queue')
    .select('id, org_id, status, updated_at')
    .eq('rep_email', repEmail)
    .eq('send_date', today)
    .in('status', ['approved', 'rejected', 'snoozed'])
    .order('updated_at', { ascending: false })
    .limit(1);
  const row = ((data as { id: string; org_id: string; status: string }[] | null) ?? [])[0];
  if (!row) return null;
  const { data: org } = await db.from('crm_orgs').select('name').eq('id', row.org_id).maybeSingle();
  return { queue_id: row.id, org_name: (org as { name?: string } | null)?.name ?? 'that club', was: row.status };
}

// ------------------------------------------------------------- decisions

export interface DecisionResult {
  ok: true;
  status: string;
  message: string;
}

/** Swipe right. Queued, not sent — the sender decides when, inside the window. */
export async function approve(
  db: Db,
  queueId: string,
  repEmail: string,
  edited?: { subject?: string; body?: string },
  now: Date = new Date(),
): Promise<DecisionResult | { ok: false; error: string; status?: number }> {
  const row = await plannedRow(db, queueId);
  if (!('id' in row)) return row;

  const settings = await loadSettings(db);
  if (settings.paused) return { ok: false, error: 'Outreach is paused in settings. Nothing can be approved.' };

  const patch: Record<string, unknown> = {
    status: 'approved',
    approved_at: new Date().toISOString(),
    rep_email: repEmail,
    reject_reason: null,
  };
  if (edited?.subject?.trim()) patch.subject = edited.subject.trim().slice(0, 300);
  if (edited?.body?.trim()) patch.body = edited.body.trim().slice(0, 20_000);

  const { error } = await db.from('crm_outreach_queue').update(patch).eq('id', queueId).eq('status', 'planned');
  if (error) return { ok: false, error: error.message };

  const { data: org } = await db.from('crm_orgs').select('name, region').eq('id', row.org_id).maybeSingle();
  const region = (org as { region?: string | null } | null)?.region ?? null;
  const when = insideWindow(settings, region, now) ? 'goes out in the next few minutes' : windowLabel(settings, region, now);
  return { ok: true, status: 'approved', message: `Approved — ${when}.` };
}

/**
 * Swipe left.
 *
 * Rejecting suppresses the CLUB, not the address: "not a fit" is a fact about
 * the club, and proposing the same club again next week under a different
 * board member's name is exactly the thing Darrin asked never to happen.
 */
export async function reject(
  db: Db,
  queueId: string,
  repEmail: string,
  reason?: string | null,
): Promise<DecisionResult | { ok: false; error: string; status?: number }> {
  const row = await plannedRow(db, queueId);
  if (!('id' in row)) return row;

  const clean = (reason ?? '').trim().slice(0, 200) || null;
  const { error } = await db
    .from('crm_outreach_queue')
    .update({ status: 'rejected', reject_reason: clean, rep_email: repEmail })
    .eq('id', queueId)
    .eq('status', 'planned');
  if (error) return { ok: false, error: error.message };

  await db.from('crm_outreach_suppression').insert({
    org_id: row.org_id,
    reason: 'swiped left' as SuppressReason,
    note: clean,
    queue_id: queueId,
    created_by_email: repEmail,
  });
  return { ok: true, status: 'rejected', message: clean ? `Skipped — ${clean}.` : 'Skipped for good.' };
}

/** Back in the deck in a week. Nothing is suppressed; nothing is decided. */
export async function snooze(
  db: Db,
  queueId: string,
  repEmail: string,
  days = 7,
  now: Date = new Date(),
): Promise<DecisionResult | { ok: false; error: string; status?: number }> {
  const row = await plannedRow(db, queueId);
  if (!('id' in row)) return row;
  const when = new Date(now.getTime() + days * 86_400_000);
  const { error } = await db
    .from('crm_outreach_queue')
    .update({ status: 'snoozed', send_date: outreachToday(when), rep_email: repEmail })
    .eq('id', queueId)
    .eq('status', 'planned');
  if (error) return { ok: false, error: error.message };
  return { ok: true, status: 'snoozed', message: `Back in ${days} days.` };
}

/** Save an edited body without deciding. The rep may still swipe either way. */
export async function saveEdit(
  db: Db,
  queueId: string,
  edited: { subject?: string; body?: string },
): Promise<DecisionResult | { ok: false; error: string; status?: number }> {
  const row = await plannedRow(db, queueId);
  if (!('id' in row)) return row;
  const patch: Record<string, unknown> = {};
  if (edited.subject?.trim()) patch.subject = edited.subject.trim().slice(0, 300);
  if (edited.body?.trim()) patch.body = edited.body.trim().slice(0, 20_000);
  if (!Object.keys(patch).length) return { ok: false, error: 'Nothing to save.' };
  const { error } = await db.from('crm_outreach_queue').update(patch).eq('id', queueId).eq('status', 'planned');
  if (error) return { ok: false, error: error.message };
  return { ok: true, status: 'planned', message: 'Saved.' };
}

/**
 * Take the last decision back.
 *
 * Deletes the suppression row that decision created — keyed on queue_id, so a
 * club suppressed twice for two different reasons keeps the other one.
 */
export async function undo(
  db: Db,
  queueId: string,
  repEmail: string,
): Promise<DecisionResult | { ok: false; error: string; status?: number }> {
  const { data } = await db
    .from('crm_outreach_queue')
    .select('id, org_id, status, send_date, created_at')
    .eq('id', queueId)
    .maybeSingle();
  const row = data as { id: string; org_id: string; status: string; created_at: string } | null;
  if (!row) return { ok: false, error: 'Not found.', status: 404 };
  if (row.status === 'sent') return { ok: false, error: 'That one is already in their inbox.' };
  if (!['approved', 'rejected', 'snoozed'].includes(row.status)) {
    return { ok: false, error: 'Nothing to undo.' };
  }

  await db
    .from('crm_outreach_queue')
    .update({
      status: 'planned',
      approved_at: null,
      reject_reason: null,
      // A snooze moved the date; put it back where the row was created.
      send_date: outreachToday(new Date(row.created_at)),
      rep_email: repEmail,
    })
    .eq('id', queueId);
  await db.from('crm_outreach_suppression').delete().eq('queue_id', queueId);
  return { ok: true, status: 'planned', message: 'Back on the pile.' };
}

/** The row, if it is still undecided. Every decision starts here. */
async function plannedRow(
  db: Db,
  queueId: string,
): Promise<QueueRow | { ok: false; error: string; status?: number }> {
  const { data } = await db.from('crm_outreach_queue').select(QUEUE_COLS).eq('id', queueId).maybeSingle();
  const row = data as QueueRow | null;
  if (!row) return { ok: false, error: 'Not found.', status: 404 };
  if (row.status !== 'planned') return { ok: false, error: `Already ${row.status}.` };
  return row;
}

/**
 * CalendarMode — sending a cadence reminder.
 *
 * Shared by the daily cron and the director's "send this one now" button, so
 * both take exactly the same path: same recipients, same copy, same billing,
 * same unsubscribe handling, and — critically — the same duplicate guard.
 *
 * Recipients come from one of two places:
 *   promoted event  → the people actually entered in it (tournament entries)
 *   still a plan    → the club's contact list (master_players)
 * A save-the-date 60 days out has to reach the whole club, because that is the
 * entire point of a save-the-date; a day-of note for a promoted event should
 * only reach the people playing in it.
 */

import { runCampaign, matchCopy, type CampaignData, type Person } from '@/lib/campaigns/core';
import { reminderCopy, type ReminderRule } from './reminders';
import { shortLabel } from './dates';
import { time12 } from './reminders';
import type { ISODate } from './types';

export interface ReminderContext {
  db: any;
  clubId: string;
  clubName: string;
  /** Billed to, and the reply-to address. */
  ownerId: string;
  ownerEmail: string;
  senderName: string;
  appUrl: string;
}

export interface ReminderItem {
  id: string;
  title: string;
  description: string | null;
  target_date: ISODate | null;
  start_time: string | null;
  signup_deadline: ISODate | null;
  event_id: string | null;
  entry_fee_cents: number | null;
}

export interface SendOutcome {
  ok: boolean;
  recipients: number;
  sent: number;
  status: 'sent' | 'partial' | 'failed' | 'skipped';
  detail?: string;
  subject?: string;
  sampleHtml?: string;
}

/**
 * Build the campaign payload for one reminder.
 * Exported so the preview endpoint renders the identical email the cron will
 * send — a preview that differs from the real thing is worse than none.
 */
export async function buildReminderCampaign(
  ctx: ReminderContext,
  item: ReminderItem,
  rule: ReminderRule,
): Promise<{ ok: true; data: CampaignData } | { ok: false; error: string }> {
  const everyone = await resolveRecipients(ctx, item);
  if (everyone.length === 0) {
    return { ok: false, error: 'No one to send to yet — no entries and no club contacts on file.' };
  }

  const whenLabel = item.target_date
    ? `${shortLabel(item.target_date)}${item.start_time ? ` at ${time12(item.start_time)}` : ''}`
    : null;

  const copy = reminderCopy({
    tone: rule.tone,
    title: item.title,
    whenLabel,
    startTime: item.start_time,
  });

  // A promoted event has a public page worth linking to; a plan item doesn't
  // yet, so the button is dropped rather than pointing somewhere broken.
  const liveUrl = item.event_id ? `${ctx.appUrl}/mixer/events/${item.event_id}` : '';

  const base = matchCopy('event');

  return {
    ok: true,
    data: {
      ownerId: ctx.ownerId,
      clubName: ctx.clubName,
      senderName: ctx.senderName,
      replyTo: ctx.ownerEmail,
      title: item.title,
      liveUrl,
      liveUrlLabel: 'Details & signup',
      deadlineNote: item.signup_deadline ? `Signups close ${shortLabel(item.signup_deadline)}` : null,
      reminderWhen: whenLabel,
      reminderWhere: ctx.clubName,
      reminderLead: copy.lead,
      stats: [],
      everyone,
      nudge: [],
      copy: { ...base, reminderSubject: copy.subject },
    },
  };
}

/**
 * Send one reminder, recording it so it can never go twice.
 *
 * The insert into calendar_reminder_sends happens BEFORE the emails go out.
 * That ordering is deliberate: the UNIQUE(item_id, rule_id) index is what makes
 * a double-send impossible, and it only helps if the claim is staked first. A
 * concurrent or retried run hits a duplicate-key error and backs off instead of
 * mailing the membership a second time. If sending then fails, the row is
 * updated to 'failed' rather than deleted, so a broken send is visible instead
 * of quietly retried forever.
 */
export async function sendReminder(
  ctx: ReminderContext,
  item: ReminderItem,
  rule: ReminderRule,
  opts: { scheduledFor: ISODate; triggeredBy: 'cron' | 'manual' },
): Promise<SendOutcome> {
  const { data: claim, error: claimErr } = await ctx.db
    .from('calendar_reminder_sends')
    .insert({
      club_id: ctx.clubId,
      item_id: item.id,
      rule_id: rule.id,
      scheduled_for: opts.scheduledFor,
      triggered_by: opts.triggeredBy,
      status: 'sent',
      recipients: 0,
    })
    .select('id')
    .single();

  if (claimErr || !claim) {
    // 23505 = unique violation: someone already sent this one. Not an error.
    const already = String(claimErr?.code) === '23505';
    return {
      ok: already,
      recipients: 0,
      sent: 0,
      status: 'skipped',
      detail: already ? 'Already sent.' : claimErr?.message ?? 'Could not claim the send.',
    };
  }

  const built = await buildReminderCampaign(ctx, item, rule);
  if (!built.ok) {
    await ctx.db
      .from('calendar_reminder_sends')
      .update({ status: 'skipped', detail: built.error })
      .eq('id', (claim as any).id);
    return { ok: false, recipients: 0, sent: 0, status: 'skipped', detail: built.error };
  }

  const result = await runCampaign(built.data, 'reminder', 'live');
  if (result.mode !== 'live') {
    return { ok: false, recipients: 0, sent: 0, status: 'failed', detail: 'Unexpected campaign mode.' };
  }

  const status: SendOutcome['status'] =
    result.sent === 0 ? 'failed' : result.sent < result.attempted ? 'partial' : 'sent';

  const detail = result.creditLimited
    ? 'Stopped early — the plan\'s monthly email limit was reached.'
    : result.failures.length > 0
      ? `${result.failures.length} address${result.failures.length === 1 ? '' : 'es'} failed.`
      : undefined;

  await ctx.db
    .from('calendar_reminder_sends')
    .update({ status, recipients: result.sent, detail: detail ?? null })
    .eq('id', (claim as any).id);

  return {
    ok: result.sent > 0,
    recipients: result.attempted,
    sent: result.sent,
    status,
    detail,
    subject: built.data.copy.reminderSubject,
  };
}

/**
 * Who hears about this event.
 *
 * Entries first when the event is real; otherwise the club roster. Deduped by
 * lowercased email so a parent listed against three juniors gets one email, not
 * three — a detail members notice immediately.
 */
export async function resolveRecipients(ctx: ReminderContext, item: ReminderItem): Promise<Person[]> {
  const byEmail = new Map<string, Person>();
  const add = (email: unknown, name: unknown) => {
    const e = String(email ?? '').trim().toLowerCase();
    if (!e || !e.includes('@')) return;
    if (byEmail.has(e)) return;
    const full = String(name ?? '').trim();
    byEmail.set(e, { email: e, firstName: full.split(/\s+/)[0] || 'there' });
  };

  if (item.event_id) {
    const { data: entries } = await ctx.db
      .from('tournament_entries')
      .select('player_name, player_email, parent_name, parent_email, partner_name, partner_email')
      .eq('event_id', item.event_id)
      .limit(1000);

    for (const e of (entries ?? []) as any[]) {
      add(e.player_email, e.player_name);
      add(e.partner_email, e.partner_name);
      // Juniors are usually entered without their own address; the parent is
      // the one who needs to know what time to be there.
      add(e.parent_email, e.parent_name || e.player_name);
    }
    if (byEmail.size > 0) return [...byEmail.values()];
    // An event with no entries yet still deserves its save-the-date, so fall
    // through to the club list rather than sending nothing.
  }

  const { data: players } = await ctx.db
    .from('master_players')
    .select('full_name, email, parent_email')
    .eq('primary_club_id', ctx.clubId)
    .limit(2000);

  for (const p of (players ?? []) as any[]) {
    add(p.email, p.full_name);
    add(p.parent_email, p.full_name);
  }

  return [...byEmail.values()];
}

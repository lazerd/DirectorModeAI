import { NextResponse } from 'next/server';
import { utcToLocalDate } from '@/lib/courtsheet/timezones';
import { requireCalendarContext, isAuthError, ITEM_COLUMNS } from '@/lib/calendar/server';
import {
  resolveSchedule, sanitizeCadence, presetByKey, defaultCadence, matchPreset,
  CADENCE_PRESETS, type ReminderRule,
} from '@/lib/calendar/reminders';
import {
  buildReminderCampaign, sendReminder, resolveRecipients,
  type ReminderContext, type ReminderItem,
} from '@/lib/calendar/reminderSender';
import { runCampaign } from '@/lib/campaigns/core';
import { catalogEntry } from '@/lib/calendar/catalog';

// GET   /api/calendar/reminders?itemId=…   the cadence + resolved dates + what's sent
// PATCH /api/calendar/reminders            set the cadence (preset or custom rules)
// POST  /api/calendar/reminders            preview / send-test-to-me / send-now
export const dynamic = 'force-dynamic';

const COLUMNS = `${ITEM_COLUMNS}, reminder_cadence, signup_deadline`;

export async function GET(req: Request) {
  const ctx = await requireCalendarContext();
  if (isAuthError(ctx)) return ctx.error;

  const itemId = new URL(req.url).searchParams.get('itemId');
  if (!itemId) return NextResponse.json({ error: 'Missing itemId.' }, { status: 400 });

  const loaded = await loadItem(ctx, itemId);
  if ('error' in loaded) return loaded.error;
  const { row } = loaded;

  const rules = sanitizeCadence(row.reminder_cadence);
  const today = utcToLocalDate(new Date(), ctx.club.timezone);

  const { data: sends } = await ctx.db
    .from('calendar_reminder_sends')
    .select('rule_id, sent_at, recipients, status, detail, triggered_by')
    .eq('item_id', itemId);

  const sentByRule = new Map(((sends ?? []) as any[]).map((s) => [s.rule_id, s]));

  const schedule = resolveSchedule(
    rules,
    { eventDate: row.target_date, deadline: row.signup_deadline },
    today,
  ).map((r) => {
    const sent = sentByRule.get(r.rule.id);
    return {
      ...r,
      sentAt: sent?.sent_at ?? null,
      recipients: sent?.recipients ?? null,
      sendStatus: sent?.status ?? null,
      detail: sent?.detail ?? null,
      status: sent ? 'sent' : r.status,
    };
  });

  // Shown as "this will reach N people" so the director knows the size of the
  // send before pressing anything.
  const recipients = await resolveRecipients(await context(ctx), toItem(row));

  return NextResponse.json({
    itemId,
    cadence: rules,
    preset: matchPreset(rules),
    presets: CADENCE_PRESETS,
    suggested: defaultCadence(catalogEntry(row.catalog_key)?.effort ?? 'medium'),
    signupDeadline: row.signup_deadline,
    eventDate: row.target_date,
    startTime: row.start_time ? String(row.start_time).slice(0, 5) : null,
    today,
    schedule,
    recipientCount: recipients.length,
    audience: row.event_id ? 'entrants' : 'club',
  });
}

export async function PATCH(req: Request) {
  const ctx = await requireCalendarContext({ requirePro: true });
  if (isAuthError(ctx)) return ctx.error;

  const body = await req.json().catch(() => null);
  const itemId = String(body?.itemId || '');
  if (!itemId) return NextResponse.json({ error: 'Missing itemId.' }, { status: 400 });

  const loaded = await loadItem(ctx, itemId);
  if ('error' in loaded) return loaded.error;

  const patch: Record<string, unknown> = {};

  if (typeof body.preset === 'string') {
    const preset = presetByKey(body.preset);
    if (!preset) return NextResponse.json({ error: 'Unknown cadence preset.' }, { status: 400 });
    patch.reminder_cadence = preset.rules;
  } else if (Array.isArray(body.cadence)) {
    patch.reminder_cadence = sanitizeCadence(body.cadence);
  }

  if (body.signup_deadline === null) patch.signup_deadline = null;
  else if (typeof body.signup_deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.signup_deadline)) {
    patch.signup_deadline = body.signup_deadline;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  }

  const { data, error } = await ctx.db
    .from('calendar_items')
    .update(patch)
    .eq('id', itemId)
    .eq('club_id', ctx.club.id)
    .select('id, reminder_cadence, signup_deadline')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({
    cadence: (data as any).reminder_cadence,
    signupDeadline: (data as any).signup_deadline,
    preset: matchPreset(sanitizeCadence((data as any).reminder_cadence)),
  });
}

export async function POST(req: Request) {
  const ctx = await requireCalendarContext({ requirePro: true });
  if (isAuthError(ctx)) return ctx.error;

  const body = await req.json().catch(() => null);
  const itemId = String(body?.itemId || '');
  const ruleId = String(body?.ruleId || '');
  const mode = String(body?.mode || 'preview');

  if (!itemId || !ruleId) {
    return NextResponse.json({ error: 'Missing itemId or ruleId.' }, { status: 400 });
  }
  if (!['preview', 'test', 'send'].includes(mode)) {
    return NextResponse.json({ error: 'Unknown mode.' }, { status: 400 });
  }

  const loaded = await loadItem(ctx, itemId);
  if ('error' in loaded) return loaded.error;
  const { row } = loaded;

  const rules = sanitizeCadence(row.reminder_cadence);
  const rule = rules.find((r: ReminderRule) => r.id === ruleId);
  if (!rule) return NextResponse.json({ error: 'That reminder is not in this cadence.' }, { status: 404 });

  const rctx = await context(ctx);
  const item = toItem(row);

  if (mode === 'send') {
    const today = utcToLocalDate(new Date(), ctx.club.timezone);
    const out = await sendReminder(rctx, item, rule, { scheduledFor: today, triggeredBy: 'manual' });
    return NextResponse.json(out, { status: out.ok ? 200 : 400 });
  }

  const built = await buildReminderCampaign(rctx, item, rule);
  if (!built.ok) return NextResponse.json({ error: built.error }, { status: 400 });

  const result = await runCampaign(built.data, 'reminder', mode === 'test' ? 'test' : 'preview');
  return NextResponse.json(result);
}

// ---------- helpers ----------

async function loadItem(ctx: any, itemId: string) {
  const { data } = await ctx.db
    .from('calendar_items')
    .select(COLUMNS)
    .eq('id', itemId)
    .eq('club_id', ctx.club.id)
    .maybeSingle();

  if (!data) {
    return { error: NextResponse.json({ error: 'Event not found.' }, { status: 404 }) };
  }
  return { row: data as any };
}

/** The reply-to and billing identity for this club's reminder emails. */
async function context(ctx: any): Promise<ReminderContext> {
  const { data: profile } = await ctx.db
    .from('profiles')
    .select('email, full_name, organization_name')
    .eq('id', ctx.user.id)
    .maybeSingle();

  return {
    db: ctx.db,
    clubId: ctx.club.id,
    clubName: (profile as any)?.organization_name || ctx.club.name,
    ownerId: ctx.user.id,
    ownerEmail: (profile as any)?.email || ctx.user.email,
    senderName: (profile as any)?.full_name || ctx.club.name,
    appUrl: process.env.NEXT_PUBLIC_APP_URL || 'https://club.coachmode.ai',
  };
}

function toItem(row: any): ReminderItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    target_date: row.target_date,
    start_time: row.start_time ? String(row.start_time).slice(0, 5) : null,
    signup_deadline: row.signup_deadline,
    event_id: row.event_id,
    entry_fee_cents: row.entry_fee_cents,
  };
}

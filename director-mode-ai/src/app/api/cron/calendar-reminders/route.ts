import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { utcToLocalDate } from '@/lib/courtsheet/timezones';
import { dueToday, sanitizeCadence } from '@/lib/calendar/reminders';
import { sendReminder, type ReminderContext, type ReminderItem } from '@/lib/calendar/reminderSender';
import { addDays } from '@/lib/calendar/dates';

// GET /api/cron/calendar-reminders — the daily reminder run.
//
// Walks every calendar item that has a cadence and an upcoming date, works out
// which rules come due today in that CLUB'S timezone, and sends them.
//
// Runs once a day (Vercel Hobby caps crons at daily — a sub-daily schedule is
// rejected and silently breaks every production deploy). Daily is the right
// granularity anyway: cadence offsets are in days, and an 8am local run lands
// the "see you at 7 tonight" note in the morning, which is when people read it.
//
// Safety: sendReminder() claims a row in calendar_reminder_sends BEFORE
// mailing, and UNIQUE(item_id, rule_id) makes a second send impossible even if
// this route runs twice.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const db = getSupabaseAdmin();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://club.coachmode.ai';

  // Only look at events near enough to have a reminder due. The widest rule in
  // any preset is 60 days out; 75 gives headroom for a custom one.
  const utcToday = new Date().toISOString().slice(0, 10);
  const horizon = addDays(utcToday, 75);
  const floor = addDays(utcToday, -2); // grace window for a missed run

  const { data: items } = await db
    .from('calendar_items')
    .select('id, club_id, title, description, target_date, start_time, signup_deadline, event_id, entry_fee_cents, reminder_cadence, status')
    .not('target_date', 'is', null)
    .neq('reminder_cadence', '[]')
    .neq('status', 'dropped')
    .gte('target_date', floor)
    .lte('target_date', horizon)
    .limit(500);

  const rows = (items ?? []) as any[];
  if (rows.length === 0) {
    return NextResponse.json({ checked: 0, sent: 0, results: [] });
  }

  // Club metadata, fetched once per club rather than per item.
  const clubIds = [...new Set(rows.map((r) => r.club_id))];
  const { data: clubs } = await db
    .from('cc_clubs')
    .select('id, name, timezone, owner_id')
    .in('id', clubIds);

  const ownerIds = [...new Set(((clubs ?? []) as any[]).map((c) => c.owner_id))];
  const { data: profiles } = await db
    .from('profiles')
    .select('id, email, full_name, organization_name')
    .in('id', ownerIds);

  const clubById = new Map(((clubs ?? []) as any[]).map((c) => [c.id, c]));
  const profileById = new Map(((profiles ?? []) as any[]).map((p) => [p.id, p]));

  const results: Array<Record<string, unknown>> = [];
  let sentTotal = 0;

  for (const row of rows) {
    const club = clubById.get(row.club_id);
    if (!club) continue;

    const profile = profileById.get(club.owner_id);
    // Without a reply-to address the email has nowhere to bounce a question,
    // so skip rather than send something members can't respond to.
    if (!profile?.email) continue;

    // "Today" is the club's today. A California club's day-of note must not
    // fire on the UTC rollover, which is 5pm the previous afternoon there.
    const today = utcToLocalDate(new Date(), club.timezone || 'America/Los_Angeles');

    const rules = sanitizeCadence(row.reminder_cadence);
    if (rules.length === 0) continue;

    const { data: sentRows } = await db
      .from('calendar_reminder_sends')
      .select('rule_id')
      .eq('item_id', row.id);
    const alreadySent = new Set(((sentRows ?? []) as any[]).map((s) => s.rule_id));

    const due = dueToday({
      rules,
      anchors: { eventDate: row.target_date, deadline: row.signup_deadline },
      today,
      alreadySent,
    });
    if (due.length === 0) continue;

    const ctx: ReminderContext = {
      db,
      clubId: club.id,
      clubName: profile.organization_name || club.name,
      ownerId: club.owner_id,
      ownerEmail: profile.email,
      senderName: profile.full_name || club.name,
      appUrl,
    };

    const item: ReminderItem = {
      id: row.id,
      title: row.title,
      description: row.description,
      target_date: row.target_date,
      start_time: row.start_time ? String(row.start_time).slice(0, 5) : null,
      signup_deadline: row.signup_deadline,
      event_id: row.event_id,
      entry_fee_cents: row.entry_fee_cents,
    };

    for (const d of due) {
      try {
        const out = await sendReminder(ctx, item, d.rule, {
          scheduledFor: d.sendOn!,
          triggeredBy: 'cron',
        });
        sentTotal += out.sent;
        results.push({
          item: row.title,
          rule: d.rule.id,
          tone: d.rule.tone,
          status: out.status,
          sent: out.sent,
          detail: out.detail,
        });
      } catch (e: any) {
        // One bad event must not stop the rest of the club's reminders.
        results.push({ item: row.title, rule: d.rule.id, status: 'failed', detail: e?.message });
      }
    }
  }

  return NextResponse.json({ checked: rows.length, sent: sentTotal, results });
}

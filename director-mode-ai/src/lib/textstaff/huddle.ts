import type { ClubCtx } from '@/lib/assistant/clubContext';
import { staffById } from '@/lib/proshop/staff';
import {
  CLINIC_PROGRAM_COLS, alreadySent, meetsOn, regularsFor, signupsFor, spotsLeft, startLabel,
  type ClinicProgram,
} from '@/lib/programs/clinicSignups';

/*
 * The morning huddle and the evening recap, as text messages.
 *
 * The huddle is a short numbered list of what needs the director. They reply with a
 * number to see one item, then YES or SKIP. Only things that are really waiting on
 * them get a number; everything else is one line of "what the staff is on".
 */

export type MenuItem =
  | { n: number; kind: 'task'; ref: { id: string }; label: string }
  | { n: number; kind: 'clinic_reminder' | 'clinic_spots'; ref: { program: string; date: string }; label: string };

const staffName = (id: string) => staffById(id)?.name ?? 'Your staff';

/** YYYY-MM-DD in a zone, plus `days`. */
export function dayIn(tz: string, days = 0): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const weekday = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });

export async function buildHuddle(ctx: ClubCtx): Promise<{ text: string; menu: MenuItem[] }> {
  const menu: MenuItem[] = [];
  const add = (item: Omit<MenuItem, 'n'>) => { menu.push({ ...item, n: menu.length + 1 } as MenuItem); };

  // 1. Proposals the staff prepped, waiting for a Yes.
  const { data: tasks } = await ctx.db
    .from('proshop_tasks')
    .select('id, agent, text, status, money')
    .eq('club_id', ctx.clubId)
    .in('status', ['proposed', 'waiting', 'approved', 'doing'])
    .order('created_at', { ascending: true })
    .limit(60);
  const rows = (tasks as { id: string; agent: string; text: string; status: string; money: string | null }[] | null) ?? [];
  for (const t of rows.filter((r) => r.status === 'proposed').slice(0, 5)) {
    add({ kind: 'task', ref: { id: t.id }, label: `${staffName(t.agent)}: ${t.text}${t.money ? ` (${t.money})` : ''}` });
  }
  const onIt = rows.filter((r) => r.status !== 'proposed').length;

  // 2. Clinics today and tomorrow: reminders and open spots.
  const notes: string[] = [];
  const { data: progs } = await ctx.db
    .from('club_programs')
    .select(CLINIC_PROGRAM_COLS)
    .eq('club_id', ctx.clubId)
    .eq('status', 'published')
    .limit(80);
  const today = dayIn(ctx.timeZone, 0);
  const tomorrow = dayIn(ctx.timeZone, 1);
  for (const p of ((progs as unknown as ClinicProgram[] | null) ?? [])) {
    for (const date of [today, tomorrow]) {
      if (!meetsOn(p, date, ctx.timeZone)) continue;
      const signups = await signupsFor(ctx.db, p.id, date);
      const ins = signups.filter((s) => s.status === 'in').length;
      const left = spotsLeft(p, signups);
      const when = `${date === today ? 'today' : weekday(date)} ${startLabel(p.time_start)}`;
      if (left == null && ins === 0) continue; // a class with no per-date signups in use
      if (p.auto_reminders && date === tomorrow) {
        notes.push(`${p.title} ${when}: ${ins} in${left != null ? `, ${left} open` : ''}. Reminders go out automatically.`);
        continue;
      }
      if (ins > 0 && date === tomorrow && !(await alreadySent(ctx.db, p.id, date, 'reminder'))) {
        add({ kind: 'clinic_reminder', ref: { program: p.id, date }, label: `Clinic Desk: remind the ${ins} signed up for ${p.title} ${when}` });
      }
      if (left && left > 0 && !(await alreadySent(ctx.db, p.id, date, 'spots_left'))) {
        const regs = (await regularsFor(ctx.db, p, date)).length;
        if (regs > 0) add({ kind: 'clinic_spots', ref: { program: p.id, date }, label: `Clinic Desk: ${p.title} ${when} has ${left} open. Tell ${regs} regulars` });
        else notes.push(`${p.title} ${when}: ${left} open, no regulars to tell yet.`);
      }
      if (menu.length >= 9) break;
    }
  }

  const lines: string[] = [`Morning from your ${ctx.clubName} staff.`];
  if (menu.length) {
    lines.push(menu.length === 1 ? '1 thing needs you:' : `${menu.length} things need you:`);
    for (const m of menu) lines.push(`${m.n}) ${m.label}`);
  } else {
    lines.push('Nothing needs you this morning.');
  }
  for (const n of notes.slice(0, 3)) lines.push(n);
  if (onIt) lines.push(`Your staff is working on ${onIt} order${onIt === 1 ? '' : 's'}.`);
  lines.push(menu.length ? 'Reply a number to see it, or text me anything.' : 'Text me anything you need.');
  return { text: lines.join('\n'), menu };
}

/** What the staff did since `sinceIso`. Null when nothing happened (no text is better than an empty one). */
export async function buildRecap(ctx: ClubCtx, sinceIso: string): Promise<string | null> {
  const parts: string[] = [];
  const { data: done } = await ctx.db
    .from('proshop_tasks')
    .select('agent, text, status, note')
    .eq('club_id', ctx.clubId)
    .in('status', ['done', 'approved', 'declined'])
    .gte('updated_at', sinceIso)
    .limit(40);
  const d = (done as { agent: string; text: string; status: string; note: string | null }[] | null) ?? [];
  for (const t of d.filter((x) => x.status === 'done').slice(0, 4)) parts.push(`- ${staffName(t.agent)}: ${t.note || t.text}`);
  const yes = d.filter((x) => x.status === 'approved').length;
  if (yes) parts.push(`- You said yes to ${yes} thing${yes === 1 ? '' : 's'}.`);

  const { data: sends } = await ctx.db
    .from('club_program_meeting_sends')
    .select('kind, sent_count')
    .eq('club_id', ctx.clubId)
    .gte('created_at', sinceIso);
  const s = (sends as { kind: string; sent_count: number }[] | null) ?? [];
  const rem = s.filter((x) => x.kind === 'reminder').reduce((a, x) => a + (x.sent_count || 0), 0);
  const spots = s.filter((x) => x.kind === 'spots_left').reduce((a, x) => a + (x.sent_count || 0), 0);
  if (rem) parts.push(`- Clinic Desk sent ${rem} clinic reminder${rem === 1 ? '' : 's'}.`);
  if (spots) parts.push(`- Clinic Desk told ${spots} regular${spots === 1 ? '' : 's'} about open spots.`);

  const { data: runs } = await ctx.db
    .from('clubessential_ledger_runs')
    .select('charges, total_cents, needs_you')
    .eq('club_id', ctx.clubId)
    .gte('created_at', sinceIso);
  for (const r of ((runs as { charges: unknown; total_cents: number; needs_you: unknown }[] | null) ?? []).slice(0, 2)) {
    const n = Array.isArray(r.charges) ? r.charges.length : Number(r.charges) || 0;
    parts.push(`- Ledger built a charge file: ${n} lines, $${((r.total_cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}.`);
  }

  if (!parts.length) return null;
  const { count } = await ctx.db
    .from('proshop_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('club_id', ctx.clubId)
    .eq('status', 'proposed');
  return [`Today at ${ctx.clubName}:`, ...parts, count ? `${count} thing${count === 1 ? '' : 's'} waiting on you for the morning.` : 'Nothing waiting on you.'].join('\n');
}

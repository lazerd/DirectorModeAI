/**
 * The morning digest email — built from plain data, so it can be previewed,
 * tested and sent by the same function.
 *
 * Order matters: what was missed yesterday and what is urgent come first,
 * because that is what the crew has to act on before the routine.
 */
import { longDate, shortDate, time12, hhmm } from './dates';
import { isOverdue } from './tasks';
import { DEPARTMENT_LABEL, PRIORITY_LABEL, type ISODate, type RoutineItem, type Task } from './types';
import type { ChecklistRow } from './routine';

export type DigestInput = {
  clubName: string;
  date: ISODate;
  appUrl: string;
  routineToday: ChecklistRow[];
  missedYesterday: RoutineItem[];
  /** Open + in-progress tasks, already sorted. */
  tasks: Task[];
  projects: { title: string; pct: number | null; target_date: ISODate | null }[];
};

export type Digest = { subject: string; html: string; text: string; isEmpty: boolean };

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

export function buildDigest(input: DigestInput): Digest {
  const { clubName, date, appUrl, routineToday, missedYesterday, tasks, projects } = input;
  const link = `${appUrl.replace(/\/$/, '')}/maintenance`;

  const urgentOrOverdue = tasks.filter((t) => t.priority === 'urgent' || isOverdue(t, date));
  const otherTasks = tasks.filter((t) => !urgentOrOverdue.includes(t));
  const overdueCount = tasks.filter((t) => isOverdue(t, date)).length;
  const urgentCount = tasks.filter((t) => t.priority === 'urgent').length;

  const isEmpty = routineToday.length === 0 && tasks.length === 0 && missedYesterday.length === 0;

  const extras = [
    urgentCount ? `${urgentCount} urgent` : null,
    overdueCount ? `${overdueCount} overdue` : null,
  ].filter(Boolean);
  const subject =
    `${shortDate(date)} at ${clubName}: ${routineToday.length} routine ${routineToday.length === 1 ? 'item' : 'items'}` +
    ` · ${tasks.length} open ${tasks.length === 1 ? 'task' : 'tasks'}` +
    (extras.length ? ` (${extras.join(', ')})` : '');

  const taskLine = (t: Task) => {
    const bits = [
      PRIORITY_LABEL[t.priority],
      DEPARTMENT_LABEL[t.department],
      t.location,
      isOverdue(t, date) ? `OVERDUE (due ${t.due_date})` : t.due_date ? `due ${t.due_date}` : null,
    ].filter(Boolean);
    return { html: `<strong>${esc(t.title)}</strong> <span style="color:#64748b">— ${esc(bits.join(' · '))}</span>`, text: `${t.title} — ${bits.join(' · ')}` };
  };

  const sections: { title: string; tone: string; lines: { html: string; text: string }[] }[] = [];
  if (missedYesterday.length) {
    sections.push({
      title: `Missed yesterday (${missedYesterday.length})`,
      tone: '#b45309',
      lines: missedYesterday.map((i) => ({ html: esc(i.title), text: i.title })),
    });
  }
  if (urgentOrOverdue.length) {
    sections.push({ title: 'Urgent & overdue', tone: '#b91c1c', lines: urgentOrOverdue.map(taskLine) });
  }
  if (routineToday.length) {
    sections.push({
      title: `Today's routine (${routineToday.length})`,
      tone: '#0f172a',
      lines: routineToday.map((r) => {
        const t = hhmm(r.item.target_time);
        const when = t ? `by ${time12(t)}` : 'anytime';
        const where = r.item.location ? ` · ${r.item.location}` : '';
        return {
          html: `${esc(r.item.title)} <span style="color:#64748b">— ${esc(when + where)}</span>`,
          text: `${r.item.title} — ${when}${where}`,
        };
      }),
    });
  }
  if (otherTasks.length) {
    sections.push({ title: `Other open tasks (${otherTasks.length})`, tone: '#0f172a', lines: otherTasks.map(taskLine) });
  }
  if (projects.length) {
    sections.push({
      title: 'Projects',
      tone: '#0f172a',
      lines: projects.map((p) => {
        const bits = [p.pct == null ? 'no steps yet' : `${p.pct}% done`, p.target_date ? `target ${p.target_date}` : null]
          .filter(Boolean)
          .join(' · ');
        return { html: `${esc(p.title)} <span style="color:#64748b">— ${esc(bits)}</span>`, text: `${p.title} — ${bits}` };
      }),
    });
  }

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:20px;color:#0f172a">
  <p style="margin:0;color:#64748b;font-size:13px">${esc(clubName)} · MaintenanceMode</p>
  <h1 style="margin:4px 0 16px;font-size:22px">${esc(longDate(date))}</h1>
  ${
    isEmpty
      ? '<p style="font-size:15px">Nothing on the list today.</p>'
      : sections
          .map(
            (s) => `<h2 style="margin:18px 0 6px;font-size:15px;color:${s.tone}">${esc(s.title)}</h2>
  <ul style="margin:0;padding-left:18px;font-size:15px;line-height:1.5">${s.lines.map((l) => `<li>${l.html}</li>`).join('')}</ul>`,
          )
          .join('\n  ')
  }
  <p style="margin:22px 0 0"><a href="${esc(link)}" style="display:inline-block;padding:12px 20px;background:#f59e0b;color:#0f172a;text-decoration:none;border-radius:10px;font-weight:600">Open today's checklist</a></p>
</div>`;

  const text = [
    `${clubName} — ${longDate(date)}`,
    '',
    ...(isEmpty
      ? ['Nothing on the list today.']
      : sections.flatMap((s) => [s.title.toUpperCase(), ...s.lines.map((l) => `- ${l.text}`), ''])),
    `Open today's checklist: ${link}`,
  ].join('\n');

  return { subject, html, text, isEmpty };
}

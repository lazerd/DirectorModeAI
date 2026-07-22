// Reusable "Broadcast + Nudge" campaign engine for ClubMode.
//
// A *source* (see sources.ts) resolves any surface — a tournament, a league, a
// swim season, a stringing queue, a CourtConnect event — into a CampaignData:
// who everyone is (for a broadcast update) and who's behind + on what (for a
// personalized nudge). This file owns the shared email templates and the send
// runner (preview / test / live). Copy is per-surface (a CampaignCopy), so the
// same engine sends "get your matches scheduled", "you still owe volunteer
// points", "your racket's ready for pickup", or "please RSVP".

import { sendBilledEmail } from '@/lib/email';
import { safeResendSend } from '@/lib/emailUnsubscribe';
import { Resend } from 'resend';
import { CreditLimitError } from '@/lib/billing';

const resend = new Resend(process.env.RESEND_API_KEY);
const RESEND_DOMAIN = 'noreply@mail.coachmode.ai'; // verified sending domain
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type SendMode = 'preview' | 'test' | 'live';
export type CampaignKind = 'update' | 'nudge';

export type Person = { email: string; firstName: string; ctaUrl?: string };
export type Outstanding = { label: string; contact: string; sub?: string };
export type NudgePerson = Person & { played: number | null; target: number | null; outstanding: Outstanding[] };

export type CampaignCopy = {
  updateSubject: string;
  updateIntro: string; // opening line of the update body (after "Hi {name} —")
  nudgeSubject: string;
  nudgeLead: (n: number, playedLine: string) => string; // per-recipient nudge sentence (HTML)
  nudgeTip?: (n: number) => string; // optional 💡 line
  reachOutLabel?: string; // default "Reach out:"; per-item, only shown when contact present
};

export type CampaignData = {
  ownerId: string; // bill + (already) authorized director
  clubName: string; // branding — becomes the From name
  senderName: string; // sign-off line
  replyTo: string; // director's email (also the "send test to me" target)
  title: string; // activity name, e.g. "Summer Flex League" or a tournament name
  liveUrl: string; // default public standings/results page ('' = no button)
  liveUrlLabel: string; // CTA button label
  deadlineNote: string | null; // e.g. "Round 2 wraps up July 26"
  stats: { label: string; value: string }[]; // status board for the update email
  everyone: Person[]; // broadcast recipients (empty = update disabled)
  nudge: NudgePerson[]; // only people who still owe an action
  copy: CampaignCopy;
};

const esc = (s: string) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fromLine = (clubName: string) => `${clubName.replace(/["<>]/g, '')} <${RESEND_DOMAIN}>`;

/** Standard match-surface copy (tournaments, quads, leagues). */
export function matchCopy(activityNoun: string): CampaignCopy {
  return {
    updateSubject: '', // filled per-source with the title
    updateIntro: '',
    nudgeSubject: `Quick nudge — get your ${activityNoun} matches scheduled 🎾`,
    nudgeLead: (n, played) =>
      `Just a gentle nudge to keep things on track! You've got <strong>${n} match${n === 1 ? '' : 'es'}</strong> ready to play that ${n === 1 ? "hasn't" : "haven't"} been scheduled yet${played}. Please reach out and find a time that works.`,
    nudgeTip: (n) => `You can play ${n === 1 ? 'it' : 'any of these'} <strong>right now</strong> — no need to wait. Once your score is in, standings update instantly.`,
    reachOutLabel: 'Reach out:',
  };
}

const shell = (clubName: string, inner: string) => `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2937;line-height:1.55;max-width:640px;margin:0 auto">
  <div style="background:linear-gradient(160deg,#1F4FA0,#163670);border-radius:14px 14px 0 0;padding:20px 26px;color:#fff">
    <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#FFD24F;font-weight:700">${esc(clubName)}</div>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 14px 14px;padding:22px 26px">${inner}</div>
</div>`;

const button = (href: string, label: string) =>
  href
    ? `<p style="margin:16px 0"><a href="${href}" style="display:inline-block;background:#16a34a;color:#fff;font-weight:700;text-decoration:none;padding:13px 24px;border-radius:9px;font-size:16px">${esc(label)}</a></p>`
    : '';

export function updateEmailHtml(d: CampaignData, person: Person): { subject: string; html: string } {
  const url = person.ctaUrl || d.liveUrl;
  const statRows = d.stats
    .map(
      (s) =>
        `<tr><td style="padding:5px 14px 5px 0;font-weight:700;white-space:nowrap">${esc(s.label)}</td><td style="padding:5px 0;color:#374151">${esc(s.value)}</td></tr>`
    )
    .join('');
  const inner = `<p>Hi ${esc(person.firstName)} —</p>
    <p>${esc(d.copy.updateIntro || `A quick check-in on the ${d.title}.`)}</p>
    ${statRows ? `<table style="border-collapse:collapse;margin:12px 0 4px;background:#eff4fc;border:1px solid #cfe0fc;border-radius:10px;padding:6px">${statRows}</table>` : ''}
    ${d.deadlineNote ? `<p style="margin-top:14px">${esc(d.deadlineNote)}. A friendly reminder: <strong>you don't have to wait</strong> — go ahead early if you can.</p>` : ''}
    ${button(url, d.liveUrlLabel)}
    ${url ? `<p style="font-size:13px;color:#6b7280">Everything's live here: <a href="${url}" style="color:#1F4FA0">${esc(url.replace(/^https?:\/\//, ''))}</a></p>` : ''}
    <p>Questions, or something off with your spot? Just reply to this email.</p>
    <p style="margin:2px 0 0">— ${esc(d.senderName)}</p>`;
  return { subject: d.copy.updateSubject || `${d.title} — Update`, html: shell(d.clubName, inner) };
}

export function nudgeEmailHtml(d: CampaignData, p: NudgePerson): { subject: string; html: string } {
  const url = p.ctaUrl || d.liveUrl;
  const n = p.outstanding.length;
  const reach = d.copy.reachOutLabel ?? 'Reach out:';
  const items = p.outstanding
    .map(
      (o) => `<div style="margin:7px 0;padding:10px 14px;background:#f6f8fb;border:1px solid #e5e7eb;border-radius:8px">
        <div style="font-weight:700">${esc(o.label)}</div>
        ${o.sub ? `<div style="font-size:12px;color:#6b7280;margin-top:2px">${esc(o.sub)}</div>` : ''}
        ${o.contact ? `<div style="font-size:13px;color:#374151;margin-top:3px">${esc(reach)} ${esc(o.contact)}</div>` : ''}</div>`
    )
    .join('');
  const playedLine =
    p.played !== null && p.target !== null
      ? ` <span style="font-weight:600;color:#6b7280;font-size:14px">— you're at ${p.played} of ${p.target}</span>`
      : '';
  const inner = `<p>Hi ${esc(p.firstName)} —</p>
    <p>${d.copy.nudgeLead(n, playedLine)}</p>
    ${items}
    ${d.copy.nudgeTip ? `<p style="margin-top:16px;font-size:14px;color:#374151">💡 ${d.copy.nudgeTip(n)}</p>` : ''}
    ${button(url, d.liveUrlLabel)}
    <p style="font-size:13px;color:#6b7280">Something off, or already handled? Just reply and let me know. Thanks!</p>
    <p style="margin:2px 0 0">— ${esc(d.senderName)}</p>`;
  return { subject: d.copy.nudgeSubject, html: shell(d.clubName, inner) };
}

export type CampaignResult =
  | { mode: 'preview'; kind: CampaignKind; count: number; recipients: unknown[]; subject?: string; sampleHtml?: string; sampleFor?: string }
  | { mode: 'test'; kind: CampaignKind; to: string; sent: boolean; sampleFor?: string; note?: string }
  | { mode: 'live'; kind: CampaignKind; attempted: number; sent: number; failures: { email: string; reason: string }[]; creditLimited?: boolean };

/** Preview / test / live for a resolved campaign. */
export async function runCampaign(d: CampaignData, kind: CampaignKind, mode: SendMode): Promise<CampaignResult> {
  const build = (person: Person | NudgePerson) =>
    kind === 'update' ? updateEmailHtml(d, person) : nudgeEmailHtml(d, person as NudgePerson);
  const list: (Person | NudgePerson)[] = kind === 'update' ? d.everyone : d.nudge;
  const from = fromLine(d.clubName);

  if (mode === 'preview') {
    const sample = list[0] ? build(list[0]) : null;
    return {
      mode: 'preview',
      kind,
      count: list.length,
      recipients:
        kind === 'update'
          ? (list as Person[]).map((r) => r.email)
          : (list as NudgePerson[]).map((r) => ({ email: r.email, outstanding: r.outstanding.length })),
      subject: sample?.subject,
      sampleHtml: sample?.html,
      sampleFor: list[0]?.email,
    };
  }

  if (mode === 'test') {
    if (!list[0]) return { mode: 'test', kind, to: d.replyTo, sent: false, note: 'no recipients right now' };
    const { subject, html } = build(list[0]);
    const res = await safeResendSend(resend, {
      from,
      to: d.replyTo,
      replyTo: d.replyTo,
      subject: `[TEST${kind === 'nudge' ? ` → ${list[0].email}` : ''}] ${subject}`,
      html,
    });
    return { mode: 'test', kind, to: d.replyTo, sent: res.sent, sampleFor: list[0].email };
  }

  // live — sequential + throttled; bill each to the owner; stop cleanly on credit cap
  let sent = 0;
  const failures: { email: string; reason: string }[] = [];
  let creditLimited = false;
  for (const person of list) {
    const { subject, html } = build(person);
    try {
      const res = await sendBilledEmail(d.ownerId, { from, to: person.email, replyTo: d.replyTo, subject, html });
      if (res.sent) sent++;
      else failures.push({ email: person.email, reason: res.reason });
    } catch (e) {
      if (e instanceof CreditLimitError) {
        creditLimited = true;
        break;
      }
      failures.push({ email: person.email, reason: (e as Error).message });
    }
    await sleep(600);
  }
  return { mode: 'live', kind, attempted: list.length, sent, failures, creditLimited };
}

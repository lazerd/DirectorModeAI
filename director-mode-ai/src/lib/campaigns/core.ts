// Reusable "Broadcast + Nudge" campaign engine for ClubMode.
//
// A *source* (see sources.ts) resolves any surface — a tournament, a quad, a
// league — into a CampaignData: who everyone is (for a broadcast update) and
// who's behind + on what (for a personalized nudge). This file owns the shared
// email templates and the send runner (preview / test / live), so every surface
// gets the same polished, unsubscribe-safe, per-director-billed send for free.

import { sendBilledEmail } from '@/lib/email';
import { safeResendSend } from '@/lib/emailUnsubscribe';
import { Resend } from 'resend';
import { CreditLimitError } from '@/lib/billing';

const resend = new Resend(process.env.RESEND_API_KEY);
const RESEND_DOMAIN = 'noreply@mail.coachmode.ai'; // verified sending domain
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type SendMode = 'preview' | 'test' | 'live';
export type CampaignKind = 'update' | 'nudge';

export type Person = { email: string; firstName: string };
export type Outstanding = { label: string; contact: string; sub?: string };
export type NudgePerson = Person & { played: number | null; target: number | null; outstanding: Outstanding[] };

export type CampaignData = {
  ownerId: string; // bill + (already) authorized director
  clubName: string; // branding — becomes the From name
  senderName: string; // sign-off line
  replyTo: string; // director's email (also the "send test to me" target)
  title: string; // activity name, e.g. "Summer Flex League" or a tournament name
  activityNoun: string; // "tournament" | "league" | "event"
  liveUrl: string; // public standings/results page
  liveUrlLabel: string; // CTA button label
  deadlineNote: string | null; // e.g. "Round 2 wraps up July 26"
  stats: { label: string; value: string }[]; // status board for the update email
  everyone: Person[]; // broadcast recipients
  nudge: NudgePerson[]; // only people who still owe an action
};

const esc = (s: string) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fromLine = (clubName: string) => `${clubName.replace(/["<>]/g, '')} <${RESEND_DOMAIN}>`;

const shell = (clubName: string, inner: string) => `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2937;line-height:1.55;max-width:640px;margin:0 auto">
  <div style="background:linear-gradient(160deg,#1F4FA0,#163670);border-radius:14px 14px 0 0;padding:20px 26px;color:#fff">
    <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#FFD24F;font-weight:700">${esc(clubName)}</div>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 14px 14px;padding:22px 26px">${inner}</div>
</div>`;

const button = (href: string, label: string) =>
  `<p style="margin:16px 0"><a href="${href}" style="display:inline-block;background:#16a34a;color:#fff;font-weight:700;text-decoration:none;padding:13px 24px;border-radius:9px;font-size:16px">${esc(label)}</a></p>`;

export function updateEmailHtml(d: CampaignData, firstName: string): { subject: string; html: string } {
  const statRows = d.stats
    .map(
      (s) =>
        `<tr><td style="padding:5px 14px 5px 0;font-weight:700;white-space:nowrap">${esc(s.label)}</td><td style="padding:5px 0;color:#374151">${esc(s.value)}</td></tr>`
    )
    .join('');
  const inner = `<p>Hi ${esc(firstName)} —</p>
    <p>A quick check-in on the <strong>${esc(d.title)}</strong>. Here's where things stand${d.deadlineNote ? `, and a heads-up on what's next` : ''}:</p>
    ${statRows ? `<table style="border-collapse:collapse;margin:12px 0 4px;background:#eff4fc;border:1px solid #cfe0fc;border-radius:10px;padding:6px">${statRows}</table>` : ''}
    ${d.deadlineNote ? `<p style="margin-top:14px">${esc(d.deadlineNote)}. A friendly reminder: <strong>you don't have to wait</strong> — if your next opponent is free, go ahead and play early.</p>` : ''}
    ${button(d.liveUrl, d.liveUrlLabel)}
    <p style="font-size:13px;color:#6b7280">Standings update live as scores come in: <a href="${d.liveUrl}" style="color:#1F4FA0">${esc(d.liveUrl.replace(/^https?:\/\//, ''))}</a></p>
    <p>Questions, or something off with your spot? Just reply to this email. See you out there!</p>
    <p style="margin:2px 0 0">— ${esc(d.senderName)}</p>`;
  return { subject: `${d.title} — Update`, html: shell(d.clubName, inner) };
}

export function nudgeEmailHtml(d: CampaignData, p: NudgePerson): { subject: string; html: string } {
  const n = p.outstanding.length;
  const items = p.outstanding
    .map(
      (o) => `<div style="margin:7px 0;padding:10px 14px;background:#f6f8fb;border:1px solid #e5e7eb;border-radius:8px">
        <div style="font-weight:700">${esc(o.label)}</div>
        ${o.sub ? `<div style="font-size:12px;color:#6b7280;margin-top:2px">${esc(o.sub)}</div>` : ''}
        <div style="font-size:13px;color:#374151;margin-top:3px">Reach out: ${o.contact ? esc(o.contact) : '<em>contact on the live page</em>'}</div></div>`
    )
    .join('');
  const playedLine =
    p.played !== null && p.target !== null
      ? ` <span style="font-weight:600;color:#6b7280;font-size:14px">— you've played ${p.played} of ${p.target}</span>`
      : '';
  const inner = `<p>Hi ${esc(p.firstName)} —</p>
    <p>Just a gentle nudge to keep the <strong>${esc(d.title)}</strong> on track! You've got <strong>${n} match${n === 1 ? '' : 'es'}</strong> ready to play that ${n === 1 ? "hasn't" : "haven't"} been scheduled yet${playedLine}. ${d.deadlineNote ? esc(d.deadlineNote) + ' — p' : 'P'}lease reach out and find a time that works.</p>
    ${items}
    <p style="margin-top:16px;font-size:14px;color:#374151">💡 You can play ${n === 1 ? 'it' : 'any of these'} <strong>right now</strong> — no need to wait. Once your score is in, standings update instantly.</p>
    ${button(d.liveUrl, d.liveUrlLabel)}
    <p style="font-size:13px;color:#6b7280">Already played and just need to log it? Do it on the <a href="${d.liveUrl}" style="color:#1F4FA0">live page</a>. Something off with a matchup? Just reply. Thanks!</p>
    <p style="margin:2px 0 0">— ${esc(d.senderName)}</p>`;
  return { subject: `Quick nudge — get your ${d.activityNoun} matches scheduled 🎾`, html: shell(d.clubName, inner) };
}

export type CampaignResult =
  | { mode: 'preview'; kind: CampaignKind; count: number; recipients: unknown[]; subject?: string; sampleHtml?: string; sampleFor?: string }
  | { mode: 'test'; kind: CampaignKind; to: string; sent: boolean; sampleFor?: string; note?: string }
  | { mode: 'live'; kind: CampaignKind; attempted: number; sent: number; failures: { email: string; reason: string }[]; creditLimited?: boolean };

/** Preview / test / live for a resolved campaign. */
export async function runCampaign(d: CampaignData, kind: CampaignKind, mode: SendMode): Promise<CampaignResult> {
  const build = (person: Person | NudgePerson) =>
    kind === 'update' ? updateEmailHtml(d, person.firstName) : nudgeEmailHtml(d, person as NudgePerson);
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
    // preview-render for a real recipient, but deliver only to the director (no billing)
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

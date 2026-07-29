/**
 * CaptainMode player emails.
 *
 * Every player-facing link is tokenized and login-free — players never have an
 * account. All sends go through sendBilledEmail(s) so credits and unsubscribe
 * handling stay consistent with the rest of the app.
 */
import { sendBilledEmails, type SafeSendResult } from '@/lib/email';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://club.coachmode.ai';

const BRAND = '#D3FB52';
const INK = '#0f172a';

export type MatchInfo = {
  id: string;
  matchAt: string;
  isHome: boolean;
  opponent?: string | null;
  location?: string | null;
  arrivalNote?: string | null;
  opposingCaptainName?: string | null;
  opposingCaptainPhone?: string | null;
};

export type Recipient = { playerId: string; name: string; email: string; token: string };

export function formatMatchWhen(matchAt: string, timeZone?: string): string {
  const d = new Date(matchAt);
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timeZone || undefined,
  }).format(d);
}

function shell(title: string, body: string, footer?: string): string {
  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:${INK}">
    <h1 style="font-size:20px;margin:0 0 16px">${title}</h1>
    ${body}
    ${footer ? `<p style="font-size:12px;color:#64748b;margin-top:24px">${footer}</p>` : ''}
  </div>`;
}

function button(href: string, label: string, bg: string, color = '#0f172a'): string {
  return `<a href="${href}" style="display:inline-block;padding:14px 22px;margin:4px 6px 4px 0;background:${bg};color:${color};text-decoration:none;border-radius:10px;font-weight:600;font-size:16px">${label}</a>`;
}

function matchLines(m: MatchInfo, tz?: string): string {
  const bits = [
    `<strong>${formatMatchWhen(m.matchAt, tz)}</strong>`,
    m.opponent ? `vs ${m.opponent}` : null,
    m.isHome ? 'home' : 'away',
  ].filter(Boolean);
  const extra = [
    m.location ? `📍 ${m.location}` : null,
    m.arrivalNote || null,
    m.opposingCaptainName
      ? `Opposing captain: ${m.opposingCaptainName}${m.opposingCaptainPhone ? ` · ${m.opposingCaptainPhone}` : ''}`
      : null,
  ].filter(Boolean);
  return `
    <p style="font-size:16px;margin:0 0 8px">${bits.join(' · ')}</p>
    ${extra.length ? `<p style="font-size:14px;color:#475569;margin:0 0 16px">${extra.join('<br>')}</p>` : ''}`;
}

/** Availability poll — one tap, no login. */
export function availabilityEmail(
  team: string,
  m: MatchInfo,
  r: Recipient,
  tz?: string,
): { to: string; subject: string; html: string } {
  const link = `${BASE}/captain/availability/${r.token}`;
  return {
    to: r.email,
    subject: `${team}: can you play ${formatMatchWhen(m.matchAt, tz)}?`,
    html: shell(
      `Hi ${r.name} — can you play?`,
      `${matchLines(m, tz)}
       <div style="margin:20px 0">
         ${button(`${link}?m=${m.id}&r=yes`, '✓ Yes', BRAND)}
         ${button(`${link}?m=${m.id}&r=no`, '✗ No', '#e2e8f0')}
         ${button(`${link}?m=${m.id}&r=maybe`, '? Maybe', '#e2e8f0')}
       </div>
       <p style="font-size:14px;color:#475569">Or <a href="${link}" style="color:#0369a1">see your whole schedule</a>.</p>`,
      'One tap — no login needed.',
    ),
  };
}

/** Reminder to players who never answered the poll. */
export function nudgeEmail(
  team: string,
  m: MatchInfo,
  r: Recipient,
  tz?: string,
): { to: string; subject: string; html: string } {
  const link = `${BASE}/captain/availability/${r.token}`;
  return {
    to: r.email,
    subject: `Still need your answer — ${team} ${formatMatchWhen(m.matchAt, tz)}`,
    html: shell(
      `${r.name}, your captain still needs an answer`,
      `${matchLines(m, tz)}
       <div style="margin:20px 0">
         ${button(`${link}?m=${m.id}&r=yes`, '✓ Yes', BRAND)}
         ${button(`${link}?m=${m.id}&r=no`, '✗ No', '#e2e8f0')}
         ${button(`${link}?m=${m.id}&r=maybe`, '? Maybe', '#e2e8f0')}
       </div>`,
      'One tap — no login needed.',
    ),
  };
}

/** Pre-season intake — partners, side, days out. Sent once before the season. */
export function preseasonIntakeEmail(
  team: string,
  r: Recipient,
  opts?: { reminder?: boolean },
): { to: string; subject: string; html: string } {
  const link = `${BASE}/captain/intake/${r.token}`;
  const reminder = opts?.reminder === true;
  return {
    to: r.email,
    subject: reminder
      ? `Still need your answers — ${team}`
      : `${team}: a minute of setup before the season`,
    html: shell(
      reminder ? `${r.name}, your captain is still waiting` : `Hi ${r.name} — welcome to ${team}`,
      `<p style="font-size:16px;margin:0 0 8px">
         Before the season starts, tell your captain how you like to play. It takes a minute and it
         shapes every lineup you get put in.
       </p>
       <p style="font-size:14px;color:#475569;margin:0 0 16px">
         Who you partner best with (in order) · which side you return on ·
         any days you can never play · anything else we should know.
       </p>
       <div style="margin:20px 0">${button(link, 'Fill this in', BRAND)}</div>
       <p style="font-size:14px;color:#475569">
         You can come back to the same link any time to change your answers.
       </p>`,
      'No login needed — this link is yours.',
    ),
  };
}

export type LineupRow = {
  courtNumber: number;
  courtType: 'singles' | 'doubles';
  names: string[];
};

/**
 * Lineup, 7 days out. Goes to the WHOLE team so nobody has to ask whether
 * they're playing; players who are in it get a Confirm button.
 */
export function lineupEmail(
  team: string,
  m: MatchInfo,
  rows: LineupRow[],
  r: Recipient,
  isPlaying: boolean,
  tz?: string,
): { to: string; subject: string; html: string } {
  const table = rows
    .map(
      (row) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;white-space:nowrap;color:#64748b;font-size:13px">
          ${row.courtType === 'singles' ? 'Singles' : 'Doubles'} ${row.courtNumber}
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:15px">${row.names.join(' / ')}</td>
      </tr>`,
    )
    .join('');

  const confirm = isPlaying
    ? `<div style="margin:20px 0">
         ${button(`${BASE}/captain/confirm/${r.token}/${m.id}`, "✓ I'll be there", BRAND)}
       </div>
       <p style="font-size:14px;color:#475569">You're in this lineup — please confirm so your captain knows.</p>`
    : `<p style="font-size:14px;color:#475569">You're not in this lineup, but here it is so you're in the loop.</p>`;

  return {
    to: r.email,
    subject: `${team} lineup — ${formatMatchWhen(m.matchAt, tz)}`,
    html: shell(
      'Here’s the lineup',
      `${matchLines(m, tz)}
       <table style="width:100%;border-collapse:collapse;margin:12px 0">${table}</table>
       ${confirm}`,
    ),
  };
}

/** Day-before reminder for players who are actually playing. */
export function matchReminderEmail(
  team: string,
  m: MatchInfo,
  r: Recipient,
  yourCourt: string | null,
  tz?: string,
): { to: string; subject: string; html: string } {
  return {
    to: r.email,
    subject: `Tomorrow: ${team} ${formatMatchWhen(m.matchAt, tz)}`,
    html: shell(
      `See you tomorrow, ${r.name}`,
      `${matchLines(m, tz)}
       ${yourCourt ? `<p style="font-size:16px;margin:8px 0"><strong>You're on ${yourCourt}</strong></p>` : ''}`,
    ),
  };
}

/**
 * Sub blast — goes to every eligible sub at once. First to tap Claim gets it;
 * the claim route resolves the race in a single UPDATE.
 */
export function subRequestEmail(
  team: string,
  m: MatchInfo,
  requestToken: string,
  r: Recipient,
  tz?: string,
): { to: string; subject: string; html: string } {
  const link = `${BASE}/captain/claim/${requestToken}/${r.token}`;
  return {
    to: r.email,
    subject: `Can you sub for ${team}? ${formatMatchWhen(m.matchAt, tz)}`,
    html: shell(
      `${r.name} — we need a sub`,
      `${matchLines(m, tz)}
       <div style="margin:20px 0">${button(link, '✓ I can play — claim this spot', BRAND)}</div>
       <p style="font-size:14px;color:#475569">First to claim gets the spot, so tap quickly if you can make it.</p>`,
    ),
  };
}

export async function sendAll(
  billingUserId: string | null,
  payloads: { to: string; subject: string; html: string }[],
): Promise<SafeSendResult[]> {
  if (!payloads.length) return [];
  return sendBilledEmails(billingUserId, payloads);
}

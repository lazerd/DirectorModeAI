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

/**
 * Club time. NEVER fall back to `undefined` here: that means "the runtime's own
 * timezone", which on Vercel is UTC — a 9:30am match then goes out to the whole
 * roster as "4:30 PM". Every formatter in this file defaults to club time so a
 * caller cannot silently ship the wrong hour by forgetting an argument.
 */
export const CLUB_TZ = 'America/Los_Angeles';

export function formatMatchWhen(matchAt: string, timeZone?: string): string {
  const d = new Date(matchAt);
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timeZone || CLUB_TZ,
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

/**
 * Captain-authored overrides for one email kind.
 *
 * Deliberately narrow: a captain may retitle an email and add a note at the
 * top, but never hand-edit the body. The tokenized Yes/No/Maybe buttons, the
 * confirm link and the unsubscribe footer are the parts that actually make
 * these emails work, and a free-form HTML editor is the fastest way to lose
 * them. Everything below the note stays generated.
 */
export type EmailCustom = { subject?: string | null; intro?: string | null };

export type EmailVars = {
  team: string;
  name: string;
  when: string;
  opponent: string;
  home_away: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** {team}, {name}, {when}, {opponent}, {home_away} — anything else is left alone. */
export function renderTemplate(tpl: string, vars: EmailVars): string {
  return tpl.replace(/\{(team|name|when|opponent|home_away)\}/g, (_, k) => vars[k as keyof EmailVars] ?? '');
}

function subjectOf(c: EmailCustom | undefined, fallback: string, vars: EmailVars): string {
  const t = (c?.subject || '').trim();
  return t ? renderTemplate(t, vars) : fallback;
}

/** Captain's note, rendered above the generated body. */
function introBlock(c: EmailCustom | undefined, vars: EmailVars): string {
  const raw = (c?.intro || '').trim();
  if (!raw) return '';
  const html = escapeHtml(renderTemplate(raw, vars)).replace(/\n/g, '<br>');
  return `<p style="font-size:16px;line-height:1.5;margin:0 0 16px;padding:12px 14px;background:#f8fafc;border-left:3px solid ${BRAND};border-radius:4px">${html}</p>`;
}

function varsFor(team: string, name: string, m: MatchInfo, tz?: string): EmailVars {
  return {
    team,
    name,
    when: formatMatchWhen(m.matchAt, tz),
    opponent: m.opponent || 'TBD',
    home_away: m.isHome ? 'home' : 'away',
  };
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
  c?: EmailCustom,
): { to: string; subject: string; html: string } {
  const link = `${BASE}/captain/availability/${r.token}`;
  const vars = varsFor(team, r.name, m, tz);
  return {
    to: r.email,
    subject: subjectOf(c, `${team}: can you play ${formatMatchWhen(m.matchAt, tz)}?`, vars),
    html: shell(
      `Hi ${r.name} — can you play?`,
      `${introBlock(c, vars)}${matchLines(m, tz)}
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
  c?: EmailCustom,
): { to: string; subject: string; html: string } {
  const link = `${BASE}/captain/availability/${r.token}`;
  const vars = varsFor(team, r.name, m, tz);
  return {
    to: r.email,
    subject: subjectOf(c, `Still need your answer — ${team} ${formatMatchWhen(m.matchAt, tz)}`, vars),
    html: shell(
      `${r.name}, your captain still needs an answer`,
      `${introBlock(c, vars)}${matchLines(m, tz)}
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
  c?: EmailCustom,
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

  const vars = varsFor(team, r.name, m, tz);
  return {
    to: r.email,
    subject: subjectOf(c, `${team} lineup — ${formatMatchWhen(m.matchAt, tz)}`, vars),
    html: shell(
      'Here’s the lineup',
      `${introBlock(c, vars)}${matchLines(m, tz)}
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
  c?: EmailCustom,
): { to: string; subject: string; html: string } {
  const vars = varsFor(team, r.name, m, tz);
  return {
    to: r.email,
    subject: subjectOf(c, `Tomorrow: ${team} ${formatMatchWhen(m.matchAt, tz)}`, vars),
    html: shell(
      `See you tomorrow, ${r.name}`,
      `${introBlock(c, vars)}${matchLines(m, tz)}
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

/**
 * Season-wide availability request — one email covering the whole schedule.
 * Cheaper than nine per-match polls and it lets a player block out the season in
 * a single sitting, which is what actually gets a roster to 100%.
 */
export function seasonAvailabilityEmail(
  team: string,
  matches: MatchInfo[],
  r: Recipient,
  opts?: { tz?: string; reminder?: boolean; answered?: number },
): { to: string; subject: string; html: string } {
  const tz = opts?.tz;
  const link = `${BASE}/captain/availability/${r.token}`;
  const left = opts?.answered != null ? matches.length - opts.answered : matches.length;

  const rows = matches
    .map((m) => {
      const d = new Date(m.matchAt);
      const day = new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        timeZone: tz || CLUB_TZ,
      }).format(d);
      const time = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: tz || CLUB_TZ,
      }).format(d);
      const where = [m.isHome ? 'Home' : 'Away', m.location || m.opponent || null]
        .filter(Boolean)
        .join(' · ');
      return `
        <tr>
          <td style="padding:10px 10px 10px 0;border-bottom:1px solid #e2e8f0;font-size:15px;font-weight:700;color:${INK};white-space:nowrap">${day}</td>
          <td style="padding:10px;border-bottom:1px solid #e2e8f0;font-size:15px;font-weight:700;color:${INK};white-space:nowrap">${time}</td>
          <td style="padding:10px 0 10px 10px;border-bottom:1px solid #e2e8f0;font-size:14px;color:#475569">
            ${m.opponent ? `vs ${m.opponent}<br>` : ''}<span style="color:#64748b">${where}</span>
          </td>
        </tr>`;
    })
    .join('');

  const title = opts?.reminder
    ? `${r.name}, we still need ${left} date${left === 1 ? '' : 's'} from you`
    : `Hi ${r.name} — your ${team} availability`;

  return {
    to: r.email,
    subject: opts?.reminder
      ? `Reminder: ${team} availability (${left} date${left === 1 ? '' : 's'} left)`
      : `${team}: mark your availability for all ${matches.length} matches`,
    html: shell(
      title,
      `<p style="font-size:16px;line-height:1.5;margin:0 0 18px">
         The schedule is final. Open your personal page and tap <strong>Yes</strong>,
         <strong>No</strong>, or <strong>Maybe</strong> for each of the ${matches.length} match dates
         below. It takes about a minute, and you can change an answer any time.
       </p>
       <div style="margin:0 0 24px">${button(link, `Enter my availability →`, BRAND)}</div>
       <table style="border-collapse:collapse;width:100%;margin:0 0 8px">
         <tr>
           <th align="left" style="padding:0 10px 6px 0;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#64748b">Date</th>
           <th align="left" style="padding:0 10px 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#64748b">Time</th>
           <th align="left" style="padding:0 0 6px 10px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#64748b">Match</th>
         </tr>
         ${rows}
       </table>
       <p style="font-size:14px;color:#475569;margin:18px 0 0">
         No login, no app — the link above is yours for the whole season. Bookmark it.
       </p>`,
      'Sent by your captain through ClubMode.',
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

/**
 * CaptainMode player emails.
 *
 * Every player-facing link is tokenized and login-free — players never have an
 * account. All sends go through sendBilledEmail(s) so credits and unsubscribe
 * handling stay consistent with the rest of the app.
 */
import { sendBilledEmails, type SafeSendResult } from '@/lib/email';
import { CLUB_TZ } from './clubTime';
import { googleCalendarUrl, matchEvent } from './calendar';

import { APP_URL } from '@/lib/appUrl';
const BASE = APP_URL;

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
 * Every formatter in this file defaults to club time so a caller cannot
 * silently ship the wrong hour by forgetting an argument. Re-exported because
 * it used to be declared here; the constant now lives in ./clubTime so the
 * calendar builder can read it without importing this module back.
 */
export { CLUB_TZ };

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

  const yourCourt =
    rows.find((row) => row.names.includes(r.name)) ?? null;
  const courtLabel = yourCourt
    ? `${yourCourt.courtType === 'singles' ? 'Singles' : 'Doubles'} ${yourCourt.courtNumber}`
    : null;

  const confirm = isPlaying
    ? `<div style="margin:20px 0 8px">
         ${button(`${BASE}/api/captain/confirm/${r.token}/${m.id}/yes`, "✓ Yes — I'll be there", BRAND)}
         ${button(`${BASE}/captain/confirm/${r.token}/${m.id}?a=out`, '✗ Sorry — I can’t play', '#fee2e2', '#991b1b')}
       </div>
       <p style="font-size:14px;color:#475569;margin:0 0 4px">
         You're in this lineup — please tap one so your captain knows. If you have to pull out,
         say so now and your captain can find a sub while there's still time.
       </p>
       ${calendarBlock(team, m, courtLabel, r.token)}`
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

/**
 * Add-to-calendar pair. Two links because no email client will tell us which
 * ecosystem the reader is in: Google takes a TEMPLATE url, Apple and Outlook
 * take a served .ics. Both carry the court, the location and the arrival note,
 * so the event on the player's phone is the whole briefing.
 */
function calendarBlock(
  team: string,
  m: MatchInfo,
  court: string | null,
  token: string,
): string {
  const gcal = googleCalendarUrl(matchEvent(team, m, court));
  const ics = `${BASE}/api/captain/calendar/${token}/${m.id}`;
  return `
    <div style="margin:18px 0 4px;padding-top:16px;border-top:1px solid #e2e8f0">
      <p style="font-size:13px;color:#64748b;margin:0 0 8px;text-transform:uppercase;letter-spacing:.06em">
        Put it on your calendar
      </p>
      ${button(gcal, '📅 Google Calendar', '#e2e8f0')}
      ${button(ics, '📅 Apple / Outlook', '#e2e8f0')}
      <p style="font-size:12px;color:#94a3b8;margin:6px 0 0">
        Includes your court, the address and the arrival time, with reminders the night
        before and an hour out.
      </p>
    </div>`;
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
       ${yourCourt ? `<p style="font-size:16px;margin:8px 0"><strong>You're on ${yourCourt}</strong></p>` : ''}
       ${calendarBlock(team, m, yourCourt, r.token)}
       <p style="font-size:13px;color:#64748b;margin:14px 0 0">
         Something come up? <a href="${BASE}/captain/confirm/${r.token}/${m.id}?a=out" style="color:#b91c1c">Let your captain know you can't make it</a>.
       </p>`,
    ),
  };
}

/**
 * Straight to the captain the moment a player pulls out of a committed lineup.
 * This is the whole point of the decline button — a withdrawal that sits unread
 * in a group text until match morning is worse than no button at all.
 */
export function withdrawalAlertEmail(
  to: string,
  team: string,
  m: MatchInfo,
  playerName: string,
  court: string | null,
  note: string | null,
  teamId: string,
  tz?: string,
): { to: string; subject: string; html: string } {
  return {
    to,
    subject: `${playerName} pulled out — ${team} ${formatMatchWhen(m.matchAt, tz)}`,
    html: shell(
      `${playerName} can’t play`,
      `${matchLines(m, tz)}
       <p style="font-size:16px;margin:0 0 8px">
         <strong>${escapeHtml(playerName)}</strong> was in the lineup${court ? ` on <strong>${court}</strong>` : ''}
         and has just withdrawn.
       </p>
       ${
         note
           ? `<p style="font-size:15px;margin:0 0 16px;padding:12px 14px;background:#f8fafc;border-left:3px solid #fca5a5;border-radius:4px">
                “${escapeHtml(note)}”
              </p>`
           : ''
       }
       <p style="font-size:14px;color:#475569;margin:0 0 16px">
         Their availability for this match is now <strong>No</strong>, so the lineup builder won't
         put them back. Open the match to slot someone else in or blast the subs.
       </p>
       <div style="margin:8px 0">
         ${button(`${BASE}/captain/${teamId}/match/${m.id}`, 'Open the match →', BRAND)}
       </div>`,
      'Sent automatically by CaptainMode.',
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

/**
 * The pre-match note to the OPPOSING captain when we're hosting.
 *
 * Unlike every other email in this file, the recipient is not one of our
 * players and has no token — they are a captain at another club. So there are
 * no Yes/No buttons, no confirm link and no unsubscribe footer: this is a
 * person-to-person courtesy note, and dressing it up as a system email makes it
 * read worse, not better.
 *
 * `hostNotes` is the venue blurb (parking, ice, restrooms, warmup courts) and
 * lives on the team, because it is identical for every home match and nobody
 * should retype it eight times a season.
 */
export function opponentHostingEmail(
  team: string,
  m: MatchInfo,
  opts: {
    to: string;
    opposingCaptainName?: string | null;
    clubName: string;
    address?: string | null;
    hostNotes?: string | null;
    lineCount?: number | null;
    fromName?: string | null;
    fromTitle?: string | null;
  },
  tz?: string,
  c?: EmailCustom,
): { to: string; subject: string; html: string } {
  const when = formatMatchWhen(m.matchAt, tz);
  const greeting = opts.opposingCaptainName?.trim()
    ? `Hi ${opts.opposingCaptainName.trim().split(/\s+/)[0]},`
    : 'Hi there,';

  // Free-text notes are captain-authored, so newlines become paragraphs and
  // bullet-ish lines keep their shape rather than collapsing into one block.
  const notesHtml = (opts.hostNotes || '')
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => {
      const lines = para.split(/\n/).map((l) => l.trim()).filter(Boolean);
      const bulleted = lines.length > 1 && lines.every((l) => /^[-•*]/.test(l));
      if (bulleted) {
        return `<ul style="font-size:15px;margin:10px 0;padding-left:20px">${lines
          .map((l) => `<li style="margin:4px 0">${l.replace(/^[-•*]\s*/, '')}</li>`)
          .join('')}</ul>`;
      }
      return `<p style="font-size:15px;margin:10px 0">${lines.join('<br>')}</p>`;
    })
    .join('');

  const lines = opts.lineCount && opts.lineCount > 0
    ? `<p style="font-size:15px;margin:10px 0">We've filled all ${opts.lineCount} lines. If you're bringing fewer than ${opts.lineCount} teams, please let us know at your earliest convenience so we can plan the courts.</p>`
    : '';

  const sig = opts.fromName
    ? `<p style="font-size:15px;margin:18px 0 0">Thanks, and see you then!<br><br>${opts.fromName}${
        opts.fromTitle ? `<br><span style="color:#64748b">${opts.fromTitle}</span>` : ''
      }</p>`
    : `<p style="font-size:15px;margin:18px 0 0">Thanks, and see you then!</p>`;

  /**
   * The only marketing surface in CaptainMode, and the best one we have.
   *
   * This email lands in the inbox of a captain at ANOTHER club, someone who is
   * doing all of this by group text and a spreadsheet, roughly eight times a
   * season, from a club that is a plausible customer. A quiet one-line credit
   * converts far better than any ad we could buy, and it earns its place
   * because the email it sits under is genuinely useful to them.
   *
   * Kept to one muted line: the moment it looks like an ad, the email stops
   * reading as a courtesy from a fellow captain and starts reading as spam,
   * which costs us the goodwill AND the click.
   */
  const promo =
    `<a href="${BASE}/captainmode?ref=match" style="color:#64748b;text-decoration:underline">` +
    `${team} is organised with CaptainMode</a> — availability, lineups and reminders, ` +
    `without the group text.`;

  const vars = varsFor(team, opts.opposingCaptainName || 'Captain', m, tz);

  return {
    to: opts.to,
    subject: subjectOf(c, `${when} — ${team} vs ${m.opponent || 'your team'} at ${opts.clubName}`, vars),
    html: shell(
      `Looking forward to hosting you`,
      `<p style="font-size:15px;margin:0 0 10px">${greeting}</p>
       <p style="font-size:15px;margin:10px 0">Looking forward to hosting your team <strong>${when}</strong>.</p>
       <p style="font-size:15px;margin:10px 0"><strong>${opts.clubName}</strong>${
         opts.address ? `<br>${opts.address}` : ''
       }</p>
       ${c?.intro ? `<p style="font-size:15px;margin:10px 0">${c.intro}</p>` : ''}
       ${notesHtml}
       ${lines}
       ${sig}`,
      promo,
    ),
  };
}

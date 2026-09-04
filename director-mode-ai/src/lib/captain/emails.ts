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
/** The sentence the hosting email uses when the captain hasn't written their own. */
export function defaultLinesNote(
  lineCount?: number | null,
  opts?: {
    /** Courts the host is running the match on. */
    courtFormat?: number | null;
    /** Junior Team Tennis: lines are shared, so the ask is different. */
    singlesCourts?: number | null;
    doublesCourts?: number | null;
    minPlayers?: number | null;
  },
): string {
  /*
   * Junior Team Tennis gets its own sentence because the question between two
   * JTT captains is not "have you filled your lines" — the children share the
   * eight lines between them — it is HOW MANY ARE COMING and HOW MANY COURTS
   * the host has. Those two numbers decide whether the afternoon is three
   * rounds or five, and they are what the visiting captain writes back to ask
   * when the email doesn't say.
   */
  const singles = opts?.singlesCourts ?? 0;
  const doubles = opts?.doublesCourts ?? 0;
  const min = opts?.minPlayers ?? 0;
  if (min > 0 && singles + doubles > 0) {
    const courts = opts?.courtFormat
      ? `We'll be running a ${opts.courtFormat}-court format.`
      : null;
    const lines = `The scorecard is ${singles} singles and ${doubles} doubles — ${singles + doubles} lines, played in rounds.`;
    const numbers = `Could you let me know roughly how many players you're bringing? A team needs at least ${min} to take the court, and any line neither side can cover gets defaulted.`;
    return [courts, lines, numbers].filter(Boolean).join(' ');
  }

  if (!lineCount || lineCount <= 0) return '';
  return `We've filled all ${lineCount} lines. If you're bringing fewer than ${lineCount} teams, please let us know at your earliest convenience so we can plan the courts.`;
}

/**
 * The default hosting note as PLAIN TEXT, ready to drop into an editor.
 *
 * Split out from the HTML builder so the captain edits real prose rather than
 * filling four fields around a fixed skeleton. Match details change enough
 * week to week — a line defaulted in advance, a court closed, a different
 * warmup time — that a template with a couple of editable slots was always
 * going to be wrong at the wrong moment.
 */
export function hostingBodyText(
  m: MatchInfo,
  opts: {
    opposingCaptainName?: string | null;
    clubName: string;
    address?: string | null;
    hostNotes?: string | null;
    lineCount?: number | null;
    linesNote?: string | null;
    /** Passed straight to defaultLinesNote — see the JTT branch there. */
    courtFormat?: number | null;
    singlesCourts?: number | null;
    doublesCourts?: number | null;
    minPlayers?: number | null;
    fromName?: string | null;
    fromTitle?: string | null;
  },
  tz?: string,
): string {
  const when = formatMatchWhen(m.matchAt, tz);
  const greeting = opts.opposingCaptainName?.trim()
    ? `Hi ${opts.opposingCaptainName.trim().split(/\s+/)[0]},`
    : 'Hi there,';

  const linesText =
    opts.linesNote !== undefined && opts.linesNote !== null
      ? opts.linesNote.trim()
      : defaultLinesNote(opts.lineCount, {
          courtFormat: opts.courtFormat,
          singlesCourts: opts.singlesCourts,
          doublesCourts: opts.doublesCourts,
          minPlayers: opts.minPlayers,
        });

  const blocks = [
    greeting,
    `Looking forward to hosting your team ${when}.`,
    [opts.clubName, opts.address].filter(Boolean).join('\n'),
    (opts.hostNotes || '').trim(),
    linesText,
    'Thanks, and see you then!',
    [opts.fromName, opts.fromTitle].filter(Boolean).join('\n'),
  ].filter((b) => b && b.trim());

  return blocks.join('\n\n');
}

/** Turn the captain's plain text into the email body, preserving bullets. */
function textToHtml(text: string): string {
  return text
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
}

export function defaultHostingSubject(
  team: string,
  m: MatchInfo,
  clubName: string,
  tz?: string,
): string {
  return `${formatMatchWhen(m.matchAt, tz)} — ${team} vs ${m.opponent || 'your team'} at ${clubName}`;
}

/**
 * The pre-match note to the OPPOSING captain when we're hosting.
 *
 * Unlike every other email in this file the recipient is not one of our players
 * and has no token — she is a captain at another club. There are no Yes/No
 * buttons, no confirm link and no unsubscribe footer to protect, which is
 * exactly why the whole body is safe to hand over to the captain to edit. The
 * only thing this function adds around it is the shell and the CaptainMode
 * credit.
 */
export function opponentHostingEmail(
  team: string,
  m: MatchInfo,
  opts: {
    to: string;
    clubName: string;
    /** The captain's own words. Falls back to hostingBodyText(). */
    bodyText: string;
    subject?: string | null;
  },
  tz?: string,
): { to: string; subject: string; html: string } {
  /**
   * The only marketing surface in CaptainMode, and the best one we have.
   *
   * This lands in the inbox of a captain at ANOTHER club who is doing all of
   * this by group text, roughly eight times a season, from a club that is a
   * plausible customer. It leans on the email itself as the proof: it arrived
   * early, complete and unprompted, which is exactly what she never manages.
   *
   * Deliberately outside the editable body — it is our line, not the captain's,
   * and one muted line is the most it can be without the email reading as spam
   * rather than a courtesy from a fellow captain.
   */
  const promo =
    `<a href="${BASE}/captainmode?ref=match" style="color:#64748b;text-decoration:underline">` +
    `Captained with CaptainMode</a> — this email, the lineup, and every reminder, ` +
    `without one group text.`;

  return {
    to: opts.to,
    subject: (opts.subject || '').trim() || defaultHostingSubject(team, m, opts.clubName, tz),
    html: shell('Looking forward to hosting you', textToHtml(opts.bodyText), promo),
  };
}

/**
 * The match recap — the only email in this file that goes out AFTER a match.
 *
 * The captain owns the voice (subject + body, from her win or loss template);
 * the scoreboard, the season record and the next fixture are generated, because
 * those are the parts she would otherwise be retyping from the app she just
 * typed them into.
 *
 * The reader's own court is highlighted. A recap that makes each player find
 * their line in a table of six gets skimmed; one that says "you took court 3"
 * gets read.
 */
export function matchRecapEmail(
  team: string,
  m: MatchInfo,
  r: Recipient,
  opts: {
    subject: string;
    /** The captain's words, already variable-substituted. */
    bodyText: string;
    outcome: 'win' | 'loss' | 'tie';
    scoreline: string;
    courts: RecapCourtRow[];
    /** Season record label ("3-1"), or null to leave it out. */
    record?: string | null;
    nextMatch?: MatchInfo | null;
  },
  tz?: string,
): { to: string; subject: string; html: string } {
  const headline =
    opts.outcome === 'win'
      ? `We beat ${m.opponent || 'them'} ${opts.scoreline}`
      : opts.outcome === 'loss'
        ? `${m.opponent || 'They'} took it ${opts.scoreline}`
        : `We split with ${m.opponent || 'them'} ${opts.scoreline}`;

  const accent =
    opts.outcome === 'win' ? BRAND : opts.outcome === 'loss' ? '#fca5a5' : '#7dd3fc';

  const rows = opts.courts
    .map((c) => {
      const mine = c.playerIds.includes(r.playerId);
      const result =
        c.won === true
          ? `<span style="color:#15803d;font-weight:700">W</span>`
          : c.won === false
            ? `<span style="color:#b91c1c;font-weight:700">L</span>`
            : `<span style="color:#94a3b8">—</span>`;
      const score = c.defaulted ? 'Default' : c.score || '—';
      return `
      <tr${mine ? ` style="background:#f8fafc"` : ''}>
        <td style="padding:9px 12px 9px 10px;border-bottom:1px solid #e2e8f0;white-space:nowrap;color:#64748b;font-size:12px">
          ${c.courtType === 'singles' ? 'Singles' : 'Doubles'} ${c.courtNumber}
        </td>
        <td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;font-size:15px${mine ? ';font-weight:700' : ''}">
          ${escapeHtml(c.names.join(' / '))}${mine ? ' <span style="color:#64748b;font-weight:400;font-size:12px">(you)</span>' : ''}
        </td>
        <td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;font-size:14px;color:#475569;white-space:nowrap">${escapeHtml(score)}</td>
        <td style="padding:9px 10px 9px 12px;border-bottom:1px solid #e2e8f0;font-size:14px;text-align:right">${result}</td>
      </tr>`;
    })
    .join('');

  const next = opts.nextMatch
    ? `<p style="font-size:14px;color:#475569;margin:16px 0 0">
         <strong>Next up:</strong> ${formatMatchWhen(opts.nextMatch.matchAt, tz)}${
           opts.nextMatch.opponent ? ` vs ${escapeHtml(opts.nextMatch.opponent)}` : ''
         } · ${opts.nextMatch.isHome ? 'home' : 'away'}
       </p>`
    : '';

  return {
    to: r.email,
    subject: opts.subject,
    html: shell(
      headline,
      `<p style="font-size:13px;color:#64748b;margin:-8px 0 16px">
         ${formatMatchWhen(m.matchAt, tz)} · ${m.isHome ? 'home' : 'away'}
       </p>
       ${textToHtml(opts.bodyText)}
       <table style="width:100%;border-collapse:collapse;margin:16px 0 0;border-top:2px solid ${accent}">${rows}</table>
       ${opts.record ? `<p style="font-size:14px;color:#475569;margin:14px 0 0"><strong>Season record:</strong> ${escapeHtml(opts.record)}</p>` : ''}
       ${next}`,
      'Sent by your captain through CaptainMode.',
    ),
  };
}

export type RecapCourtRow = {
  courtNumber: number;
  courtType: 'singles' | 'doubles';
  names: string[];
  playerIds: string[];
  score: string | null;
  won: boolean | null;
  defaulted: boolean;
};

/**
 * The season opener — one note to every opposing captain in the division.
 *
 * Sent once, before a ball is hit, and it answers the three things a junior
 * captain otherwise spends the season chasing by text: when we play, how many
 * courts we host on, and who to ring. Nothing in it is a surprise on the day.
 *
 * The reader is a captain at a rival club who has never heard of ClubMode, so
 * the footer is ONE line and it is honest about what it links to. An email that
 * opens as a courtesy and closes as an advert is worse than no email — these
 * are the same people we stand next to on a Sunday.
 */
export function seasonOpenerBodyText(opts: {
  opposingCaptainName?: string | null;
  /** Our team, as the league lists it. */
  teamName: string;
  division?: string | null;
  clubName: string;
  address?: string | null;
  /** e.g. "Sundays at 4:00pm". */
  whenText: string;
  /** Courts we host on. */
  courtFormat?: number | null;
  singlesCourts?: number | null;
  doublesCourts?: number | null;
  minPlayers?: number | null;
  /** Their next fixture against us, already formatted. Omitted when unknown. */
  nextMeeting?: string | null;
  hostNotes?: string | null;
  fromName?: string | null;
  fromTitle?: string | null;
  fromPhone?: string | null;
}): string {
  const greeting = opts.opposingCaptainName?.trim()
    ? `Hi ${opts.opposingCaptainName.trim().split(/\s+/)[0]},`
    : 'Hi there,';

  const lines = (opts.singlesCourts ?? 0) + (opts.doublesCourts ?? 0);

  const format = [
    opts.courtFormat ? `We host on a ${opts.courtFormat}-court format` : null,
    lines
      ? `${opts.singlesCourts} singles and ${opts.doublesCourts} doubles, ${lines} lines in all`
      : null,
  ]
    .filter(Boolean)
    .join(' — ');

  const blocks = [
    greeting,
    `I'm captaining ${opts.teamName}${opts.division ? ` in ${opts.division}` : ''} this season, and wanted to introduce myself before we play.`,
    `Matches are ${opts.whenText}.`,
    format ? `${format}.` : null,
    opts.nextMeeting ? `We're down to play you ${opts.nextMeeting}.` : null,
    [opts.clubName, opts.address].filter(Boolean).join('\n'),
    (opts.hostNotes || '').trim(),
    opts.minPlayers
      ? `If you're ever short, let me know as early as you can and we'll sort it out — a team needs ${opts.minPlayers} to take the court, and any line neither of us can cover just gets defaulted.`
      : null,
    'Looking forward to the season.',
    [opts.fromName, opts.fromTitle, opts.fromPhone].filter(Boolean).join('\n'),
  ].filter((b) => b && String(b).trim());

  return blocks.join('\n\n');
}

export function seasonOpenerEmail(
  opts: {
    to: string;
    subject: string;
    bodyText: string;
    /** Tag on the trial link, so a signup can be traced back to this send. */
    ref?: string;
  },
): { to: string; subject: string; html: string } {
  /*
   * The referral line.
   *
   * It links to /captain/start, which grants a real 14-day trial with no card —
   * NOT to a pricing page. A captain who clicks "free trial" and lands on a
   * checkout form is the kind of small betrayal that costs a professional
   * relationship, and these recipients are colleagues before they are leads.
   */
  const promo =
    `Every part of this — the schedule, the lineups, the reminders — was handled by ` +
    `<a href="${BASE}/captain/start?ref=${encodeURIComponent(opts.ref || 'season-opener')}" ` +
    `style="color:#64748b;text-decoration:underline">CaptainMode</a>. ` +
    `Free for 14 days, no card.`;

  return {
    to: opts.to,
    subject: opts.subject,
    html: shell('', textToHtml(opts.bodyText), promo),
  };
}

/**
 * "Sundays at 4:00pm" — but only when that is true of every fixture.
 *
 * A season opener that states one day and time is far more useful than one that
 * says "see the schedule", so it is worth computing. It is also the single
 * easiest way to discredit the whole email: the East Bay junior schedule mostly
 * runs Sundays at 4:00pm and then quietly puts a handful of matches at 2:00pm.
 * A rival captain who spots that stops trusting the court format, the minimum
 * numbers and everything else in the note.
 *
 * So the claim is only made when the fixtures unanimously support it.
 */
export function seasonWhenText(matchAts: string[], tz: string = CLUB_TZ): string {
  const valid = (matchAts || []).filter((d) => d && !Number.isNaN(new Date(d).getTime()));
  if (!valid.length) return 'on the dates in the league schedule';

  const fmt = (d: string, o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { ...o, timeZone: tz }).format(new Date(d));
  const days = new Set(valid.map((d) => fmt(d, { weekday: 'long' })));
  const times = new Set(valid.map((d) => fmt(d, { hour: 'numeric', minute: '2-digit' })));

  if (days.size === 1 && times.size === 1) return `${[...days][0]}s at ${[...times][0]}`;
  if (days.size === 1) return `${[...days][0]}s — start times vary, so check the league schedule`;
  return 'on the dates and times in the league schedule';
}

/**
 * The note to the opposing captain when THEY are hosting.
 *
 * The hosting note tells them what to expect at our club. Away, the questions
 * run the other way: we are confirming we'll be there, saying how many lines we
 * are bringing so they can plan courts, and asking the one thing that is never
 * on a league site — whether there is anywhere to warm up.
 *
 * The panel used to disappear entirely on an away match, so a captain with four
 * away fixtures had no way to confirm any of them from the app.
 */
export function visitingBodyText(
  m: MatchInfo,
  opts: {
    opposingCaptainName?: string | null;
    /** Our team, as they'd recognise it. */
    teamName: string;
    /** Where they play. */
    venue?: string | null;
    lineCount?: number | null;
    singlesCourts?: number | null;
    doublesCourts?: number | null;
    /** Anything the captain keeps saying every away match. */
    notes?: string | null;
    fromName?: string | null;
    fromTitle?: string | null;
    fromPhone?: string | null;
  },
  tz?: string,
): string {
  const when = formatMatchWhen(m.matchAt, tz);
  const greeting = opts.opposingCaptainName?.trim()
    ? `Hi ${opts.opposingCaptainName.trim().split(/\s+/)[0]},`
    : 'Hi there,';

  const lines =
    opts.lineCount && opts.lineCount > 0
      ? `We're fielding all ${opts.lineCount} lines` +
        (opts.singlesCourts && opts.doublesCourts
          ? ` (${opts.singlesCourts} singles, ${opts.doublesCourts} doubles).`
          : '.')
      : null;

  const blocks = [
    greeting,
    `Just confirming ${opts.teamName} for ${when}${opts.venue ? ` at ${opts.venue}` : ''}.`,
    lines,
    // The question that is never answered anywhere, and that decides what time
    // eight people set their alarms for.
    'Are there warmup courts available beforehand, and what time would you like us there?',
    (opts.notes || '').trim(),
    "Let me know if anything changes at your end and I'll do the same.",
    'Thanks!',
    [opts.fromName, opts.fromTitle, opts.fromPhone].filter(Boolean).join('\n'),
  ].filter((b) => b && String(b).trim());

  return blocks.join('\n\n');
}

/** Subject for the away confirmation. */
export function defaultVisitingSubject(team: string, m: MatchInfo, tz?: string): string {
  return `${team} — confirming ${formatMatchWhen(m.matchAt, tz)}`;
}

/**
 * CourtConnect emails. (Partner Finder = CourtConnect: the product was built
 * under that name, which is why this lives in lib/partnerFinder.)
 *
 * Written for a 55+ club: big type, one obvious button, plain words. Every
 * link is a secret per-person link, so nobody has to remember a password to
 * say "I'm in" or "I can't make it".
 *
 * Subjects stay ASCII (hyphen, not en dash). A raw non-ASCII character in a
 * header is how a subject line arrives as mojibake.
 */
import { APP_URL } from '@/lib/appUrl';
import {
  FORMAT_LABEL,
  clockLabel,
  durationLabel,
  isFormat,
  longDay,
  needsLabel,
  ratingLabel,
  shortDay,
  shortName,
  firstName,
} from './format';
import type { Club, Game, GroupMember } from './server';

const INK = '#0f172a';
const MUTED = '#475569';
const GREEN = '#047857';

export const linkUrl = (token: string) => `${APP_URL}/play/i/${token}`;
export const stopUrl = (token: string) => `${APP_URL}/play/stop/${token}`;

/**
 * One outgoing message. `sms` is the same news in one short line — unused
 * today (A2P 10DLC registration is blocked, so there is no texting), but every
 * builder fills it, so turning texting on later is a delivery change in
 * notify.ts and not a rewrite of every message.
 */
export type GameMessage = {
  to: string;
  subject: string;
  html: string;
  sms: string;
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Our own punctuation in plain ASCII. Resend encodes the header, so a member's
 * accented name is left alone; this only keeps en dashes and curly quotes we
 * write ourselves out of the subject.
 */
const ascii = (s: string) =>
  s.replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/·/g, '-');

function formatWord(g: Game): string {
  return isFormat(g.format) ? FORMAT_LABEL[g.format] : g.format;
}

/** "Tue 9:00am doubles" */
function headline(g: Game, tz: string): string {
  return `${shortDay(g.starts_at, tz).split(' ')[0]} ${clockLabel(g.starts_at, tz)} ${formatWord(g)}`;
}

/** Every message says where it came from, so "CourtConnect" means something the next time. */
function shell(club: Club, title: string, body: string, footer = ''): string {
  const foot = footer || `Sent by CourtConnect for ${esc(club.name)}.`;
  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px 20px;color:${INK}">
    <p style="font-size:15px;color:${MUTED};margin:0 0 6px">${esc(club.name)} &middot; CourtConnect</p>
    <h1 style="font-size:26px;line-height:1.25;margin:0 0 18px">${title}</h1>
    ${body}
    <p style="font-size:14px;line-height:1.5;color:${MUTED};margin-top:28px">${foot}</p>
  </div>`;
}

function button(href: string, label: string, bg = GREEN): string {
  return `<a href="${href}" style="display:inline-block;padding:18px 30px;background:${bg};color:#ffffff;text-decoration:none;border-radius:12px;font-weight:700;font-size:20px">${label}</a>`;
}

/**
 * `playing` is who is already in, poster first. It is the line that decides a
 * yes: "a game needs players" is an abstraction, "Walden B. and Gabe F. are
 * playing" is an afternoon with people you know. Names only — phone numbers
 * stay for the people actually in the game (see groupList).
 */
function details(g: Game, club: Club, posterShort?: string, playing?: string[]): string {
  const tz = club.timezone;
  const rows: [string, string][] = [
    ['When', `${longDay(g.starts_at, tz)} at ${clockLabel(g.starts_at, tz)}`],
    ['How long', durationLabel(g.duration_min)],
    ['Game', formatWord(g)],
  ];
  const level = ratingLabel(g.rating_min, g.rating_max, club.levels);
  if (level) rows.push(['Level', level]);
  rows.push(['Court', g.court ? esc(g.court) : 'To be decided']);
  if (playing?.length) rows.push([playing.length > 1 ? 'Playing' : 'Posted by', playing.map(esc).join(', ')]);
  else if (posterShort) rows.push(['Posted by', esc(posterShort)]);
  return `
    <table style="width:100%;border-collapse:collapse;font-size:18px;line-height:1.4;margin:0 0 16px;background:#f8fafc;border-radius:12px">
      ${rows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:8px 14px;color:${MUTED};white-space:nowrap;vertical-align:top">${k}</td><td style="padding:8px 14px;font-weight:600">${v}</td></tr>`,
        )
        .join('')}
    </table>
    ${g.note ? `<p style="font-size:18px;line-height:1.5;margin:0 0 18px;padding:12px 16px;border-left:4px solid ${GREEN};background:#f0fdf4">&ldquo;${esc(g.note)}&rdquo;</p>` : ''}`;
}

function groupList(group: GroupMember[]): string {
  return `
    <ul style="font-size:18px;line-height:1.6;margin:0 0 18px;padding-left:22px">
      ${group
        .map(
          (m) =>
            `<li><strong>${esc(m.short)}</strong>${m.isPoster ? ' (posted the game)' : ''}${m.phone ? ` &middot; <a href="tel:${esc(m.phone.replace(/[^0-9+]/g, ''))}" style="color:${INK}">${esc(m.phone)}</a>` : ''}</li>`,
        )
        .join('')}
    </ul>`;
}

/* ------------------------------------------------------------- messages */

/** "Tue 9:00am doubles needs 1 player (3.0-3.5). Posted by Mary B. [I'm in]" */
export function inviteEmail(
  g: Game,
  club: Club,
  opts: {
    to: string;
    name: string | null;
    poster: string;
    token: string;
    stopToken: string | null;
    spotsLeft: number;
    /** Who is already in, poster first. */
    playing?: string[];
  },
): GameMessage {
  const tz = club.timezone;
  const level = ratingLabel(g.rating_min, g.rating_max, club.levels);
  const line = `${headline(g, tz)} ${needsLabel(opts.spotsLeft)}${level ? ` (${level})` : ''}`;
  /*
   * Yes and no, side by side. Both go to the same page rather than acting on
   * the click, because mail scanners follow links: a Safe Links check must not
   * take a spot, or turn one down, on somebody's behalf. The answer is the tap
   * on the page — see /play/i/[token].
   */
  const url = linkUrl(opts.token);
  const body = `
    <p style="font-size:18px;line-height:1.5;margin:0 0 16px">Hi ${esc(firstName(opts.name))}, a game at the club needs players. Can you play?</p>
    ${details(g, club, opts.poster, opts.playing)}
    <p style="margin:24px 0 10px">${button(`${url}?a=yes`, "Yes, I'm in")}</p>
    <p style="margin:0 0 14px">${button(`${url}?a=no`, 'No, not this time', MUTED)}</p>
    <p style="font-size:16px;color:${MUTED};margin:0">One tap either way. First to tap gets the spot, and you don't need a password.</p>`;
  const footer = opts.stopToken
    ? `You're getting this from CourtConnect because you're a member of ${esc(club.name)}. <a href="${stopUrl(opts.stopToken)}" style="color:${MUTED}">Stop emails about games that need players</a>.`
    : '';
  return {
    to: opts.to,
    subject: ascii(`${line}. Posted by ${opts.poster}`),
    html: shell(club, esc(line), body, footer),
    sms: ascii(`${club.name}: ${line}. Posted by ${opts.poster}. I'm in: ${linkUrl(opts.token)}`),
  };
}

/** To the poster when someone joins and the game still needs more. */
export function someoneJoinedEmail(
  g: Game,
  club: Club,
  opts: { to: string; joiner: string; spotsLeft: number; token: string },
): GameMessage {
  const title = `${opts.joiner} is in for your ${headline(g, club.timezone)}`;
  const body = `
    <p style="font-size:18px;line-height:1.5;margin:0 0 16px">Your game still ${needsLabel(opts.spotsLeft)}. We'll email you again as soon as it's full.</p>
    ${details(g, club)}
    <p style="margin:20px 0 0">${button(linkUrl(opts.token), 'See your game', INK)}</p>`;
  return {
    to: opts.to,
    subject: ascii(`${title} - ${needsLabel(opts.spotsLeft)}`),
    html: shell(club, esc(title), body),
    sms: ascii(`${title}. Still ${needsLabel(opts.spotsLeft)}.`),
  };
}

/**
 * To everyone in a game that just filled.
 *
 * The poster's copy names whoever took the last spot, in the subject. Every
 * earlier join reaches them as "Peter S. is in", so when the final one arrived
 * as a bare "You're all set" Walden Browne scanned his inbox for the name,
 * didn't find it, and reported the email missing — it had been delivered and
 * read as something else (2026-09-22). The one join a poster most wants
 * confirmed is the one that completes the game.
 */
export function gameFullEmail(
  g: Game,
  club: Club,
  opts: {
    to: string;
    name: string;
    group: GroupMember[];
    token: string;
    /** Who took the last spot. Only named for the poster. */
    joiner?: string | null;
    isPoster?: boolean;
  },
): GameMessage {
  const tz = club.timezone;
  const named = opts.isPoster && opts.joiner ? opts.joiner : null;
  const title = named ? `${named} is in — your game is full` : `You're all set: ${headline(g, tz)}`;
  const opening = named
    ? `Hi ${esc(firstName(opts.name))}, ${esc(named)} took the last spot. Here's who is playing:`
    : `Hi ${esc(firstName(opts.name))}, the game is full. Here's who is playing:`;
  const body = `
    <p style="font-size:18px;line-height:1.5;margin:0 0 16px">${opening}</p>
    ${groupList(opts.group)}
    ${details(g, club)}
    <p style="font-size:18px;line-height:1.5;margin:0 0 14px">If something comes up, please let the group know by tapping below so we can find someone else.</p>
    <p style="margin:0">${button(linkUrl(opts.token), 'See the game', INK)}</p>`;
  const when = `${formatWord(g)} ${shortDay(g.starts_at, tz)} at ${clockLabel(g.starts_at, tz)}`;
  return {
    to: opts.to,
    subject: ascii(named ? `${named} is in - your ${when} is full` : `You're all set: ${when}`),
    html: shell(club, esc(title), body),
    sms: ascii(
      named
        ? `${club.name}: ${named} is in - your ${headline(g, tz)} is full. ${opts.group.map((m) => m.short).join(', ')}.`
        : `${club.name}: your ${headline(g, tz)} is full. ${opts.group.map((m) => m.short).join(', ')}.`,
    ),
  };
}

/** To the poster when a player drops out. */
export function spotOpenedEmail(
  g: Game,
  club: Club,
  opts: { to: string; leaver: string; spotsLeft: number; token: string },
): GameMessage {
  const title = `${opts.leaver} can't make your ${headline(g, club.timezone)}`;
  const body = `
    <p style="font-size:18px;line-height:1.5;margin:0 0 16px">Your game is open again and ${needsLabel(opts.spotsLeft)}. It's back on CourtConnect, and anyone who taps "I'm in" on the earlier email can still take the spot.</p>
    ${details(g, club)}
    <p style="margin:20px 0 0">${button(linkUrl(opts.token), 'See your game', INK)}</p>`;
  return {
    to: opts.to,
    subject: ascii(`${title} - your game is open again`),
    html: shell(club, esc(title), body),
    sms: ascii(`${title}. Your game is open again.`),
  };
}

/**
 * To everyone waiting when a spot opens up. Not a promotion — the first to
 * tap takes it, because someone who said yes on Sunday may not still be free
 * on Tuesday, and a silent promotion fills a court with a player who never
 * confirmed.
 */
export function waitlistSpotEmail(
  g: Game,
  club: Club,
  opts: { to: string; name: string | null; token: string; poster: string; playing?: string[] },
): GameMessage {
  const title = `A spot just opened: ${headline(g, club.timezone)}`;
  const url = linkUrl(opts.token);
  const body = `
    <p style="font-size:18px;line-height:1.5;margin:0 0 16px">Hi ${esc(firstName(opts.name))}, you were in line for this game and somebody dropped out. Still want it?</p>
    ${details(g, club, opts.poster, opts.playing)}
    <p style="margin:24px 0 10px">${button(`${url}?a=yes`, "Yes, I'll take it")}</p>
    <p style="margin:0 0 14px">${button(`${url}?a=no`, 'No, give it to someone else', MUTED)}</p>
    <p style="font-size:16px;color:${MUTED};margin:0">First to tap gets it.</p>`;
  return {
    to: opts.to,
    subject: ascii(title),
    html: shell(club, esc(title), body),
    sms: ascii(`${club.name}: a spot opened for ${headline(g, club.timezone)}. First to tap gets it: ${url}`),
  };
}

/** To the players when the poster calls it off. */
export function gameCancelledEmail(
  g: Game,
  club: Club,
  opts: { to: string; name: string; poster: string },
): GameMessage {
  const tz = club.timezone;
  const title = `Cancelled: ${headline(g, tz)}`;
  const body = `
    <p style="font-size:18px;line-height:1.5;margin:0 0 16px">Hi ${esc(firstName(opts.name))}, ${esc(opts.poster)} has cancelled this game. There's nothing you need to do.</p>
    ${details(g, club)}`;
  return {
    to: opts.to,
    subject: ascii(`Cancelled: ${formatWord(g)} ${shortDay(g.starts_at, tz)} at ${clockLabel(g.starts_at, tz)}`),
    html: shell(club, esc(title), body),
    sms: ascii(`${club.name}: ${opts.poster} cancelled the ${headline(g, tz)}.`),
  };
}

/** Morning-of reminder to the group. */
export function reminderEmail(
  g: Game,
  club: Club,
  opts: { to: string; name: string; group: GroupMember[]; token: string },
): GameMessage {
  const tz = club.timezone;
  const title = `Today at ${clockLabel(g.starts_at, tz)}: ${formatWord(g)}`;
  const open = g.spots_needed - (opts.group.length - 1);
  const body = `
    <p style="font-size:18px;line-height:1.5;margin:0 0 16px">Hi ${esc(firstName(opts.name))}, a reminder about today's game.${open > 0 ? ` It still ${needsLabel(open)}.` : ''}</p>
    ${groupList(opts.group)}
    ${details(g, club)}
    <p style="margin:0">${button(linkUrl(opts.token), 'See the game', INK)}</p>`;
  return {
    to: opts.to,
    subject: ascii(title),
    html: shell(club, esc(title), body),
    sms: ascii(`${club.name}: today ${clockLabel(g.starts_at, tz)} ${formatWord(g)} with ${opts.group.map((m) => shortName(m.name)).join(', ')}.`),
  };
}

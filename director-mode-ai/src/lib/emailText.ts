/**
 * The plain-text half of an email, and the From line.
 *
 * WHY A TEXT PART AT ALL. A multipart message with only an HTML body is one of
 * the oldest bulk-mail signatures there is: real mail programs have always sent
 * both, and filters weigh it. ClubMode sent `html` alone for every message it
 * has ever sent. Sleepy Hollow's first CourtConnect blast went to 16 members
 * with one reply, and the club's own director said "I'm sure it's going to
 * spam...100%" before a single member had answered — the club's authentication
 * was clean (SPF, DKIM, a DMARC record, Resend's return-path), so what was
 * left was the shape of the message.
 *
 * This is deliberately a converter and not a second authoring format. A
 * hand-written text version of every template is a second thing to forget to
 * change; deriving it means the text part can never drift from what people see.
 */

/** Entities our own templates actually emit, plus the numeric forms. */
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '-',
  mdash: '—',
  hellip: '…',
  middot: '·',
  ldquo: '"',
  rdquo: '"',
  lsquo: "'",
  rsquo: "'",
  frac12: '1/2',
  deg: '°',
};

function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z0-9]+);/gi, (m, name) => ENTITIES[String(name).toLowerCase()] ?? m);
}

/**
 * A readable text version of one of our HTML emails.
 *
 * Links keep their destination — "Yes, I'm in (https://clubmode.ai/play/i/…)"
 * — because a text-only reader who cannot see the button still has to be able
 * to answer the question. Table rows become "label: value" lines, which is
 * what our details tables are.
 */
export function htmlToText(html: string): string {
  let s = html || '';

  // Anything not meant to be read.
  s = s.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');

  // Links: keep the words, then the URL, unless they are the same thing.
  s = s.replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, label) => {
    const words = label.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const url = String(href).trim();
    if (!words) return url;
    return decode(words) === url ? url : `${words} (${url})`;
  });

  // A details table reads as lines, not as a run-on sentence. The whitespace
  // around </tr> goes with it, or every row is followed by a blank line.
  s = s.replace(/<\/t[dh]>\s*<t[dh]\b[^>]*>/gi, ': ');
  s = s.replace(/\s*<\/tr>\s*/gi, '\n');

  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|h[1-6]|li|table|blockquote)>/gi, '\n\n');
  s = s.replace(/<li\b[^>]*>/gi, '- ');
  s = s.replace(/<hr\s*\/?>/gi, '\n----\n');

  s = s.replace(/<[^>]+>/g, '');
  s = decode(s);
  // "1½ hours" is written with the character itself in our templates, and
  // substituting it naively reads as "11/2 hours".
  s = s.replace(/(\d)\s*½/g, '$1 1/2').replace(/½/g, '1/2');

  // Whitespace: HTML mail is full of newlines and indentation that meant
  // nothing on screen and would look like broken text here.
  s = s.replace(/\r/g, '');
  s = s
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n');
  s = s.replace(/\n{3,}/g, '\n\n').trim();

  return s;
}

/** The address every ClubMode email is sent from. */
export const SENDING_ADDRESS = 'noreply@mail.clubmode.ai';

/**
 * A From line in the club's name.
 *
 * Steve Hawley has no relationship with "ClubMode" — he has one with Sleepy
 * Hollow, and the name in his inbox is most of what decides whether he opens
 * the message or reports it. The address stays ours, because that is the domain
 * with the DKIM key; only the display name changes.
 *
 * RFC 2047 encoded when the name is not plain ASCII, and quotes, angle
 * brackets and newlines are stripped — a club called `Tennis "Club" <x>` must
 * not be able to write its own header.
 */
export function clubFromLine(clubName: string | null | undefined, address = SENDING_ADDRESS): string {
  const clean = (clubName || 'ClubMode').replace(/["<>\r\n]/g, '').trim() || 'ClubMode';
  const display = /^[\x20-\x7E]*$/.test(clean)
    ? clean
    : `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
  return `${display} <${address}>`;
}

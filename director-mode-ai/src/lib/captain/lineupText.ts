/**
 * The lineup as plain text, for pasting into a group chat.
 *
 * Most teams already live somewhere the app cannot reach — a WhatsApp group, a
 * text thread — and that is where people actually read things. The business
 * messaging APIs cannot post into a group a person created, so the honest
 * answer is to hand the captain the message and let them paste it.
 *
 * ⚠️ Deliberately carries NO tokenised links. Every confirm/withdraw link in
 * CaptainMode identifies the player it was minted for, so one pasted into a
 * group would let any teammate confirm — or pull out — as somebody else. The
 * group post states the lineup; confirming stays in the 1:1 email and text.
 */
import { CLUB_TZ } from './clubTime';

export type TextLineupCourt = {
  courtNumber: number;
  courtType: 'singles' | 'doubles';
  names: string[];
};

export type TextLineupInput = {
  teamName: string;
  matchAt: string;
  opponent?: string | null;
  isHome: boolean;
  location?: string | null;
  /** The captain's own arrival wording, when they have set one. */
  arrivalNote?: string | null;
  courts: TextLineupCourt[];
  timeZone?: string;
};

const DEFAULT_ARRIVAL = 'Please arrive 30 minutes early for warmups.';

const SIGN_OFF =
  'If something has come up and you can no longer make it, please let me know ASAP. Thanks!';

/** Club time, always — Vercel runs UTC and would turn a 9:30am match into 4:30 PM. */
function whenLine(matchAt: string, timeZone?: string): string {
  const d = new Date(matchAt);
  const day = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: timeZone || CLUB_TZ,
  }).format(d);
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timeZone || CLUB_TZ,
  }).format(d);
  return `${day} at ${time}`;
}

const courtLabel = (c: TextLineupCourt) =>
  `${c.courtType === 'singles' ? 'Singles' : 'Doubles'} ${c.courtNumber}`;

/**
 * Plain text, no markdown. WhatsApp, Messages and every group chat render
 * asterisks and underscores differently or not at all, and a lineup pockmarked
 * with stray punctuation reads worse than a plain one.
 */
export function lineupAsText(input: TextLineupInput): string {
  const lines: string[] = [];

  const vs = input.opponent ? ` vs ${input.opponent}` : '';
  lines.push(`${input.teamName}${vs}`);
  lines.push(whenLine(input.matchAt, input.timeZone));

  const where = input.location || (input.isHome ? 'Home' : 'Away');
  lines.push(`${input.isHome ? 'Home' : 'Away'} — ${where}`);
  lines.push(input.arrivalNote?.trim() || DEFAULT_ARRIVAL);

  const played = input.courts.filter((c) => c.names.some((n) => n && n !== '—'));
  if (played.length) {
    lines.push('');
    lines.push('LINEUP');
    for (const c of played) {
      lines.push(`${courtLabel(c)}: ${c.names.filter(Boolean).join(' / ')}`);
    }
  }

  lines.push('');
  lines.push(SIGN_OFF);

  return lines.join('\n');
}

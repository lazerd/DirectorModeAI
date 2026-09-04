/**
 * Roster paste parsing for the "add players" box.
 *
 * The box invites one player per line ("Name, email, rating") but captains
 * paste whole league pages into it — that is the documented CaptainMode import
 * gesture, so it will keep happening. On 2026-09-03 a captain pasted her TopDog
 * team page and 240 nav labels ("Courts/ Reservations", "Find A Tournament",
 * "8/31/2026 - 5/3/2027") became roster rows, because the only check was that
 * the line was non-empty.
 *
 * This classifies each line instead of trusting it. Nothing is dropped
 * silently: a line that does not look like a person comes back as `suspect`
 * with a reason, so the UI can show it, default it to unticked, and let the
 * captain overrule. Real names that trip a heuristic stay one tick away.
 */

export type ParsedRosterRow = {
  name: string;
  email: string | null;
  rating: number | null;
  /** 'ok' → tick by default. 'suspect' → show, but do not tick. */
  confidence: 'ok' | 'suspect';
  /** Why it was doubted. Shown next to the row. */
  reason?: string;
  /** The original line, for display. */
  raw: string;
};

export type RosterPasteResult = {
  rows: ParsedRosterRow[];
  warnings: string[];
};

/** Hard ceiling on one paste. A league team is tens of players, not hundreds. */
export const MAX_ROSTER_ROWS = 200;

/** Above this, we say out loud that the paste looks like a page, not a roster. */
const PLAUSIBLE_TEAM_SIZE = 60;

/** Page furniture. Matched as a whole line, case-insensitively. */
const CHROME_LINES = new Set(
  [
    'help', 'search', 'home', 'menu', 'login', 'log in', 'logout', 'sign in', 'sign out',
    'calendar', 'schedule', 'standings', 'availability', 'practices', 'lessons', 'league',
    'captain', 'captains', 'roster', 'players', 'player', 'teams', 'team', 'matches',
    'settings', 'profile', 'account', 'season dates', 'coordinators', 'president',
    'click to update', 'new qr code', 'find a tournament', 'meet players', 'contact',
    'about', 'more', 'back', 'next', 'previous', 'edit', 'delete', 'save', 'cancel',
    'director of tennis', 'representative', 'level', 'division', 'name', 'email', 'rating',
    'season dates', 'home club', 'league organization', 'preferred time', 'phone', 'address',
    'vice president', 'secretary', 'treasurer', 'activity schedule', 'results', 'print',
    'notes', 'status', 'position', 'record', 'wins', 'losses', 'date', 'time', 'location',
    'opponent', 'court', 'courts', 'score', 'scores',
  ].map((s) => s.toLowerCase()),
);

/** Phrases that mark a line as site furniture even inside a longer string. */
const CHROME_TOKENS = [
  'reservation', 'tournament', 'qr code', 'click to', 'sign in', 'log in',
  'privacy', 'terms', 'copyright', 'all rights reserved',
];

/**
 * Nav words. Matched per WORD, not as a substring, so "Searcy" and "Helprin"
 * stay names. A menu bar copied onto the end of a name — the real case was
 * "Megan Sullivan   Help  Search" — is caught here and nowhere else.
 */
const CHROME_WORDS = new Set([
  'help', 'search', 'menu', 'home', 'login', 'logout', 'standings', 'schedule',
  'availability', 'practices', 'results', 'print', 'calendar', 'reservations',
  'lessons', 'tournament', 'tournaments', 'players', 'roster', 'settings',
  'profile', 'account', 'coordinators', 'president', 'secretary', 'treasurer',
  'division', 'league', 'club', 'captain', 'representative', 'preferred',
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[\d][\d\s().-]{6,}$/;
const URL_RE = /^(https?:\/\/|www\.)/i;
const DATE_RE = /\d{1,4}[/-]\d{1,2}[/-]\d{1,4}/;
const TIME_RE = /\d{1,2}:\d{2}\s*(am|pm)?/i;

/** A person's name: letters, spaces, and the punctuation real names carry. */
const NAME_SHAPE_RE = /^[\p{L}][\p{L}\p{M}'’.\- ]*$/u;

function classify(name: string): { confidence: 'ok' | 'suspect'; reason?: string } {
  const lower = name.toLowerCase();
  const words = name.split(/\s+/).filter(Boolean);

  if (CHROME_LINES.has(lower)) return { confidence: 'suspect', reason: 'looks like a page link' };
  if (CHROME_TOKENS.some((t) => lower.includes(t)))
    return { confidence: 'suspect', reason: 'looks like a page link' };
  const bareWords = words.map((w) => w.replace(/[^\p{L}]/gu, '').toLowerCase()).filter(Boolean);
  if (bareWords.some((w) => CHROME_WORDS.has(w)))
    return { confidence: 'suspect', reason: 'contains menu text' };
  if (URL_RE.test(name)) return { confidence: 'suspect', reason: 'looks like a web address' };
  if (PHONE_RE.test(name)) return { confidence: 'suspect', reason: 'looks like a phone number' };
  if (EMAIL_RE.test(name)) return { confidence: 'suspect', reason: 'looks like an email address' };
  if (DATE_RE.test(name)) return { confidence: 'suspect', reason: 'looks like a date' };
  if (TIME_RE.test(name)) return { confidence: 'suspect', reason: 'looks like a time' };
  if (name.includes('/') || name.includes('|') || name.includes(':'))
    return { confidence: 'suspect', reason: 'looks like a heading' };
  if (/\d/.test(name)) return { confidence: 'suspect', reason: 'has numbers in it' };
  if (words.length === 1) return { confidence: 'suspect', reason: 'only one word — no last name' };
  if (words.length > 4) return { confidence: 'suspect', reason: 'too long to be a name' };
  if (name.length > 60) return { confidence: 'suspect', reason: 'too long to be a name' };
  if (!NAME_SHAPE_RE.test(name)) return { confidence: 'suspect', reason: 'unusual characters' };

  return { confidence: 'ok' };
}

/**
 * Parse the paste box. Accepts "Name, email, rating" but tolerates a bare name,
 * tabs (a spreadsheet copy), and multiple spaces (a copied table row).
 */
export function parseRosterPaste(text: string): RosterPasteResult {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  // A label repeats down a page ("Phone", "Representative Division 18+"); a
  // person does not. Count first, so a repeat can be doubted rather than just
  // silently de-duplicated.
  const occurrences = new Map<string, number>();
  for (const line of lines) {
    const first = (line.includes(',') ? line.split(',') : line.split('\t'))[0]
      .replace(/\s{2,}/g, ' ')
      .trim()
      .toLowerCase();
    if (first) occurrences.set(first, (occurrences.get(first) ?? 0) + 1);
  }

  const rows: ParsedRosterRow[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    // Commas first (the documented format), then tabs (spreadsheet paste).
    const parts = (line.includes(',') ? line.split(',') : line.split('\t')).map((s) => s.trim());
    const name = (parts[0] || '').replace(/\s{2,}/g, ' ').trim();
    if (!name) continue;

    // Any field that reads as an email is the email, wherever it sits.
    const email = parts.slice(1).find((p) => EMAIL_RE.test(p)) ?? null;

    // A rating is 1–7 with at most one decimal. Anything else is not a rating.
    const ratingRaw = parts.slice(1).find((p) => /^[1-7](\.\d)?$/.test(p));
    const rating = ratingRaw ? Number(ratingRaw) : null;

    const key = name.toLowerCase();
    if (seen.has(key)) continue; // the same line twice in one paste
    seen.add(key);

    let { confidence, reason } = classify(name);
    if (confidence === 'ok' && (occurrences.get(key) ?? 0) > 1) {
      confidence = 'suspect';
      reason = 'appears more than once — probably a label';
    }
    rows.push({ name, email, rating, confidence, reason, raw: line });
  }

  const warnings: string[] = [];
  const suspects = rows.filter((r) => r.confidence === 'suspect').length;

  if (rows.length > PLAUSIBLE_TEAM_SIZE) {
    warnings.push(
      `That's ${rows.length} lines — more than a team usually has. If you pasted a whole page, ` +
        `untick everything that isn't a player before you add them.`,
    );
  }
  if (suspects > 0) {
    warnings.push(
      `${suspects} line${suspects === 1 ? " doesn't" : "s don't"} look like ${
        suspects === 1 ? 'a name' : 'names'
      } — those are unticked below. Tick any that really are players.`,
    );
  }
  if (rows.length > MAX_ROSTER_ROWS) {
    warnings.push(
      `Only the first ${MAX_ROSTER_ROWS} lines are shown. Paste a shorter list if you need the rest.`,
    );
  }

  return { rows: rows.slice(0, MAX_ROSTER_ROWS), warnings };
}

/**
 * Server-side guard. Deliberately narrower than `classify` — the captain is
 * allowed to overrule a "suspect" row in the preview, so the endpoint must only
 * refuse what can never be a person's name. Keeps a direct POST (or a stale
 * client) from dumping a page into the roster.
 */
export function isNotAName(name: string): string | null {
  const n = name.trim();
  if (!n) return 'empty';
  if (n.length > 80) return 'too long to be a name';
  if (EMAIL_RE.test(n)) return 'looks like an email address';
  if (PHONE_RE.test(n)) return 'looks like a phone number';
  if (URL_RE.test(n)) return 'looks like a web address';
  if (DATE_RE.test(n)) return 'looks like a date';
  if (n.split(/\s+/).filter(Boolean).length > 8) return 'too long to be a name';
  return null;
}

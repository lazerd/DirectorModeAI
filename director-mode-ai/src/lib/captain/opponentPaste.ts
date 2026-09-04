/**
 * The league's captain contact list, pasted in.
 *
 * Every USTA section publishes one of these before the season: a spreadsheet
 * with a row per team and, stretching off to the right, up to five repeating
 * blocks of Captain Name / USTA # / Safe Play Exp. / Email / Phone. It is the
 * only place the other clubs' phone numbers exist, and captains retype the two
 * or three they need into their phone and lose the rest.
 *
 * Pasting the sheet is the whole import. No per-league adapter, no stored
 * credentials, no scraping — the same reasoning as the roster and schedule
 * pastes CaptainMode already has.
 *
 * Two shapes have to survive the clipboard:
 *   - TAB-separated, straight out of Excel. Cells containing a newline come
 *     wrapped in double quotes and BREAK THE LINE, so `"foo@bar.com\n"` arrives
 *     as two lines. Rejoining those first is not optional; a third of the rows
 *     in the real East Bay list have one.
 *   - Runs of spaces, which is what a paste into a plain-text box becomes.
 */

export type OpponentCaptain = {
  name: string;
  ustaNumber: string | null;
  /** Safe Play expiry, left as written — this is a date a captain eyeballs. */
  safePlayExpires: string | null;
  email: string | null;
  phone: string | null;
};

export type ParsedOpponentRow = {
  /** The league's own team id, 10 digits. */
  teamId: string;
  teamName: string;
  division: string;
  captains: OpponentCaptain[];
  /** True when this row is the importing captain's own team. */
  isSelf?: boolean;
  /** Set when the row's division doesn't match the team importing it. */
  otherDivision?: boolean;
};

export type ParsedOpponents = {
  rows: ParsedOpponentRow[];
  warnings: string[];
};

/**
 * Put Excel's quote-wrapped multi-line cells back on one line.
 *
 * A line with an odd number of double quotes is mid-cell, so it swallows the
 * following lines until the quotes balance.
 */
function rejoinQuotedCells(text: string): string[] {
  const out: string[] = [];
  let held: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line: string = held === null ? raw : `${held} ${raw.trim()}`;
    const quotes = (line.match(/"/g) || []).length;
    if (quotes % 2 === 1) {
      held = line;
      continue;
    }
    held = null;
    out.push(line);
  }
  if (held !== null) out.push(held);
  return out;
}

/** Tabs when there are any, otherwise runs of two or more spaces. */
function splitCells(line: string): string[] {
  const cells = line.includes('\t') ? line.split('\t') : line.split(/ {2,}/);
  return cells.map((c) =>
    c
      .trim()
      // Excel doubles interior quotes and wraps the cell; strip both.
      .replace(/^"([\s\S]*)"$/, '$1')
      .replace(/""/g, '"')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

const TEAM_ID = /^\d{9,12}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** A USTA number is a long digit run; a phone has punctuation or is 10 digits. */
const USTA = /^\d{7,12}$/;

function looksLikePhone(v: string): boolean {
  const digits = v.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 11 && /[-().\s]/.test(v.trim());
}

/**
 * Read one team's trailing captain blocks.
 *
 * Deliberately field-sniffing rather than fixed 5-wide slicing: real rows drop
 * a phone or an email and leave the cell EMPTY, and the East Bay list has
 * captains with a Safe Play date but no contact details at all. Counting five
 * across would shift every later captain's fields by one and silently attach
 * one person's phone number to another person's name — the kind of error that
 * only shows up when someone gets a call at 7am on a Sunday.
 */
function readCaptains(cells: string[]): OpponentCaptain[] {
  const out: OpponentCaptain[] = [];
  let cur: OpponentCaptain | null = null;

  const flush = () => {
    if (cur && cur.name) out.push(cur);
    cur = null;
  };

  for (const cell of cells) {
    if (!cell) continue;
    if (EMAIL.test(cell)) {
      if (cur && !cur.email) cur.email = cell;
      continue;
    }
    if (looksLikePhone(cell)) {
      if (cur && !cur.phone) cur.phone = cell;
      continue;
    }
    if (USTA.test(cell)) {
      if (cur && !cur.ustaNumber) cur.ustaNumber = cell;
      continue;
    }
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(cell)) {
      if (cur && !cur.safePlayExpires) cur.safePlayExpires = cell;
      continue;
    }
    // Anything else that reads like a person's name starts a new captain.
    if (/[A-Za-z]/.test(cell)) {
      flush();
      cur = { name: cell, ustaNumber: null, safePlayExpires: null, email: null, phone: null };
    }
  }
  flush();
  return out;
}

/** Loose division match: "14U Yellow Intermediate" vs "14U - Yellow Intermediate". */
export function sameDivision(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\bball\b/g, '')
      .replace(/[^a-z0-9]/g, '');
  const x = norm(a);
  const y = norm(b);
  return x === y || x.startsWith(y) || y.startsWith(x);
}

export function parseOpponentPaste(
  text: string,
  opts: { division?: string | null; ownTeamId?: string | null } = {},
): ParsedOpponents {
  const warnings: string[] = [];
  const rows: ParsedOpponentRow[] = [];
  const seen = new Set<string>();

  for (const line of rejoinQuotedCells(text || '')) {
    if (!line.trim()) continue;
    const cells = splitCells(line);
    if (!cells.length) continue;

    // The first cell is the league's team id. Anything else is a title row, a
    // header, or a stray — skipped in silence, because a pasted spreadsheet
    // always has some.
    const teamId = cells[0];
    if (!TEAM_ID.test(teamId)) continue;

    const teamName = cells[1] || '';
    const division = cells[2] || '';
    if (!teamName) {
      warnings.push(`Team ${teamId} has no name — skipped.`);
      continue;
    }
    if (seen.has(teamId)) continue;
    seen.add(teamId);

    const captains = readCaptains(cells.slice(3));
    const row: ParsedOpponentRow = { teamId, teamName, division, captains };

    if (opts.ownTeamId && teamId === opts.ownTeamId) row.isSelf = true;
    if (opts.division && division && !sameDivision(division, opts.division)) {
      row.otherDivision = true;
    }
    rows.push(row);
  }

  if (!rows.length) {
    warnings.push(
      'No team rows found. Each row needs to start with the league Team ID, then the team name and division.',
    );
    return { rows, warnings };
  }

  const withoutContact = rows.filter(
    (r) => !r.isSelf && !r.otherDivision && !r.captains.some((c) => c.email || c.phone),
  );
  if (withoutContact.length) {
    warnings.push(
      `No email or phone for ${withoutContact.map((r) => r.teamName).join(', ')} — the list has none.`,
    );
  }

  const self = rows.find((r) => r.isSelf);
  if (self) warnings.push(`${self.teamName} is your own team — not imported as an opponent.`);

  const other = rows.filter((r) => r.otherDivision).length;
  if (other && opts.division) {
    warnings.push(
      `${other} ${other === 1 ? 'team plays' : 'teams play'} a different division to ${opts.division} — untick any you don't want.`,
    );
  }

  return { rows, warnings };
}

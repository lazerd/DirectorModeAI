/**
 * The paste box on an org page.
 *
 * The reps do not build contact lists by hand — they find a club's board page,
 * select it, and copy. What lands on the clipboard is one person per line with
 * the columns separated by a tab (from a table or a spreadsheet) or by a run of
 * spaces (from a rendered page). So this takes the whole blob and works out
 * what each cell is, rather than demanding a fixed column order nobody has.
 *
 * Deliberately permissive in one direction and strict in the other:
 *
 *   - a line with no email is still a contact. Half of a volunteer board
 *     publishes titles and no addresses, and "Pat Baughman — captain, no email
 *     known" is exactly the row a rep needs to see so they go and ask for it.
 *   - a line with no NAME is dropped. A bare email with nobody attached is how
 *     a stray footer or a copyright line gets turned into a person.
 *
 * Pure and total: it never throws, and the caller decides what to do with
 * `skipped`. Tested in pasteContacts.test.ts.
 */

export interface PastedContact {
  full_name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
}

export interface PasteResult {
  contacts: PastedContact[];
  /** Lines that had text but no usable name, verbatim, so the box can say so. */
  skipped: string[];
}

const EMAIL_RE = /[^\s<>(),;:"]+@[^\s<>(),;:"]+\.[A-Za-z]{2,}/;
/** 10 digits, however they are punctuated: 925-932-6551, (925) 932 6551, +1 925… */
const PHONE_RE = /(?:\+?1[\s.-]*)?\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}/;

/** A cell is a name if it has a letter and is not an address or a number. */
function looksLikeName(cell: string): boolean {
  if (!cell) return false;
  if (EMAIL_RE.test(cell)) return false;
  if (!/[A-Za-z]/.test(cell)) return false;
  // "—", "n/a", "none" and friends are placeholders in a copied table.
  return !/^(n\/?a|none|unknown|tbd|-+|–|—)$/i.test(cell.trim());
}

/**
 * Split one line into cells.
 *
 * Tab first when there is one: a tabbed line may legitimately contain a single
 * space inside a cell ("Mary Benin"), and splitting on whitespace would cut it
 * in half. Otherwise a run of two or more spaces, which is what a copied web
 * table collapses to, plus the em/en dashes people separate a title with.
 */
function cellsOf(line: string): string[] {
  const raw = line.includes('\t')
    ? line.split('\t')
    : line.split(/\s{2,}|\s+[–—]\s+|\s+\|\s+/);
  return raw.map((c) => c.trim().replace(/^[,;–—-]+|[,;–—-]+$/g, '').trim()).filter(Boolean);
}

export function parsePastedContacts(input: string): PasteResult {
  const contacts: PastedContact[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();

  for (const rawLine of (input || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    let cells = cellsOf(line);

    /*
     * "Mary Benin <mary.benin@gmail.com>" — one cell, two facts. Address books
     * and mail clients paste this way, and it is the one shape where there is
     * no separator at all to split on.
     */
    if (cells.length === 1) {
      const angle = /^(.*?)\s*<\s*([^<>]+)\s*>$/.exec(cells[0]);
      if (angle) cells = [angle[1].trim(), angle[2].trim()];
    }

    // A single cell holding "Name email@x" with one space between them.
    if (cells.length === 1 && EMAIL_RE.test(cells[0])) {
      const m = EMAIL_RE.exec(cells[0])!;
      const before = cells[0].slice(0, m.index).trim();
      cells = before ? [before, m[0]] : [m[0]];
    }

    // Claim the typed cells first, whatever order they arrived in.
    const rest: string[] = [];
    let email: string | null = null;
    let phone: string | null = null;
    for (const cell of cells) {
      if (!email && EMAIL_RE.test(cell)) {
        email = EMAIL_RE.exec(cell)![0].toLowerCase();
        continue;
      }
      // Guarded by looksLikeName so "Suite 200" style cells are not phones and
      // a name is never eaten by the digit rule.
      if (!phone && !looksLikeName(cell) && PHONE_RE.test(cell)) {
        phone = cell;
        continue;
      }
      rest.push(cell);
    }

    const full_name = rest.find(looksLikeName) ?? '';
    if (!full_name) {
      skipped.push(line);
      continue;
    }
    // Whatever is left over after the name is the title — "President",
    // "Captain, Women's 65+". Joined rather than dropped, because a copied
    // table often splits a title across two columns.
    const title =
      rest
        .filter((c) => c !== full_name)
        .join(' — ')
        .trim() || null;

    const key = full_name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    contacts.push({ full_name, email, phone, title });
  }

  return { contacts, skipped };
}

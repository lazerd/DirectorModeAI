/**
 * Reads the Sleepy Hollow JTT availability form responses (the same Google
 * Sheet that court-booker/jtt-rsvp-export.js consumes) directly from the web
 * app, so the match-confirmation email can be sent the DAY BEFORE based on who
 * marked themselves "Available" — not on day-of check-ins.
 *
 * Auth: a Google service account whose JSON key is in env
 * GOOGLE_SERVICE_ACCOUNT_JSON. The sheet must be shared with that service
 * account (read access). This is the same `topdog-booker` account court-booker
 * already uses.
 *
 * Parse logic mirrors court-booker/jtt-rsvp-export.js exactly so the two stay
 * in sync (availability columns are headers like
 *   "Mark your 10U availability [Tue Jun 9 · 1:00pm]").
 */
import { google } from 'googleapis';

const SPREADSHEET_ID = '12w94q_NtYlrj8hqSkVBR9TdaU7rXMs-yZeXN1mMn9Ps';
const YEAR = 2026;

const MONTHS: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};
// Form team token -> Director Mode division short_code
const DIV_MAP: Record<string, string> = { '10U': '10U', '12U': '12U', '13+': '13O', Open: 'OPEN' };

export type AvailabilityEntry = {
  player_name: string;
  parent_name: string;
  parent_email: string;
  parent_phone: string;
  status: 'available' | 'maybe';
};

function isoDate(datePart: string): string | null {
  // "Tue Jun 9" -> "2026-06-09"
  const m = datePart.match(/([A-Z][a-z]{2})\s+(\d{1,2})/);
  if (!m) return null;
  const mo = String(MONTHS[m[1]]).padStart(2, '0');
  const day = String(parseInt(m[2], 10)).padStart(2, '0');
  return `${YEAR}-${mo}-${day}`;
}

function parseHeader(h: string): { division?: string; iso?: string | null } | null {
  const m = h.match(/Mark your (.+?) availability\s*\[(.+?)\]/);
  if (!m) return null;
  const team = m[1].trim();
  const datePart = m[2].split('·')[0].trim();
  return { division: DIV_MAP[team], iso: isoDate(datePart) };
}

let cached: { sheet: string[][]; at: number } | null = null;

async function fetchSheetRows(): Promise<string[][]> {
  // Cache the raw sheet for 60s so a preview + send don't double-hit the API.
  if (cached && Date.now() - cached.at < 60_000) return cached.sheet;

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_JSON is not set — add the service-account key to the environment to read the availability sheet.'
    );
  }
  let creds: { client_email: string; private_key: string };
  try {
    creds = JSON.parse(raw);
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.');
  }

  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  // Find the form-response tab (skip the "Lineup" tab), then read it.
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const formTab =
    meta.data.sheets?.find(s => s.properties?.title !== 'Lineup')?.properties?.title;
  if (!formTab) throw new Error('Could not find the availability response tab in the sheet.');

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${formTab}!A1:AZ1000`,
  });
  const rows = (res.data.values as string[][]) || [];
  cached = { sheet: rows, at: Date.now() };
  return rows;
}

/**
 * Players who marked themselves available (or maybe) for a given division +
 * date, from the availability form. Returns [] if there's no column for that
 * division/date (e.g. a bye, or the form hasn't been opened for it).
 * De-duplicates by player name (last submission wins).
 */
export async function fetchAvailability(
  divisionShort: string,
  iso: string
): Promise<AvailabilityEntry[]> {
  const rows = await fetchSheetRows();
  const headers = rows[0] || [];

  const col = (name: string) => headers.findIndex(h => new RegExp(name, 'i').test(h || ''));
  const cName = col('player full name');
  const cParent = col('parent/guardian name');
  const cEmail = col('parent email');
  const cPhone = col('parent cell');
  const cTeam = col('which team');

  // The single availability column matching this division + date.
  let targetIdx = -1;
  headers.forEach((h, idx) => {
    const p = parseHeader(h || '');
    if (p && p.division === divisionShort && p.iso === iso) targetIdx = idx;
  });
  if (targetIdx === -1) return [];

  const byName = new Map<string, AvailabilityEntry>();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const name = (row[cName] || '').trim();
    if (!name) continue;
    const teamTok = (row[cTeam] || '').split('(')[0].trim(); // "10U (Tuesdays 1:00pm)" -> "10U"
    if (DIV_MAP[teamTok] !== divisionShort) continue;

    const v = (row[targetIdx] || '').trim().toLowerCase();
    if (v !== 'available' && v !== 'maybe') continue;

    byName.set(name.toLowerCase(), {
      player_name: name,
      parent_name: (row[cParent] || '').trim(),
      parent_email: (row[cEmail] || '').trim(),
      parent_phone: (row[cPhone] || '').trim(),
      status: v as 'available' | 'maybe',
    });
  }

  return Array.from(byName.values()).sort((a, b) => a.player_name.localeCompare(b.player_name));
}

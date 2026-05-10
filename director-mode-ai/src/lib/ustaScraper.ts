/**
 * USTA NorCal team roster scraper.
 *
 * Fetches a server-rendered team page from leagues.ustanorcal.com and extracts
 * the roster table. The page is pure HTML with a consistent structure, so
 * targeted regex is safer (and cheaper) than pulling in cheerio just for this.
 *
 * Tested against: https://leagues.ustanorcal.com/teaminfo.asp?id=XXXXXX
 */

export type UstaPlayer = {
  usta_player_id: string;
  name: string;       // "First Last" (normalized)
  raw_name: string;   // "Last, First" as it appears on the page
  city: string | null;
  gender: 'male' | 'female' | null;
  ntrp: string | null;        // e.g. "3.5C"
  ntrp_numeric: number | null; // e.g. 3.5
};

export type UstaTeamScrapeResult = {
  team_name: string | null;
  players: UstaPlayer[];
  source_url: string;
};

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

const SUPPORTED_HOSTS = [
  'leagues.ustanorcal.com',
];

export function isSupportedUstaUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return SUPPORTED_HOSTS.includes(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Converts "Last, First Middle" to "First Middle Last".
 * Matches the normalization already used in the court-booker project so
 * downstream Captyn / UTR lookups can share name-matching code later.
 */
export function normalizeUstaName(name: string): string {
  const trimmed = name.trim();
  const m = trimmed.match(/^(.+?),\s*(.+)$/);
  if (m) return `${m[2].trim()} ${m[1].trim()}`;
  return trimmed;
}

function parseNtrpNumeric(ntrp: string | null): number | null {
  if (!ntrp) return null;
  const m = ntrp.match(/(\d+\.\d+)/);
  return m ? parseFloat(m[1]) : null;
}

function parseGender(raw: string | null): 'male' | 'female' | null {
  if (!raw) return null;
  const g = raw.trim().toUpperCase();
  if (g === 'M') return 'male';
  if (g === 'F') return 'female';
  return null;
}

/**
 * Extracts the team name from the <title> tag.
 * Format: "USTA NorCal - Team Information | SLEEPY HOLLOW 40AM3.5A"
 */
function extractTeamName(html: string): string | null {
  const m = html.match(/<title>[^|]*\|\s*([^<]+)<\/title>/i);
  return m ? m[1].trim() : null;
}

/**
 * Parses the roster table. Each player row contains:
 *   <a href=playermatches.asp?id=318841>Alexander, Ryan   </a>  (name cell)
 *   <td...>Orinda</td>        (city)
 *   <td...align=center>M</td> (gender)
 *   <td...>3.5C</td>          (rating)
 *
 * The roster section is scoped by the <a name=roster></a> anchor, so we only
 * parse rows that appear after that marker to avoid matching scorecard links
 * or other playermatches.asp references elsewhere on the page.
 */
function parseRoster(html: string): UstaPlayer[] {
  const rosterAnchorIdx = html.indexOf('<a name=roster></a>');
  if (rosterAnchorIdx === -1) return [];

  const rosterSection = html.slice(rosterAnchorIdx);

  // Match each player row. Capture groups:
  //  1 = usta player id
  //  2 = raw name ("Last, First Middle")
  //  3 = city
  //  4 = gender letter (M/F)
  //  5 = NTRP rating (e.g. "3.5C")
  const rowRe = new RegExp(
    '<a\\s+href=playermatches\\.asp\\?id=(\\d+)>\\s*([^<]+?)\\s*</a></td>' +
    '<td[^>]*>([^<]*)</td>' +
    '<td[^>]*align=center[^>]*>([^<]*)</td>' +
    '<td[^>]*>([^<]*)</td>',
    'gi'
  );

  const players: UstaPlayer[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = rowRe.exec(rosterSection)) !== null) {
    const [, id, rawName, city, genderRaw, ntrpRaw] = match;
    if (seen.has(id)) continue; // same roster row could technically repeat
    seen.add(id);

    const cleanedRawName = rawName.replace(/\s+/g, ' ').trim();
    const ntrp = ntrpRaw.trim() || null;
    players.push({
      usta_player_id: id,
      name: normalizeUstaName(cleanedRawName),
      raw_name: cleanedRawName,
      city: city.trim() || null,
      gender: parseGender(genderRaw),
      ntrp,
      ntrp_numeric: parseNtrpNumeric(ntrp),
    });
  }

  return players;
}

export async function scrapeUstaTeam(url: string): Promise<UstaTeamScrapeResult> {
  if (!isSupportedUstaUrl(url)) {
    throw new Error(
      `Unsupported URL. Currently supported: ${SUPPORTED_HOSTS.join(', ')}`
    );
  }

  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml',
    },
    // NOTE: no-store so edge caches don't serve stale roster data
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`USTA returned HTTP ${res.status}`);
  }

  const html = await res.text();

  return {
    team_name: extractTeamName(html),
    players: parseRoster(html),
    source_url: url,
  };
}

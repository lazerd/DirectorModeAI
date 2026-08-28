/**
 * Paste ratings in from wherever the captain got them (TennisRecord, a USTA
 * team page, a spreadsheet) and match them to the roster.
 *
 * TennisRecord has no API and blocks automated requests, so the captain does
 * the looking-up in their own browser and pastes the block in. That keeps the
 * one manual step to "select, copy" and hands the fiddly part — parsing a
 * ragged table and matching 23 names — to code.
 *
 * Deliberately deterministic, no LLM, for the same reason the lineup generator
 * is: assigning one player another player's rating is a silent, hard-to-spot
 * error, so the matching rules have to be explainable and testable. Anything
 * this can't match confidently is reported rather than guessed, and the caller
 * shows a preview before a single row is written.
 */

/** Plausible tennis rating band. Outside this it isn't a rating. */
const MIN_RATING = 1.0;
const MAX_RATING = 7.0;

export type ParsedRating = { name: string; rating: number };

/** What a name was matched on, so a preview can show why. */
export type MatchedOn = 'exact' | 'reversed' | 'last-name + initial';

export type RatingMatch = {
  playerId: string;
  playerName: string;
  rating: number;
  matchedOn: MatchedOn;
  previousRating: number | null;
};

export type RatingsResolution = {
  matched: RatingMatch[];
  /** parsed a name + rating, but no confident roster match */
  unmatched: ParsedRating[];
  /** matched more than one roster player — never guessed */
  ambiguous: { parsed: ParsedRating; candidates: string[] }[];
  /** lines that held no name/rating pair at all */
  ignoredLines: string[];
};

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z\s-]/g, ' ') // drop punctuation, keep hyphens in surnames
    .replace(/\s+/g, ' ')
    .trim();
}

/** "Smith, Jane" -> "jane smith"; otherwise just normalized. */
export function canonical(name: string): string {
  const n = name.includes(',')
    ? name.split(',').map((p) => p.trim()).reverse().join(' ')
    : name;
  return normalize(n);
}

/**
 * Pull a name and a rating out of one pasted line. Handles tab- or
 * space-separated columns, "Last, First", and lines carrying several numbers
 * (a TennisRecord row has a dynamic rating plus match counts and win %) — the
 * first number inside the rating band wins, because that column comes first.
 */
export function parseRatingLine(line: string): ParsedRating | null {
  const raw = line.trim();
  if (!raw) return null;

  // Tab/multi-space separated columns are the common paste shape.
  const cols = raw.split(/\t|\s{2,}/).map((c) => c.trim()).filter(Boolean);
  const fields = cols.length > 1 ? cols : [raw];

  let name: string | null = null;
  for (const f of fields) {
    // Strip a parenthetical BEFORE testing for digits — TennisRecord tags the
    // name cell with the rating type, e.g. "Paula Garcia (3.5C)".
    const cleaned = f.replace(/\(.*?\)/g, '').trim();
    // A name field has letters, no leftover digits, and a space or comma
    // (one bare word can't be matched to a roster with any confidence).
    if (/[a-z]/i.test(cleaned) && !/\d/.test(cleaned) && cleaned.length >= 3 && /\s|,/.test(cleaned)) {
      name = cleaned;
      break;
    }
  }

  // Single-column line: "Jane Smith 3.42 12 0.667"
  if (!name) {
    const m = raw.match(/^([A-Za-z][A-Za-z .'-]*?[A-Za-z])\s+\d/);
    if (m && /\s|,/.test(m[1])) name = m[1].trim();
  }
  if (!name) return null;

  // Scan for the rating with parentheticals removed. TennisRecord tags the
  // name cell with the coarse USTA level — "Paula Garcia (3.5C)  3.42" — and
  // reading that 3.5 instead of the 3.42 dynamic rating throws away exactly
  // the precision the captain came for.
  const withoutTags = raw.replace(/\(.*?\)/g, ' ');

  let rating: number | null = null;
  for (const m of withoutTags.matchAll(/\d+\.\d+/g)) {
    const v = Number(m[0]);
    if (v >= MIN_RATING && v <= MAX_RATING) {
      rating = v;
      break;
    }
  }
  if (rating == null) return null;

  return { name, rating };
}

export function parseRatingsBlock(text: string): { parsed: ParsedRating[]; ignored: string[] } {
  const parsed: ParsedRating[] = [];
  const ignored: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const p = parseRatingLine(line);
    if (p) parsed.push(p);
    else ignored.push(line.trim());
  }
  return { parsed, ignored };
}

/**
 * The name-matching engine, shared by every paste-in importer (NTRP ratings,
 * WTN, anything that arrives as "a name and a number per line").
 *
 * Three rules, tried in order and never combined: exact, first/last reversed,
 * then last name plus first initial. That last one is what catches "J. Smith"
 * and "Jane Smith" being the same person — but only when exactly one roster
 * player fits, because two Smiths make it a coin flip and a coin flip here
 * silently hands someone else's number to a player.
 */
export function matchByName<T extends { name: string }, R extends { id: string; name: string }>(
  parsed: T[],
  roster: R[],
): {
  matched: { parsed: T; player: R; matchedOn: MatchedOn }[];
  unmatched: T[];
  ambiguous: { parsed: T; candidates: string[] }[];
} {
  const matched: { parsed: T; player: R; matchedOn: MatchedOn }[] = [];
  const unmatched: T[] = [];
  const ambiguous: { parsed: T; candidates: string[] }[] = [];

  const entries = roster.map((p) => {
    const c = canonical(p.name);
    const parts = c.split(' ').filter(Boolean);
    return {
      player: p,
      canonical: c,
      first: parts[0] ?? '',
      last: parts.length > 1 ? parts[parts.length - 1] : '',
    };
  });

  const taken = new Set<string>();

  for (const p of parsed) {
    const c = canonical(p.name);
    const parts = c.split(' ').filter(Boolean);
    const first = parts[0] ?? '';
    const last = parts.length > 1 ? parts[parts.length - 1] : '';

    const add = (e: (typeof entries)[number], how: MatchedOn) => {
      taken.add(e.player.id);
      matched.push({ parsed: p, player: e.player, matchedOn: how });
    };

    const free = entries.filter((e) => !taken.has(e.player.id));

    const exact = free.filter((e) => e.canonical === c);
    if (exact.length === 1) {
      add(exact[0], 'exact');
      continue;
    }
    if (exact.length > 1) {
      ambiguous.push({ parsed: p, candidates: exact.map((e) => e.player.name) });
      continue;
    }

    const reversed = free.filter((e) => e.canonical === parts.slice().reverse().join(' '));
    if (reversed.length === 1) {
      add(reversed[0], 'reversed');
      continue;
    }

    if (last && first) {
      const byLast = free.filter((e) => e.last === last && e.first.startsWith(first[0]));
      if (byLast.length === 1) {
        add(byLast[0], 'last-name + initial');
        continue;
      }
      if (byLast.length > 1) {
        ambiguous.push({ parsed: p, candidates: byLast.map((e) => e.player.name) });
        continue;
      }
    }

    unmatched.push(p);
  }

  return { matched, unmatched, ambiguous };
}

/** Match parsed names to the roster and attach the rating each one carries. */
export function resolveRatings(
  parsed: ParsedRating[],
  roster: { id: string; name: string; rating: number | null }[],
  ignoredLines: string[] = [],
): RatingsResolution {
  const res = matchByName(parsed, roster);
  return {
    matched: res.matched.map((m) => ({
      playerId: m.player.id,
      playerName: m.player.name,
      rating: m.parsed.rating,
      matchedOn: m.matchedOn,
      previousRating: m.player.rating,
    })),
    unmatched: res.unmatched,
    ambiguous: res.ambiguous,
    ignoredLines,
  };
}

/**
 * Strength order implied by rating, strongest first. Ties keep their existing
 * rank where they have one, then fall back to name, so re-importing the same
 * numbers doesn't reshuffle players the captain already placed by hand.
 */
export function rankByRating(
  players: { id: string; name: string; rating: number | null; sort_order?: number | null }[],
): string[] {
  return [...players]
    .sort((a, b) => {
      const d = (b.rating ?? 0) - (a.rating ?? 0);
      if (d !== 0) return d;
      const sa = a.sort_order ?? Number.MAX_SAFE_INTEGER;
      const sb = b.sort_order ?? Number.MAX_SAFE_INTEGER;
      if (sa !== sb) return sa - sb;
      return a.name.localeCompare(b.name);
    })
    .map((p) => p.id);
}

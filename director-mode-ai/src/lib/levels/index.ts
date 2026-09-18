/**
 * What a level is called here.
 *
 * A tennis club rates people 3.0, 3.5, 4.0 — NTRP, decimals, and every member
 * knows what they mean. A pickleball club does not: Rossmoor Pickleball's 600
 * members are Novice, Intermediate, Advanced Intermediate and Advanced, and a
 * board shown "Level 2.8–3.3" stops reading there.
 *
 * So one place decides, keyed off the club's sport, and every surface asks it:
 * the board, the picker, the settings row, the club site, the emails, the
 * director page and PlayerVault. Components never check the sport themselves.
 *
 * THE NUMBER IS STILL THE STORAGE. master_players.ntrp and
 * cc_vault_players.usta_rating hold a number at every club, CourtConnect
 * matches on numbers (levelFits in lib/partnerFinder/server), and none of that
 * changes. A tier is a NAME for a band of those numbers. A pickleball member
 * picks "Intermediate" and we store the band's representative number; they
 * never read it back.
 *
 * TIERS ARE DATA. The defaults below are a starting set; a club's own names and
 * bands are rows in cc_club_level_tiers (see lib/clubLevels.ts), which is why
 * Rossmoor's four tiers live in their seed script and not in this file.
 *
 * Pure and client-safe on purpose: a LevelScale is a plain object, so the
 * server resolves one and hands it to the browser in a payload or a prop.
 */

export type LevelTier = {
  name: string;
  /** The number stored when a member picks this tier. */
  rating: number;
  /** The lowest number that reads as this tier; the tier above starts where it ends. */
  min: number;
  /** The top of the band the club publishes, for the quiet number beside the name. Null reads "and up". */
  max: number | null;
};

export type LevelScale = {
  sport: string;
  /** A heading or a menu: "NTRP", "Skill level". */
  label: string;
  /** What a member is asked for: "Pick your NTRP rating", "Pick your skill level". */
  noun: string;
  /** The same thing further into a sentence: "Add their NTRP in PlayerVault". */
  inline: string;
  /** Who a member asks to change a rating the club set: "the tennis staff". */
  staff: string;
  /** Low to high. Empty means the numbers themselves are the levels. */
  tiers: LevelTier[];
};

/** The NTRP ladder a member picks from where the numbers are the levels. */
export const NUMERIC_LEVELS = [2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0] as const;

/** What a member with no rating reads, everywhere. */
export const UNRATED = 'Not set yet';

const WORDS: Record<string, Pick<LevelScale, 'label' | 'noun' | 'inline' | 'staff'>> = {
  tennis: { label: 'NTRP', noun: 'NTRP rating', inline: 'NTRP', staff: 'the tennis staff' },
  pickleball: { label: 'Skill level', noun: 'skill level', inline: 'skill level', staff: 'the club staff' },
};

/**
 * The tiers a sport gets before a club says otherwise. Only sports that really
 * are played by name belong here: everything else keeps the numbers, which is
 * also what an unrecognised sport falls back to.
 */
export const DEFAULT_TIERS: Record<string, LevelTier[]> = {
  pickleball: [
    { name: 'Novice', rating: 2.0, min: 1.0, max: 2.0 },
    { name: 'Intermediate', rating: 3.0, min: 2.5, max: 3.5 },
    { name: 'Advanced', rating: 4.5, min: 4.0, max: null },
  ],
};

/**
 * The scale to use.
 *
 * `sport` is the specific one when the surface is about a single sport (a
 * pickleball game, a pickleball program, a player whose sport we know);
 * `sports` is the club's list, whose FIRST entry is its primary sport and the
 * answer for a mixed club's general surfaces. `tiers` are the club's own rows,
 * and win over the defaults.
 */
export function levelScaleFor(opts: {
  sports?: readonly string[] | null;
  sport?: string | null;
  tiers?: readonly LevelTier[] | null;
}): LevelScale {
  const sport = (opts.sport || opts.sports?.[0] || 'tennis').toLowerCase();
  const words = WORDS[sport] ?? WORDS.tennis;
  const tiers = opts.tiers?.length ? [...opts.tiers] : (DEFAULT_TIERS[sport] ?? []);
  return { sport, ...words, tiers: tiers.slice().sort((a, b) => a.min - b.min) };
}

/** The scale every club had before this existed, and the fallback for anything unknown. */
export const TENNIS_SCALE: LevelScale = levelScaleFor({ sport: 'tennis' });

export const isTiered = (scale: LevelScale): boolean => scale.tiers.length > 0;

/** The tier a stored number reads as. Null on a numeric scale, or with no number. */
export function tierOf(scale: LevelScale, n: number | string | null | undefined): LevelTier | null {
  if (!isTiered(scale) || n == null || n === '') return null;
  const v = Number(n);
  if (Number.isNaN(v)) return null;
  // The highest tier this number reaches; below the bottom tier it is still the
  // bottom tier, because a 1.5 at a club whose lowest name is Novice is a Novice.
  let found = scale.tiers[0];
  for (const t of scale.tiers) if (v >= t.min) found = t;
  return found;
}

const decimal = (n: number | string) => Number(n).toFixed(1);

/** The band beside a tier's name: "2.5–3.0", "4.0+". */
export function tierBand(t: LevelTier): string {
  if (t.max == null) return `${decimal(t.min)}+`;
  return t.min === t.max ? decimal(t.min) : `${decimal(t.min)}–${decimal(t.max)}`;
}

/** One person's level: "3.5", "Intermediate", or "Not set yet". */
export function levelValue(scale: LevelScale, n: number | string | null | undefined): string {
  if (n == null || n === '') return UNRATED;
  return tierOf(scale, n)?.name ?? decimal(n);
}

/**
 * A game's level: "3.0–3.5", "3.5+", "up to 3.0" — or, where the club plays by
 * name, the tiers the range covers: "Intermediate", "Intermediate to Advanced".
 * Empty string means any level.
 */
export function levelRange(
  scale: LevelScale,
  min: number | string | null | undefined,
  max: number | string | null | undefined,
): string {
  if (!isTiered(scale)) {
    if (min != null && max != null) return Number(min) === Number(max) ? decimal(min) : `${decimal(min)}–${decimal(max)}`;
    if (min != null) return `${decimal(min)}+`;
    if (max != null) return `up to ${decimal(max)}`;
    return '';
  }
  const lo = tierOf(scale, min);
  const hi = tierOf(scale, max);
  if (lo && hi) return lo.name === hi.name ? lo.name : `${lo.name} to ${hi.name}`;
  if (lo) return `${lo.name} and up`;
  if (hi) return `up to ${hi.name}`;
  return '';
}

/**
 * The same thing as a fact on a card: "Level 3.0–3.5" reads right for a number
 * and wrong for a name, where "Intermediate" already says it.
 */
export function levelFact(
  scale: LevelScale,
  min: number | string | null | undefined,
  max: number | string | null | undefined,
): string {
  const r = levelRange(scale, min, max);
  if (!r) return '';
  return isTiered(scale) ? r : `Level ${r}`;
}

/**
 * What a member may pick, and what gets stored. On a tiered scale the band is
 * the quiet second line — "Intermediate · 2.5–3.0" — and the rating is what
 * goes in the column CourtConnect matches on.
 */
export function levelOptions(scale: LevelScale): { value: number; label: string; band: string }[] {
  if (isTiered(scale)) return scale.tiers.map((t) => ({ value: t.rating, label: t.name, band: tierBand(t) }));
  return NUMERIC_LEVELS.map((n) => ({ value: n, label: decimal(n), band: '' }));
}

/** "Intermediate · 2.5–3.0" for a select, where one line is all there is. */
export const optionLine = (o: { label: string; band: string }): string =>
  o.band ? `${o.label} · ${o.band}` : o.label;

/** Is this a level a member of this club may pick? The API's guard. */
export function isLevelValue(scale: LevelScale, n: unknown): boolean {
  const v = Number(n);
  return !Number.isNaN(v) && levelOptions(scale).some((o) => o.value === v);
}

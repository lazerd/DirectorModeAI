/**
 * compassLayout — turns the flat (bracket, round) match rows of a compass draw
 * into human-readable DIRECTIONAL groups, ordered by finishing place, each
 * labelled with the place it decides and the win/loss record that routes a
 * player there. A compass draw fans winners East and losers West, spinning off
 * North/South and the four corner (NE/NW/SE/SW) playoffs so every player earns a
 * placement — but the raw data just stores bracket 'main'/'consolation' + round
 * numbers, which a generic single-elim renderer mislabels ("Round of 4",
 * "Final") and which hides where the 3rd/4th playoff actually is.
 *
 * Supports the two sizes the season-end draws use: 16 (main R1 = 8 matches) and
 * 8 (main R1 = 4 matches). Anything else returns null so the caller falls back
 * to the generic bracket renderer.
 */

export type CompassStageRef = { bracket: 'main' | 'consolation'; round: number; roundName: string };
export type CompassGroup = {
  id: string;
  direction: string; // "East · Championship", "Northeast", "Round 1 — Everyone"…
  place: string; // "1st – 2nd", "3rd – 4th", "All 16 players"
  subtitle: string; // the record that lands a player here
  accent: string; // hex for the group's accent bar
  stages: CompassStageRef[]; // rounds in this group, in play order
};

const key = (b: string, r: number) => `${b}:${r}`;

// Ordered by finishing place so the sheet reads top → bottom, best → worst.
const COMPASS_16: Array<Omit<CompassGroup, 'stages'> & { stageKeys: [string, string][] }> = [
  { id: 'r1', direction: 'Round 1 — Everyone', place: 'All 16 players', subtitle: 'Everyone starts here. Win → East, lose → West.', accent: '#334155',
    stageKeys: [['main:1', 'Round 1']] },
  { id: 'east', direction: 'East · Championship', place: '1st – 2nd', subtitle: 'Won Round 1 — the winners’ bracket. Keep winning for the title.', accent: '#1d4ed8',
    stageKeys: [['main:2', 'Quarterfinals'], ['main:3', 'Semifinals'], ['main:4', 'Final']] },
  { id: 'ne', direction: 'Northeast', place: '3rd – 4th', subtitle: 'Won your first two, then lost the East semifinal.', accent: '#0891b2',
    stageKeys: [['consolation:8', 'Playoff']] },
  { id: 'north', direction: 'North', place: '5th – 6th', subtitle: 'Won Round 1, then lost in the East quarterfinals.', accent: '#0d9488',
    stageKeys: [['consolation:4', 'Semifinals'], ['consolation:5', 'Final']] },
  { id: 'nw', direction: 'Northwest', place: '7th – 8th', subtitle: 'Dropped out of the North draw.', accent: '#65a30d',
    stageKeys: [['consolation:10', 'Playoff']] },
  { id: 'west', direction: 'West', place: '9th – 10th', subtitle: 'Lost Round 1 — the consolation bracket. Win out for 9th.', accent: '#c2410c',
    stageKeys: [['consolation:1', 'Round 1'], ['consolation:2', 'Semifinals'], ['consolation:3', 'Final']] },
  { id: 'sw', direction: 'Southwest', place: '11th – 12th', subtitle: 'Lost Round 1, then dropped through the West draw.', accent: '#b45309',
    stageKeys: [['consolation:9', 'Playoff']] },
  { id: 'south', direction: 'South', place: '13th – 14th', subtitle: 'Lost Round 1 and your first West match.', accent: '#a16207',
    stageKeys: [['consolation:6', 'Semifinals'], ['consolation:7', 'Final']] },
  { id: 'se', direction: 'Southeast', place: '15th – 16th', subtitle: 'Dropped out of the South draw.', accent: '#78716c',
    stageKeys: [['consolation:11', 'Playoff']] },
];

const COMPASS_8: Array<Omit<CompassGroup, 'stages'> & { stageKeys: [string, string][] }> = [
  { id: 'r1', direction: 'Round 1 — Everyone', place: 'All 8 players', subtitle: 'Everyone starts here. Win → East, lose → West.', accent: '#334155',
    stageKeys: [['main:1', 'Round 1']] },
  { id: 'east', direction: 'East · Championship', place: '1st – 2nd', subtitle: 'Won Round 1 — keep winning for the title.', accent: '#1d4ed8',
    stageKeys: [['main:2', 'Semifinals'], ['main:3', 'Final']] },
  { id: 'north', direction: 'North', place: '3rd – 4th', subtitle: 'Won Round 1, then lost the semifinal.', accent: '#0d9488',
    stageKeys: [['main:4', 'Playoff']] },
  { id: 'west', direction: 'West', place: '5th – 6th', subtitle: 'Lost Round 1 — win the consolation for 5th.', accent: '#c2410c',
    stageKeys: [['consolation:1', 'Semifinals'], ['consolation:2', 'Final']] },
  { id: 'south', direction: 'South', place: '7th – 8th', subtitle: 'Lost Round 1, then lost again.', accent: '#a16207',
    stageKeys: [['consolation:3', 'Playoff']] },
];

export function isCompassFormat(fmt: string | null | undefined): boolean {
  return fmt === 'compass-singles' || fmt === 'compass-doubles';
}

/**
 * Build ordered directional groups for a compass draw. Only includes stages that
 * actually exist in `matches`, and drops any group left with no stages. Returns
 * null if the draw isn't a recognised compass size (16 or 8).
 */
export function buildCompassGroups(
  matches: Array<{ bracket: string; round: number }>
): CompassGroup[] | null {
  const mainR1 = matches.filter((m) => m.bracket === 'main' && m.round === 1).length;
  const spec = mainR1 >= 8 ? COMPASS_16 : mainR1 >= 4 ? COMPASS_8 : null;
  if (!spec) return null;

  const present = new Set(matches.map((m) => key(m.bracket, m.round)));
  const groups: CompassGroup[] = [];
  for (const g of spec) {
    const stages: CompassStageRef[] = g.stageKeys
      .filter(([k]) => present.has(k))
      .map(([k, roundName]) => {
        const [bracket, round] = k.split(':');
        return { bracket: bracket as 'main' | 'consolation', round: Number(round), roundName };
      });
    if (stages.length === 0) continue;
    groups.push({ id: g.id, direction: g.direction, place: g.place, subtitle: g.subtitle, accent: g.accent, stages });
  }
  return groups;
}
